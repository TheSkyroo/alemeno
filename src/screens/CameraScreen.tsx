/**
 * CameraScreen.tsx
 *
 * The primary screen of the Marker Scanner app.
 *
 * Responsibilities:
 *  - Requests and tracks camera permissions.
 *  - Selects the best available camera format (prefers 2000–3000 px short side).
 *  - Runs a VisionCamera frame processor (on the JS worklet thread) that:
 *      1. Centre-crops the frame to a square.
 *      2. Downscales it to PROCESSING_FRAME_SIZE × PROCESSING_FRAME_SIZE.
 *      3. Calls detectMarkerInSquareFrame() to find asymmetric markers.
 *      4. Rate-limits submissions to at most one per 180 ms.
 *  - Deduplicates captures by comparing perceptual hashes, centroids,
 *    and relative areas before saving.
 *  - Renders a live MarkerOverlay SVG on top of the camera preview.
 *  - Shows a torch toggle and a reset button.
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useFrameProcessor,
  type CameraDevice,
  type CameraDeviceFormat,
  type CameraPermissionStatus,
} from 'react-native-vision-camera';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useSharedValue} from 'react-native-reanimated';
import {Worklets} from 'react-native-worklets-core';
import {useResizePlugin} from 'vision-camera-resize-plugin';
import CaptureProgress from '../components/CaptureProgress';
import MarkerOverlay from '../components/MarkerOverlay';
import type {FrameAnalysis, MarkerCapture} from '../types';
import {PROCESSING_FRAME_SIZE, detectMarkerInSquareFrame} from '../utils/markerDetection';
import {hammingDistance} from '../utils/imageUtils';

type CameraScreenProps = {
  /** Captured frames accumulated so far in this session. */
  captures: MarkerCapture[];
  /** Increments on each reset, triggering a full component re-mount. */
  sessionKey: number;
  /** Called when a new, non-duplicate frame is accepted. */
  onCapture: (capture: MarkerCapture) => void;
  /** Called when the user resets the session. */
  onReset: () => void;
};

/** Number of frames required to complete a session. */
const TARGET_COUNT = 20;

/** Hide the detection overlay after this many milliseconds without a result. */
const OVERLAY_STALE_MS = 480;

/** Minimum gap (ms) between consecutive saves to avoid burst duplicates. */
const CAPTURE_COOLDOWN_MS = 220;

// ── Format selection ─────────────────────────────────────────────────────────

/**
 * Picks the "best" format from the device's available formats.
 *
 * Preference order:
 *  1. Formats whose short side is between 2 000 – 3 000 px (good balance of
 *     detail vs. processing cost), sorted by distance to 2 500 px, then by
 *     highest FPS.
 *  2. If none qualify, fall back to all formats sorted the same way.
 */
function pickCameraFormat(device: CameraDevice | undefined): CameraDeviceFormat | undefined {
  if (device == null) {
    return undefined;
  }

  const preferred = device.formats.filter(format => {
    const width = format.videoWidth ?? format.photoWidth ?? 0;
    const height = format.videoHeight ?? format.photoHeight ?? 0;
    const shortSide = Math.min(width, height);
    return shortSide >= 2000 && shortSide <= 3000;
  });

  const candidates = preferred.length > 0 ? preferred : device.formats;

  const sorted = [...candidates].sort((left, right) => {
    const leftWidth = left.videoWidth ?? left.photoWidth ?? 0;
    const leftHeight = left.videoHeight ?? left.photoHeight ?? 0;
    const rightWidth = right.videoWidth ?? right.photoWidth ?? 0;
    const rightHeight = right.videoHeight ?? right.photoHeight ?? 0;
    const leftShortSide = Math.min(leftWidth, leftHeight);
    const rightShortSide = Math.min(rightWidth, rightHeight);
    const leftDistance = Math.abs(leftShortSide - 2500);
    const rightDistance = Math.abs(rightShortSide - 2500);

    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance; // Prefer closer to 2500
    }

    return right.maxFps - left.maxFps; // Prefer higher FPS as a tiebreaker
  });

  return sorted[0];
}

// ── Duplicate detection ──────────────────────────────────────────────────────

/**
 * Returns true if `candidate` is too similar to any already-saved capture.
 *
 * A capture is considered a duplicate when ALL three conditions hold:
 *  - Hamming distance between perceptual hashes < 12 bits
 *  - Euclidean distance between centroids < 30 px (processing frame space)
 *  - Relative area difference < 8 %
 */
function isDuplicateAnalysis(candidate: FrameAnalysis, captures: MarkerCapture[]): boolean {
  for (let index = 0; index < captures.length; index += 1) {
    const existing = captures[index];

    const hashDelta = hammingDistance(existing.hash, candidate.hash);
    const centerDelta = Math.sqrt(
      Math.pow(existing.geometry.centerX - candidate.geometry.centerX, 2) +
        Math.pow(existing.geometry.centerY - candidate.geometry.centerY, 2),
    );
    const areaDelta =
      Math.abs(existing.geometry.area - candidate.geometry.area) /
      Math.max(existing.geometry.area, candidate.geometry.area, 1);

    if (hashDelta < 12 && centerDelta < 30 && areaDelta < 0.08) {
      return true;
    }
  }

  return false;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CameraScreen({
  captures,
  sessionKey,
  onCapture,
  onReset,
}: CameraScreenProps) {
  const device = useCameraDevice('back');
  const format = useMemo(() => pickCameraFormat(device), [device]);
  const {resize} = useResizePlugin();
  const {width} = useWindowDimensions();

  // ── State ────────────────────────────────────────────────────────────
  const [permissionStatus, setPermissionStatus] =
    useState<CameraPermissionStatus>('not-determined');
  const [torchEnabled, setTorchEnabled] = useState(false);

  // Latest frame analysis result — drives the overlay and status text
  const [analysis, setAnalysis] = useState<FrameAnalysis | null>(null);

  // ── Timing refs / shared values ──────────────────────────────────────
  const lastSeenAt = useRef(0);          // JS-thread: last time a result arrived
  const lastCapturedAt = useRef(0);      // JS-thread: last time a frame was saved
  const lastSubmissionAt = useSharedValue(0); // Worklet-thread: rate-limit guard

  // ── Layout ───────────────────────────────────────────────────────────
  // Square camera preview; capped at 440 px with a 12 px margin on each side
  const frameSize = Math.min(width - 24, 440);
  const guideSize = frameSize / 1.5; // Guide box = 2/3 of the frame

  // ── Permission bootstrap ─────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      const status = await Camera.getCameraPermissionStatus();
      if (mounted) {
        setPermissionStatus(status);
      }

      if (status !== 'granted') {
        const nextStatus = await Camera.requestCameraPermission();
        if (mounted) {
          setPermissionStatus(nextStatus);
        }
      }
    };

    bootstrap();

    return () => {
      mounted = false; // Prevent state updates after unmount
    };
  }, []);

  // ── Session reset cleanup ────────────────────────────────────────────
  // Reset all transient state whenever a new session starts
  useEffect(() => {
    setAnalysis(null);
    setTorchEnabled(false);
    lastSeenAt.current = 0;
    lastCapturedAt.current = 0;
    lastSubmissionAt.value = 0;
  }, [sessionKey, lastSubmissionAt]);

  // ── Overlay staleness watcher ────────────────────────────────────────
  // Clears the overlay when no marker has been seen for OVERLAY_STALE_MS
  useEffect(() => {
    const interval = setInterval(() => {
      if (Date.now() - lastSeenAt.current > OVERLAY_STALE_MS) {
        setAnalysis(previous => (previous == null ? previous : null));
      }
    }, 160);

    return () => {
      clearInterval(interval);
    };
  }, []);

  // ── Permission request ───────────────────────────────────────────────
  const requestPermission = useCallback(async () => {
    const status = await Camera.requestCameraPermission();
    setPermissionStatus(status);
  }, []);

  // ── Frame analysis handler (JS thread) ──────────────────────────────
  /**
   * Called from the worklet thread via `emitAnalysis` each time a
   * sufficiently distinct marker analysis is ready.
   */
  const handleAnalysis = useCallback(
    (nextAnalysis: FrameAnalysis) => {
      lastSeenAt.current = Date.now();
      setAnalysis(nextAnalysis); // Update overlay immediately

      // Bail out if the session is already complete
      if (captures.length >= TARGET_COUNT) {
        return;
      }

      const now = Date.now();

      // Enforce cooldown between consecutive saves
      if (now - lastCapturedAt.current < CAPTURE_COOLDOWN_MS) {
        return;
      }

      // Skip near-duplicate frames
      if (isDuplicateAnalysis(nextAnalysis, captures)) {
        return;
      }

      lastCapturedAt.current = now;

      onCapture({
        id: `capture-${sessionKey}-${captures.length + 1}-${now}`,
        label: '',           // Label is assigned later in navigation.tsx
        base64: nextAnalysis.base64,
        hash: nextAnalysis.hash,
        confidence: nextAnalysis.confidence,
        geometry: nextAnalysis.geometry,
        quad: nextAnalysis.quad,
        capturedAt: now,
      });
    },
    [captures, onCapture, sessionKey],
  );

  // Bridge from the worklet thread back to the JS thread
  const emitAnalysis = useMemo(
    () =>
      Worklets.createRunOnJS((nextAnalysis: FrameAnalysis) => {
        handleAnalysis(nextAnalysis);
      }),
    [handleAnalysis],
  );

  // ── Frame processor (worklet thread) ────────────────────────────────
  /**
   * Runs on every camera frame on a background worklet thread.
   *  1. Centre-crops the frame to a square.
   *  2. Downscales to PROCESSING_FRAME_SIZE using the resize plugin.
   *  3. Runs marker detection.
   *  4. Rate-limits result emissions to ≤ 1 per 180 ms.
   */
  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';

      // Compute a square centre-crop region
      const shortSide = Math.min(frame.width, frame.height);
      const cropX = Math.floor((frame.width - shortSide) / 2);
      const cropY = Math.floor((frame.height - shortSide) / 2);

      // Downscale the crop to the processing resolution
      const resized = resize(frame, {
        crop: {
          x: cropX,
          y: cropY,
          width: shortSide,
          height: shortSide,
        },
        scale: {
          width: PROCESSING_FRAME_SIZE,
          height: PROCESSING_FRAME_SIZE,
        },
        pixelFormat: 'rgb',
        dataType: 'uint8',
      });

      // Run the marker detection pipeline
      const result = detectMarkerInSquareFrame(
        resized,
        PROCESSING_FRAME_SIZE,
        PROCESSING_FRAME_SIZE,
      );

      if (result == null) {
        return; // No marker found in this frame
      }

      // Rate-limit: skip if the last emission was less than 180 ms ago
      const timestampMs = Number(frame.timestamp) / 1000000;
      if (timestampMs - lastSubmissionAt.value < 180) {
        return;
      }

      lastSubmissionAt.value = timestampMs;
      emitAnalysis(result); // Hand off to the JS thread
    },
    [emitAnalysis, lastSubmissionAt, resize],
  );

  // ── Derived display values ───────────────────────────────────────────
  // Only render the Camera component when everything is ready and we still need frames
  const readyToRenderCamera =
    permissionStatus === 'granted' && device != null && format != null && captures.length < 20;

  // Status copy shown below the camera frame
  const statusCopy =
    analysis == null
      ? 'Center the asymmetric marker inside the guide box.'
      : `Marker locked - ${Math.round(analysis.confidence * 100)}% match`;

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <View style={styles.screen}>

        {/* ── Top bar: title + torch toggle ──────────────────────────── */}
        <View style={styles.topBar}>
          <View>
            <Text style={styles.eyebrow}>Live detection</Text>
            <Text style={styles.title}>Scan Marker</Text>
          </View>

          <Pressable
            onPress={() => setTorchEnabled(current => !current)}
            style={[styles.secondaryButton, torchEnabled && styles.secondaryButtonActive]}>
            <Text
              style={[
                styles.secondaryButtonLabel,
                torchEnabled && styles.secondaryButtonLabelActive,
              ]}>
              {torchEnabled ? 'Torch On' : 'Torch Off'}
            </Text>
          </Pressable>
        </View>

        {/* ── Camera preview shell ───────────────────────────────────── */}
        <View style={[styles.cameraShell, {width: frameSize, height: frameSize}]}>
          {readyToRenderCamera ? (
            /* Live camera with frame processor */
            <Camera
              device={device}
              fps={Math.min(format?.maxFps ?? 30, 30)} // Cap at 30 fps for battery
              format={format}
              frameProcessor={frameProcessor}
              isActive
              photo={false}
              pixelFormat="yuv"
              resizeMode="cover"
              style={StyleSheet.absoluteFill}
              torch={torchEnabled ? 'on' : 'off'}
              video={false}
            />
          ) : (
            /* Placeholder when camera is not yet ready */
            <View style={styles.placeholder}>
              {permissionStatus !== 'granted' ? (
                <>
                  <Text style={styles.placeholderTitle}>Camera access is required</Text>
                  <Text style={styles.placeholderBody}>
                    The scanner uses live frame processing instead of photo capture.
                  </Text>
                  <Pressable onPress={requestPermission} style={styles.primaryButton}>
                    <Text style={styles.primaryButtonLabel}>Grant Camera Access</Text>
                  </Pressable>
                </>
              ) : device == null || format == null ? (
                <>
                  {/* Device or format still loading */}
                  <ActivityIndicator color="#37e58d" size="large" />
                  <Text style={styles.placeholderBody}>
                    Preparing the highest-resolution camera format.
                  </Text>
                </>
              ) : null}
            </View>
          )}

          {/* SVG overlay: guide box + detected-quad polygon */}
          <MarkerOverlay
            active={analysis != null}
            detectedQuad={analysis?.quad ?? null}
            frameSize={frameSize}
            guideSize={guideSize}
            processingFrameSize={PROCESSING_FRAME_SIZE}
          />
        </View>

        {/* ── Status text ────────────────────────────────────────────── */}
        <Text style={styles.statusCopy}>{statusCopy}</Text>

        {/* ── Bottom panel: capture progress + actions ───────────────── */}
        <View style={styles.bottomPanel}>
          <CaptureProgress count={captures.length} target={TARGET_COUNT} />

          <View style={styles.bottomActions}>
            {/* Reset button — clears all captures and returns to idle */}
            <Pressable onPress={onReset} style={styles.secondaryAction}>
              <Text style={styles.secondaryActionLabel}>Reset</Text>
            </Pressable>

            {/* Resolution badge — shows the active camera format dimensions */}
            <View style={styles.resolutionTag}>
              <Text style={styles.resolutionTagLabel}>
                {format == null
                  ? 'Awaiting camera'
                  : `${format.videoWidth ?? format.photoWidth ?? 0}x${
                      format.videoHeight ?? format.photoHeight ?? 0
                    }`}
              </Text>
            </View>
          </View>
        </View>

      </View>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#041214',
    flex: 1,
  },
  screen: {
    alignItems: 'center',
    backgroundColor: '#041214',
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 16,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
    width: '100%',
  },
  eyebrow: {
    color: '#8db2ac',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f3faf8',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 4,
  },
  cameraShell: {
    backgroundColor: '#071819',
    borderColor: '#173034',
    borderRadius: 32,
    borderWidth: 1,
    overflow: 'hidden',
  },
  placeholder: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  placeholderTitle: {
    color: '#f3faf8',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  placeholderBody: {
    color: '#aec2bf',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
    marginBottom: 18,
    textAlign: 'center',
  },
  statusCopy: {
    color: '#c8dad7',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 18,
    textAlign: 'center',
  },
  bottomPanel: {
    backgroundColor: '#0a1b1d',
    borderColor: '#153033',
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 18,
    width: '100%',
  },
  bottomActions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#37e58d',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  primaryButtonLabel: {
    color: '#052219',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#0d2224',
    borderColor: '#17373a',
    borderRadius: 15,
    borderWidth: 1,
    minWidth: 102,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonActive: {
    backgroundColor: '#18372a',
    borderColor: '#37e58d', // Green border when torch is on
  },
  secondaryButtonLabel: {
    color: '#cde0dd',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButtonLabelActive: {
    color: '#e9fff5',
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: '#0f2527',
    borderColor: '#1c393d',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  secondaryActionLabel: {
    color: '#d7e9e6',
    fontSize: 14,
    fontWeight: '800',
  },
  resolutionTag: {
    backgroundColor: '#0d2325',
    borderColor: '#18363a',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resolutionTagLabel: {
    color: '#9eb6b3',
    fontSize: 12,
    fontWeight: '700',
  },
});

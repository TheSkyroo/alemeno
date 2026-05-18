/**
 * MarkerOverlay.tsx
 *
 * An SVG overlay rendered on top of the live camera feed.
 *
 * It draws two things:
 *  1. A rounded-rectangle guide box to tell the user where to aim.
 *     Each corner is highlighted with a short L-shaped bracket.
 *  2. When a marker is detected, a filled polygon that traces the
 *     exact boundary of the detected quad (scaled from processing
 *     coordinates to display coordinates).
 *
 * The component is rendered with `pointerEvents="none"` so all touch
 * events pass through to the Camera below it.
 */

import React from 'react';
import {StyleSheet, View} from 'react-native';
import Svg, {Line, Polygon, Rect} from 'react-native-svg';
import type {DetectedQuad} from '../types';

type MarkerOverlayProps = {
  /** Whether a marker is currently locked (affects guide / polygon colour). */
  active: boolean;
  /** The detected quad to draw, or null when no marker is visible. */
  detectedQuad: DetectedQuad | null;
  /** Side length (px) of the square camera preview frame in display space. */
  frameSize: number;
  /** Side length (px) of the inner guide box in display space. */
  guideSize: number;
  /** Side length (px) used when the frame was analysed (processing space). */
  processingFrameSize: number;
};

/** Pixel length of each corner bracket arm. */
const CORNER_LENGTH = 28;

/**
 * Converts a DetectedQuad from processing-frame coordinates to display
 * coordinates and returns an SVG polygon points string.
 */
function buildPolygonPoints(
  quad: DetectedQuad,
  frameSize: number,
  processingFrameSize: number,
): string {
  const scale = frameSize / processingFrameSize;

  return [
    `${quad.topLeft.x * scale},${quad.topLeft.y * scale}`,
    `${quad.topRight.x * scale},${quad.topRight.y * scale}`,
    `${quad.bottomRight.x * scale},${quad.bottomRight.y * scale}`,
    `${quad.bottomLeft.x * scale},${quad.bottomLeft.y * scale}`,
  ].join(' ');
}

export default function MarkerOverlay({
  active,
  detectedQuad,
  frameSize,
  guideSize,
  processingFrameSize,
}: MarkerOverlayProps) {
  // Centre the guide box within the frame
  const guideOffset = (frameSize - guideSize) / 2;

  // Guide / bracket colour: green when active, subtle white when idle
  const guideColor = active ? '#37e58d' : 'rgba(230, 244, 241, 0.42)';

  // Pre-compute polygon points (null when no quad is detected)
  const polygonPoints =
    detectedQuad == null
      ? null
      : buildPolygonPoints(detectedQuad, frameSize, processingFrameSize);

  return (
    // pointerEvents="none" lets touches fall through to the Camera
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg height={frameSize} width={frameSize}>

        {/* ── Guide rectangle ──────────────────────────────────────────── */}
        <Rect
          x={guideOffset}
          y={guideOffset}
          width={guideSize}
          height={guideSize}
          rx={24}
          ry={24}
          fill="rgba(4, 18, 20, 0.10)"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={1}
        />

        {/* ── Top-left corner bracket ───────────────────────────────────── */}
        <Line
          x1={guideOffset}
          y1={guideOffset + CORNER_LENGTH}
          x2={guideOffset}
          y2={guideOffset}
          stroke={guideColor}
          strokeLinecap="round"
          strokeWidth={4}
        />
        <Line
          x1={guideOffset}
          y1={guideOffset}
          x2={guideOffset + CORNER_LENGTH}
          y2={guideOffset}
          stroke={guideColor}
          strokeLinecap="round"
          strokeWidth={4}
        />

        {/* ── Top-right corner bracket ──────────────────────────────────── */}
        <Line
          x1={guideOffset + guideSize - CORNER_LENGTH}
          y1={guideOffset}
          x2={guideOffset + guideSize}
          y2={guideOffset}
          stroke={guideColor}
          strokeLinecap="round"
          strokeWidth={4}
        />
        <Line
          x1={guideOffset + guideSize}
          y1={guideOffset}
          x2={guideOffset + guideSize}
          y2={guideOffset + CORNER_LENGTH}
          stroke={guideColor}
          strokeLinecap="round"
          strokeWidth={4}
        />

        {/* ── Bottom-left corner bracket ────────────────────────────────── */}
        <Line
          x1={guideOffset}
          y1={guideOffset + guideSize - CORNER_LENGTH}
          x2={guideOffset}
          y2={guideOffset + guideSize}
          stroke={guideColor}
          strokeLinecap="round"
          strokeWidth={4}
        />
        <Line
          x1={guideOffset}
          y1={guideOffset + guideSize}
          x2={guideOffset + CORNER_LENGTH}
          y2={guideOffset + guideSize}
          stroke={guideColor}
          strokeLinecap="round"
          strokeWidth={4}
        />

        {/* ── Bottom-right corner bracket ───────────────────────────────── */}
        <Line
          x1={guideOffset + guideSize - CORNER_LENGTH}
          y1={guideOffset + guideSize}
          x2={guideOffset + guideSize}
          y2={guideOffset + guideSize}
          stroke={guideColor}
          strokeLinecap="round"
          strokeWidth={4}
        />
        <Line
          x1={guideOffset + guideSize}
          y1={guideOffset + guideSize - CORNER_LENGTH}
          x2={guideOffset + guideSize}
          y2={guideOffset + guideSize}
          stroke={guideColor}
          strokeLinecap="round"
          strokeWidth={4}
        />

        {/* ── Detected-marker polygon (only rendered when quad is found) ── */}
        {polygonPoints != null ? (
          <Polygon
            points={polygonPoints}
            fill={active ? 'rgba(55, 229, 141, 0.08)' : 'transparent'}
            stroke={active ? '#37e58d' : 'transparent'}
            strokeLinejoin="round"
            strokeWidth={4}
          />
        ) : null}

      </Svg>
    </View>
  );
}

// No local styles are needed — layout is fully handled by SVG attributes
const styles = StyleSheet.create({});

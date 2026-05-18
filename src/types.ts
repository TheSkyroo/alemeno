/**
 * types.ts
 *
 * Shared TypeScript types used across the Marker Scanner app.
 *
 * Hierarchy:
 *  Point → DetectedQuad  (raw camera-space geometry)
 *  MarkerGeometry        (derived area + centroid)
 *  FrameAnalysis         (per-frame detection result)
 *  MarkerCapture         (persisted, labelled snapshot)
 */

/** A 2-D coordinate in pixel space. */
export type Point = {
  x: number;
  y: number;
};

/**
 * The four corners of a detected marker in camera-frame pixel coordinates.
 * Corner order follows a clockwise winding (top-left → top-right →
 * bottom-right → bottom-left).
 */
export type DetectedQuad = {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
};

/**
 * Derived spatial properties of a detected marker quad.
 * Used for duplicate-detection heuristics in CameraScreen.
 */
export type MarkerGeometry = {
  /** Shoelace-formula area of the quad in square pixels. */
  area: number;
  /** Horizontal centroid of the quad. */
  centerX: number;
  /** Vertical centroid of the quad. */
  centerY: number;
};

/**
 * The result returned by `detectMarkerInSquareFrame` when a marker is found.
 * Contains everything needed to display an overlay and decide whether to save.
 */
export type FrameAnalysis = {
  found: true;
  /** Raw quad corners in processing-frame coordinates. */
  quad: DetectedQuad;
  /** Weighted confidence score in the range [0, 1]. */
  confidence: number;
  /** 256-bit perceptual hash string for duplicate detection. */
  hash: string;
  /** Base64-encoded PNG of the normalised, orientation-corrected patch. */
  base64: string;
  /** Derived geometry (area + centroid) of the detected quad. */
  geometry: MarkerGeometry;
};

/**
 * A single saved marker capture.
 * Stored in navigation state and displayed on the Results screen.
 */
export type MarkerCapture = {
  /** Unique ID incorporating session key, index, and timestamp. */
  id: string;
  /** Human-readable label, e.g. "Frame #3". */
  label: string;
  /** Base64-encoded PNG thumbnail of the normalised marker patch. */
  base64: string;
  /** Perceptual hash used to skip near-duplicate captures. */
  hash: string;
  /** Detection confidence score in the range [0, 1]. */
  confidence: number;
  /** Spatial properties of the quad at the time of capture. */
  geometry: MarkerGeometry;
  /** Detected quad corners in processing-frame pixel coordinates. */
  quad: DetectedQuad;
  /** Unix timestamp (ms) of when this capture was saved. */
  capturedAt: number;
};

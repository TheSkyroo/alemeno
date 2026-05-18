/**
 * markerDetection.ts
 *
 * Core marker detection pipeline.  Everything here runs inside a VisionCamera
 * frame processor worklet (annotated with `'worklet'`), so no JS-bridge calls
 * or async APIs are allowed.
 *
 * Detection pipeline (per frame):
 *  1. Convert RGB → grayscale  (`toGrayscaleFromRgb`)
 *  2. Gaussian blur 5×5        (`gaussianBlur5x5`)
 *  3. Otsu binarisation        (`computeOtsuThreshold` + `thresholdGrayscale`)
 *  4. Connected-component labelling  (`findComponents`)
 *  5. Filter components by area, aspect ratio, fill ratio, and boundary size
 *  6. Build a quad from the boundary  (`buildQuadFromBoundary`)
 *  7. Validate quad geometry  (`quadIsUsable`)
 *  8. Warp the quad to a normalised patch  (`warpPerspectiveGrayscale`)
 *  9. Re-threshold the patch and correct orientation  (`orientMarkerPatch`)
 * 10. Verify marker structure (border + corner ratios)  (`verifyMarkerPatch`)
 * 11. Return the best-scoring candidate as a `FrameAnalysis`
 */

import type {DetectedQuad, FrameAnalysis, MarkerGeometry, Point} from '../types';
import {
  NORMALIZED_MARKER_SIZE,
  PROCESSING_FRAME_SIZE,
  blackRatio,
  buildPerceptualHash,
  computeOtsuThreshold,
  encodeBinaryPatchToPngBase64,
  gaussianBlur5x5,
  thresholdGrayscale,
  toGrayscaleFromRgb,
  whiteRatio,
} from './imageUtils';
import {orientMarkerPatch} from './orientationCorrection';
import {quadArea, warpPerspectiveGrayscale} from './perspectiveTransform';

// ── Internal types ────────────────────────────────────────────────────────────

/**
 * A connected component (white region) found in the binary frame.
 * Includes bounding-box, centroid, fill-ratio, and boundary pixel list.
 */
type Component = {
  area: number;       // Number of pixels in the component
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;   // Horizontal centroid (weighted average of x)
  centerY: number;   // Vertical centroid (weighted average of y)
  fillRatio: number; // area / (bounding-box area)
  boundary: Point[]; // Pixels that touch a background (0) neighbour
};

/** Pass/fail verdict plus a weighted confidence score for a candidate patch. */
type VerificationResult = {
  pass: boolean;
  confidence: number; // Weighted sum in [0, 1]
};

// ── Detection constants ───────────────────────────────────────────────────────

/** Minimum component area (px²) to be considered a marker candidate. */
const MIN_COMPONENT_AREA = 5000;

/** Maximum component area (px²); filters out near-full-frame blobs. */
const MAX_COMPONENT_AREA = 500000;

/** Width (px) of the expected black border ring around the marker. */
const BORDER_THICKNESS = 20;

/** Side length (px) of each corner region used for structure verification. */
const CORNER_REGION = 60;

// Re-export constants needed by CameraScreen
export {NORMALIZED_MARKER_SIZE, PROCESSING_FRAME_SIZE};

// ── Helper: boundary detection ────────────────────────────────────────────────

/**
 * Returns true if pixel (x, y) is on the boundary of a white component —
 * i.e., it is an image-edge pixel OR at least one of its 4-connected
 * neighbours is background (0).
 */
function isBoundaryPixel(
  binary: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  'worklet';

  // Image-edge pixels are always boundary pixels
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
    return true;
  }

  const index = y * width + x;
  return (
    binary[index - 1] === 0 ||     // left neighbour is background
    binary[index + 1] === 0 ||     // right
    binary[index - width] === 0 || // above
    binary[index + width] === 0    // below
  );
}

// ── Helper: connected-component labelling ─────────────────────────────────────

/**
 * Finds all 4-connected white (value = 1) components in the binary image
 * using an iterative BFS flood-fill.
 *
 * For each component, collects area, bounding box, centroid, fill ratio,
 * and the list of boundary pixels (used later to fit a quad).
 */
function findComponents(binary: Uint8Array, width: number, height: number): Component[] {
  'worklet';
  const visited = new Uint8Array(width * height);
  const components: Component[] = [];

  for (let startY = 0; startY < height; startY += 1) {
    for (let startX = 0; startX < width; startX += 1) {
      const startIndex = startY * width + startX;

      // Skip background pixels and already-visited pixels
      if (binary[startIndex] === 0 || visited[startIndex] === 1) {
        continue;
      }

      // BFS queue (stores flat pixel indices)
      const queue: number[] = [startIndex];
      visited[startIndex] = 1;

      let head = 0;
      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = startX;
      let minY = startY;
      let maxX = startX;
      let maxY = startY;
      const boundary: Point[] = [];

      while (head < queue.length) {
        const current = queue[head];
        head += 1;

        const x = current % width;
        const y = (current - x) / width;

        // Accumulate statistics
        area += 1;
        sumX += x;
        sumY += y;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);

        if (isBoundaryPixel(binary, width, height, x, y)) {
          boundary.push({x, y});
        }

        // Enqueue unvisited 4-connected white neighbours
        const left = current - 1;
        if (x > 0 && visited[left] === 0 && binary[left] === 1) {
          visited[left] = 1;
          queue.push(left);
        }

        const right = current + 1;
        if (x < width - 1 && visited[right] === 0 && binary[right] === 1) {
          visited[right] = 1;
          queue.push(right);
        }

        const up = current - width;
        if (y > 0 && visited[up] === 0 && binary[up] === 1) {
          visited[up] = 1;
          queue.push(up);
        }

        const down = current + width;
        if (y < height - 1 && visited[down] === 0 && binary[down] === 1) {
          visited[down] = 1;
          queue.push(down);
        }
      }

      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;

      components.push({
        area,
        minX,
        minY,
        maxX,
        maxY,
        centerX: sumX / Math.max(area, 1),
        centerY: sumY / Math.max(area, 1),
        fillRatio: area / Math.max(boxWidth * boxHeight, 1),
        boundary,
      });
    }
  }

  return components;
}

// ── Helper: Euclidean distance ────────────────────────────────────────────────

/** Returns the Euclidean distance between two 2-D points. */
function distance(left: Point, right: Point): number {
  'worklet';
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Helper: quad fitting ──────────────────────────────────────────────────────

/**
 * Fits a quadrilateral to a set of boundary pixels by finding the extreme
 * points in four diagonal directions (NW, NE, SE, SW).
 *
 * This is a fast, O(n) approximation of a convex-hull corner finder that works
 * well for roughly rectangular shapes.
 */
function buildQuadFromBoundary(boundary: Point[]): DetectedQuad {
  'worklet';
  let topLeft = boundary[0];
  let topRight = boundary[0];
  let bottomRight = boundary[0];
  let bottomLeft = boundary[0];

  // Initial scores based on the first boundary point
  let topLeftScore = boundary[0].x + boundary[0].y;       // Minimise (NW corner)
  let topRightScore = boundary[0].x - boundary[0].y;      // Maximise (NE corner)
  let bottomRightScore = boundary[0].x + boundary[0].y;   // Maximise (SE corner)
  let bottomLeftScore = boundary[0].y - boundary[0].x;    // Maximise (SW corner)

  for (let index = 1; index < boundary.length; index += 1) {
    const point = boundary[index];
    const leftScore = point.x + point.y;
    const rightScore = point.x - point.y;
    const bottomScore = point.y - point.x;

    if (leftScore < topLeftScore) {
      topLeftScore = leftScore;
      topLeft = point;
    }

    if (rightScore > topRightScore) {
      topRightScore = rightScore;
      topRight = point;
    }

    if (leftScore > bottomRightScore) {
      bottomRightScore = leftScore;
      bottomRight = point;
    }

    if (bottomScore > bottomLeftScore) {
      bottomLeftScore = bottomScore;
      bottomLeft = point;
    }
  }

  return {topLeft, topRight, bottomRight, bottomLeft};
}

// ── Helper: quad validation ───────────────────────────────────────────────────

/**
 * Returns true if the quad passes basic geometric sanity checks:
 *  - Area ≥ MIN_COMPONENT_AREA
 *  - Both average side lengths ≥ 40 px
 *  - Aspect ratio (horizontal / vertical) in [0.8, 1.2]  (roughly square)
 *  - Diagonal ≥ 60 px  (prevents degenerate near-zero quads)
 */
function quadIsUsable(quad: DetectedQuad): boolean {
  'worklet';
  const top = distance(quad.topLeft, quad.topRight);
  const right = distance(quad.topRight, quad.bottomRight);
  const bottom = distance(quad.bottomLeft, quad.bottomRight);
  const left = distance(quad.topLeft, quad.bottomLeft);
  const area = quadArea(quad);
  const averageHorizontal = (top + bottom) / 2;
  const averageVertical = (left + right) / 2;

  if (area < MIN_COMPONENT_AREA) {
    return false; // Too small — likely noise
  }

  if (averageHorizontal < 40 || averageVertical < 40) {
    return false; // Degenerate side
  }

  const ratio = averageHorizontal / Math.max(averageVertical, 1);
  if (ratio < 0.8 || ratio > 1.2) {
    return false; // Too rectangular — markers are square
  }

  if (distance(quad.topLeft, quad.bottomRight) < 60) {
    return false; // Diagonal too short
  }

  return true;
}

// ── Helper: border analysis ───────────────────────────────────────────────────

/**
 * Returns the ratio of dark pixels in the outer `border`-wide ring of a
 * square binary patch.  The marker has a solid black border, so a high ratio
 * here is a key verification signal.
 */
function borderBlackRatio(binary: Uint8Array, size: number, border: number): number {
  'worklet';
  let black = 0;
  let total = 0;

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * size;
    for (let x = 0; x < size; x += 1) {
      // Include pixel only if it is in the outer border ring
      if (x < border || y < border || x >= size - border || y >= size - border) {
        total += 1;
        black += binary[rowOffset + x];
      }
    }
  }

  return total === 0 ? 0 : black / total;
}

// ── Helper: patch verification ────────────────────────────────────────────────

/**
 * Verifies that a normalised, orientation-corrected binary patch matches the
 * expected marker structure.
 *
 * Expected structure (after orientation correction):
 *  - Outer border:   mostly black (≥ 80 %)
 *  - Top-left corner: mostly black (≥ 75 %) — the asymmetric "L" mark
 *  - Top-right corner: mostly white (≥ 70 %)
 *  - Bottom-left corner: mostly white (≥ 70 %)
 *  - Bottom-right corner: mostly white (≥ 70 %)
 *  - Interior (inner 260×260 px): mostly white (≥ 60 %)
 *
 * @returns A `VerificationResult` with a boolean pass flag and a weighted
 *          confidence score in [0, 1].
 */
function verifyMarkerPatch(binary: Uint8Array): VerificationResult {
  'worklet';
  const borderBlack = borderBlackRatio(binary, NORMALIZED_MARKER_SIZE, BORDER_THICKNESS);
  const topLeftBlack = blackRatio(binary, NORMALIZED_MARKER_SIZE, 0, 0, CORNER_REGION, CORNER_REGION);
  const topRightWhite = whiteRatio(
    binary,
    NORMALIZED_MARKER_SIZE,
    NORMALIZED_MARKER_SIZE - CORNER_REGION,
    0,
    CORNER_REGION,
    CORNER_REGION,
  );
  const bottomLeftWhite = whiteRatio(
    binary,
    NORMALIZED_MARKER_SIZE,
    0,
    NORMALIZED_MARKER_SIZE - CORNER_REGION,
    CORNER_REGION,
    CORNER_REGION,
  );
  const bottomRightWhite = whiteRatio(
    binary,
    NORMALIZED_MARKER_SIZE,
    NORMALIZED_MARKER_SIZE - CORNER_REGION,
    NORMALIZED_MARKER_SIZE - CORNER_REGION,
    CORNER_REGION,
    CORNER_REGION,
  );
  const interiorWhite = whiteRatio(binary, NORMALIZED_MARKER_SIZE, 20, 20, 260, 260);

  // Weighted confidence (weights sum to 1.0)
  const confidence =
    borderBlack    * 0.26 +
    topLeftBlack   * 0.22 +
    topRightWhite  * 0.14 +
    bottomLeftWhite  * 0.14 +
    bottomRightWhite * 0.14 +
    interiorWhite  * 0.10;

  return {
    pass:
      borderBlack      >= 0.80 &&
      topLeftBlack     >= 0.75 &&
      topRightWhite    >= 0.70 &&
      bottomLeftWhite  >= 0.70 &&
      bottomRightWhite >= 0.70 &&
      interiorWhite    >= 0.60,
    confidence,
  };
}

// ── Helper: geometry extraction ───────────────────────────────────────────────

/**
 * Derives a `MarkerGeometry` (area + centroid) from a `DetectedQuad`.
 * The centroid is the simple average of the four corner coordinates.
 */
function geometryFromQuad(quad: DetectedQuad): MarkerGeometry {
  'worklet';
  return {
    area: quadArea(quad),
    centerX:
      (quad.topLeft.x + quad.topRight.x + quad.bottomRight.x + quad.bottomLeft.x) / 4,
    centerY:
      (quad.topLeft.y + quad.topRight.y + quad.bottomRight.y + quad.bottomLeft.y) / 4,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs the full marker detection pipeline on a square RGB frame.
 *
 * Returns the best `FrameAnalysis` found, or `null` if no valid marker
 * is present in the frame.
 *
 * @param rgb    - Packed RGB byte array (3 bytes per pixel, row-major).
 * @param width  - Width of the frame (should equal PROCESSING_FRAME_SIZE).
 * @param height - Height of the frame (should equal PROCESSING_FRAME_SIZE).
 */
export function detectMarkerInSquareFrame(
  rgb: Uint8Array | number[],
  width: number,
  height: number,
): FrameAnalysis | null {
  'worklet';

  // ── Pre-processing ────────────────────────────────────────────────
  const grayscale = toGrayscaleFromRgb(rgb, width, height);
  const blurred = gaussianBlur5x5(grayscale, width, height);
  const binary = thresholdGrayscale(blurred, width, height, computeOtsuThreshold(blurred));
  const components = findComponents(binary, width, height);

  // Track the best candidate across all components
  let bestQuad: DetectedQuad | null = null;
  let bestGeometry: MarkerGeometry | null = null;
  let bestBinaryPatch: Uint8Array | null = null;
  let bestGrayscalePatch: Uint8ClampedArray | null = null;
  let bestConfidence = 0;

  // ── Candidate loop ────────────────────────────────────────────────
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];

    // Fast area filter
    if (component.area < MIN_COMPONENT_AREA || component.area > MAX_COMPONENT_AREA) {
      continue;
    }

    // Aspect-ratio filter (bounding box must be roughly square)
    const boxWidth = component.maxX - component.minX + 1;
    const boxHeight = component.maxY - component.minY + 1;
    const aspectRatio = boxWidth / Math.max(boxHeight, 1);
    if (aspectRatio < 0.8 || aspectRatio > 1.2) {
      continue;
    }

    // Fill-ratio filter (avoids solid rectangles and very thin frames)
    if (component.fillRatio < 0.08 || component.fillRatio > 0.45) {
      continue;
    }

    // Boundary must have enough points to fit a meaningful quad
    if (component.boundary.length < 40) {
      continue;
    }

    // Fit and validate a quad
    const quad = buildQuadFromBoundary(component.boundary);
    if (!quadIsUsable(quad)) {
      continue;
    }

    // ── Perspective correction + orientation ──────────────────────
    const normalizedGrayscale = warpPerspectiveGrayscale(
      blurred,
      width,
      height,
      quad,
      NORMALIZED_MARKER_SIZE,
    );
    const normalizedBinary = thresholdGrayscale(
      normalizedGrayscale,
      NORMALIZED_MARKER_SIZE,
      NORMALIZED_MARKER_SIZE,
      computeOtsuThreshold(normalizedGrayscale),
    );
    const oriented = orientMarkerPatch(
      normalizedBinary,
      normalizedGrayscale,
      NORMALIZED_MARKER_SIZE,
    );

    // ── Structure verification ────────────────────────────────────
    const verification = verifyMarkerPatch(oriented.binary);

    if (!verification.pass || verification.confidence <= bestConfidence) {
      continue; // Doesn't pass structural checks or isn't better than current best
    }

    bestQuad = quad;
    bestGeometry = geometryFromQuad(quad);
    bestBinaryPatch = oriented.binary;
    bestGrayscalePatch = oriented.grayscale;
    bestConfidence = verification.confidence;
  }

  // ── No valid marker found ─────────────────────────────────────────
  if (
    bestQuad == null ||
    bestGeometry == null ||
    bestBinaryPatch == null ||
    bestGrayscalePatch == null
  ) {
    return null;
  }

  // ── Return the best result ────────────────────────────────────────
  return {
    found: true,
    quad: bestQuad,
    confidence: bestConfidence,
    hash: buildPerceptualHash(bestGrayscalePatch, NORMALIZED_MARKER_SIZE, 16),
    base64: encodeBinaryPatchToPngBase64(bestBinaryPatch, NORMALIZED_MARKER_SIZE),
    geometry: bestGeometry,
  };
}

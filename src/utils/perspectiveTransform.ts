/**
 * perspectiveTransform.ts
 *
 * Perspective (homography) correction utilities used to "dewarp" a detected
 * marker quad into a flat, square, normalised patch.
 *
 * Pipeline:
 *  1. `computeHomography`  — Solves for the 3×3 homography matrix that maps
 *     the normalised output square onto the detected quad in camera space.
 *  2. `applyHomography`    — Maps a single output pixel (x, y) back to a
 *     source pixel via the inverse mapping.
 *  3. `bilinearSample`     — Interpolates the source grayscale value at a
 *     sub-pixel location.
 *  4. `warpPerspectiveGrayscale` — Combines the above to produce a normalised
 *     grayscale patch of the marker.
 *
 * Additionally exports `quadArea` (Shoelace formula) used by the detection
 * pipeline to filter candidate quads by minimum area.
 */

import type {DetectedQuad, Point} from '../types';
import {clamp} from './imageUtils';

// ── Linear algebra ────────────────────────────────────────────────────────────

/**
 * Solves an augmented N×(N+1) matrix in-place using Gauss-Jordan elimination
 * with partial pivoting.
 *
 * Returns the solution vector of length N.  If the system is singular (pivot
 * below 1e-8), the corresponding unknowns are set to 0.
 */
function solveLinearSystem(matrix: number[][]): number[] {
  'worklet';
  const size = matrix.length;

  for (let pivot = 0; pivot < size; pivot += 1) {
    // Partial pivoting: find the row with the largest absolute value in this column
    let maxRow = pivot;
    let maxValue = Math.abs(matrix[pivot][pivot]);

    for (let row = pivot + 1; row < size; row += 1) {
      const value = Math.abs(matrix[row][pivot]);
      if (value > maxValue) {
        maxValue = value;
        maxRow = row;
      }
    }

    // Singular or near-singular — return zero vector
    if (maxValue < 1e-8) {
      return new Array(size).fill(0);
    }

    // Swap current row with the pivot row
    if (maxRow !== pivot) {
      const temporary = matrix[pivot];
      matrix[pivot] = matrix[maxRow];
      matrix[maxRow] = temporary;
    }

    // Normalise the pivot row so the diagonal element becomes 1
    const pivotValue = matrix[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) {
      matrix[pivot][column] /= pivotValue;
    }

    // Eliminate the pivot column from all other rows
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) {
        continue;
      }

      const factor = matrix[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        matrix[row][column] -= factor * matrix[pivot][column];
      }
    }
  }

  // Extract the solution from the last column of the reduced matrix
  const solution = new Array(size);
  for (let row = 0; row < size; row += 1) {
    solution[row] = matrix[row][size];
  }

  return solution;
}

// ── Homography ────────────────────────────────────────────────────────────────

/**
 * Computes the 3×3 homography matrix H such that:
 *   [u, v, 1]ᵀ ∝ H · [x, y, 1]ᵀ
 *
 * where (x, y) are source points and (u, v) are destination points.
 *
 * The system is set up as a Direct Linear Transform (DLT) from 4 point
 * correspondences, yielding 8 equations for 8 unknowns (h₈ is set to 1).
 */
function computeHomography(source: Point[], destination: Point[]): number[] {
  'worklet';
  const augmentedMatrix: number[][] = [];

  for (let index = 0; index < 4; index += 1) {
    const x = source[index].x;
    const y = source[index].y;
    const u = destination[index].x;
    const v = destination[index].y;

    // Two equations per correspondence (from the cross-product constraint)
    augmentedMatrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    augmentedMatrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  const solution = solveLinearSystem(augmentedMatrix);

  // Reconstruct the 3×3 matrix in row-major order (h₈ = 1 by convention)
  return [
    solution[0], solution[1], solution[2],
    solution[3], solution[4], solution[5],
    solution[6], solution[7], 1,
  ];
}

/**
 * Applies a homography matrix to a single point (x, y) and returns the
 * transformed point in homogeneous coordinates.
 *
 * Returns {0, 0} if the denominator is near zero (degenerate case).
 */
function applyHomography(matrix: number[], x: number, y: number): Point {
  'worklet';
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8];

  if (Math.abs(denominator) < 1e-8) {
    return {x: 0, y: 0}; // Avoid division by zero
  }

  return {
    x: (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
    y: (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator,
  };
}

// ── Sampling ──────────────────────────────────────────────────────────────────

/**
 * Samples a grayscale image at a sub-pixel location using bilinear interpolation.
 * Out-of-bounds coordinates are clamped to the image boundary.
 */
function bilinearSample(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  'worklet';
  const clampedX = clamp(x, 0, width - 1);
  const clampedY = clamp(y, 0, height - 1);

  // Integer neighbours
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = clamp(x0 + 1, 0, width - 1);
  const y1 = clamp(y0 + 1, 0, height - 1);

  // Fractional offsets for interpolation weights
  const wx = clampedX - x0;
  const wy = clampedY - y0;

  // Sample the four surrounding pixels
  const topLeft = grayscale[y0 * width + x0];
  const topRight = grayscale[y0 * width + x1];
  const bottomLeft = grayscale[y1 * width + x0];
  const bottomRight = grayscale[y1 * width + x1];

  // Interpolate horizontally, then vertically
  const top = topLeft * (1 - wx) + topRight * wx;
  const bottom = bottomLeft * (1 - wx) + bottomRight * wx;

  return Math.round(top * (1 - wy) + bottom * wy);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Computes the area of a quadrilateral using the Shoelace formula.
 * Vertices must be supplied in order (clockwise or counter-clockwise).
 */
export function quadArea(quad: DetectedQuad): number {
  'worklet';
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return Math.abs(area) / 2;
}

/**
 * Warps a perspective-distorted marker quad from the source grayscale image
 * into a flat, square output patch of side length `outputSize`.
 *
 * The inverse mapping approach is used: for each destination pixel (x, y)
 * in the output square, we compute the corresponding source pixel via the
 * homography and sample it with bilinear interpolation.
 *
 * @param grayscale  - Source grayscale image (width × height).
 * @param width      - Width of the source image in pixels.
 * @param height     - Height of the source image in pixels.
 * @param quad       - Detected quad corners in source pixel coordinates.
 * @param outputSize - Side length of the output (square) patch.
 * @returns A `Uint8ClampedArray` of length outputSize², containing the
 *          normalised grayscale marker patch.
 */
export function warpPerspectiveGrayscale(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
  quad: DetectedQuad,
  outputSize: number,
): Uint8ClampedArray {
  'worklet';

  // The output square's four corners (clockwise, starting top-left)
  const source = [
    {x: 0, y: 0},
    {x: outputSize - 1, y: 0},
    {x: outputSize - 1, y: outputSize - 1},
    {x: 0, y: outputSize - 1},
  ];

  // Map each source corner to the corresponding quad corner in camera space
  const destination = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];

  const homography = computeHomography(source, destination);
  const output = new Uint8ClampedArray(outputSize * outputSize);

  // Inverse warp: iterate over output pixels and look up source values
  for (let y = 0; y < outputSize; y += 1) {
    const rowOffset = y * outputSize;
    for (let x = 0; x < outputSize; x += 1) {
      const sourcePoint = applyHomography(homography, x, y);
      output[rowOffset + x] = bilinearSample(
        grayscale,
        width,
        height,
        sourcePoint.x,
        sourcePoint.y,
      );
    }
  }

  return output;
}

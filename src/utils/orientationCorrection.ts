/**
 * orientationCorrection.ts
 *
 * Determines the correct rotation for a normalised marker patch.
 *
 * The asymmetric marker has a distinctive black corner in the top-left and
 * white corners elsewhere.  `orientMarkerPatch` tries all four 90° rotations
 * and picks the one whose corner-ratio score best matches that signature.
 *
 * Both the binary and grayscale versions of the patch are rotated in sync
 * so downstream code (verification + hashing) always works on an upright image.
 */

import {
  blackRatio,
  rotateSquareBinary,
  rotateSquareGrayscale,
  whiteRatio,
} from './imageUtils';

/** The result of the orientation search. */
type OrientationResult = {
  /** Orientation-corrected binary patch (1 = dark, 0 = light). */
  binary: Uint8Array<ArrayBufferLike>;
  /** Orientation-corrected grayscale patch. */
  grayscale: Uint8ClampedArray<ArrayBufferLike>;
  /** Number of 90° clockwise rotations applied (0–3). */
  rotation: number;
  /** Weighted corner-ratio score of the winning orientation. */
  score: number;
};

/**
 * Finds the orientation of the marker patch by scoring all four 90° rotations.
 *
 * Scoring heuristic (higher = more likely correct orientation):
 *  - Top-left corner is dark  → weight 1.8 (dominant signal)
 *  - Top-right corner is light → weight 0.6
 *  - Bottom-left corner is light → weight 0.6
 *  - Bottom-right corner is light → weight 0.6
 *
 * The 60×60 px corner regions are sampled in processing-frame coordinates.
 *
 * @param binary     - Flat binary patch (size × size).
 * @param grayscale  - Flat grayscale patch (size × size).
 * @param size       - Side length of the (square) patch in pixels.
 * @returns The best-scoring orientation with both rotated patches.
 */
export function orientMarkerPatch(
  binary: Uint8Array<ArrayBufferLike>,
  grayscale: Uint8ClampedArray<ArrayBufferLike>,
  size: number,
): OrientationResult {
  'worklet';

  let bestBinary: Uint8Array<ArrayBufferLike> = binary.slice();
  let bestGrayscale: Uint8ClampedArray<ArrayBufferLike> = grayscale.slice();
  let bestRotation = 0;
  let bestScore = -1;

  // Test each of the four 90° rotations (0°, 90°, 180°, 270°)
  for (let rotation = 0; rotation < 4; rotation += 1) {
    // Avoid unnecessary copy for the 0° case
    const rotatedBinary =
      rotation === 0 ? binary.slice() : rotateSquareBinary(binary, size, rotation);
    const rotatedGrayscale =
      rotation === 0 ? grayscale.slice() : rotateSquareGrayscale(grayscale, size, rotation);

    // Measure corner ratios for this orientation
    const cornerBlack = blackRatio(rotatedBinary, size, 0, 0, 60, 60);
    const topRightWhite = whiteRatio(rotatedBinary, size, size - 60, 0, 60, 60);
    const bottomLeftWhite = whiteRatio(rotatedBinary, size, 0, size - 60, 60, 60);
    const bottomRightWhite = whiteRatio(rotatedBinary, size, size - 60, size - 60, 60, 60);

    // Weighted score: top-left black corner carries the most weight
    const score =
      cornerBlack * 1.8 +
      topRightWhite * 0.6 +
      bottomLeftWhite * 0.6 +
      bottomRightWhite * 0.6;

    if (score > bestScore) {
      bestScore = score;
      bestBinary = rotatedBinary;
      bestGrayscale = rotatedGrayscale;
      bestRotation = rotation;
    }
  }

  return {
    binary: bestBinary,
    grayscale: bestGrayscale,
    rotation: bestRotation,
    score: bestScore,
  };
}

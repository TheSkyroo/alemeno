import {
  blackRatio,
  rotateSquareBinary,
  rotateSquareGrayscale,
  whiteRatio,
} from './imageUtils';

type OrientationResult = {
  binary: Uint8Array<ArrayBufferLike>;
  grayscale: Uint8ClampedArray<ArrayBufferLike>;
  rotation: number;
  score: number;
};

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

  for (let rotation = 0; rotation < 4; rotation += 1) {
    const rotatedBinary =
      rotation === 0 ? binary.slice() : rotateSquareBinary(binary, size, rotation);
    const rotatedGrayscale =
      rotation === 0 ? grayscale.slice() : rotateSquareGrayscale(grayscale, size, rotation);

    const cornerBlack = blackRatio(rotatedBinary, size, 0, 0, 60, 60);
    const topRightWhite = whiteRatio(rotatedBinary, size, size - 60, 0, 60, 60);
    const bottomLeftWhite = whiteRatio(rotatedBinary, size, 0, size - 60, 60, 60);
    const bottomRightWhite = whiteRatio(rotatedBinary, size, size - 60, size - 60, 60, 60);
    const score =
      cornerBlack * 1.8 + topRightWhite * 0.6 + bottomLeftWhite * 0.6 + bottomRightWhite * 0.6;

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

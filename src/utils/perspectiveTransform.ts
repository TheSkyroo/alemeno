import type {DetectedQuad, Point} from '../types';
import {clamp} from './imageUtils';

function solveLinearSystem(matrix: number[][]): number[] {
  'worklet';
  const size = matrix.length;

  for (let pivot = 0; pivot < size; pivot += 1) {
    let maxRow = pivot;
    let maxValue = Math.abs(matrix[pivot][pivot]);

    for (let row = pivot + 1; row < size; row += 1) {
      const value = Math.abs(matrix[row][pivot]);
      if (value > maxValue) {
        maxValue = value;
        maxRow = row;
      }
    }

    if (maxValue < 1e-8) {
      return new Array(size).fill(0);
    }

    if (maxRow !== pivot) {
      const temporary = matrix[pivot];
      matrix[pivot] = matrix[maxRow];
      matrix[maxRow] = temporary;
    }

    const pivotValue = matrix[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) {
      matrix[pivot][column] /= pivotValue;
    }

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

  const solution = new Array(size);
  for (let row = 0; row < size; row += 1) {
    solution[row] = matrix[row][size];
  }

  return solution;
}

function computeHomography(source: Point[], destination: Point[]): number[] {
  'worklet';
  const augmentedMatrix: number[][] = [];

  for (let index = 0; index < 4; index += 1) {
    const x = source[index].x;
    const y = source[index].y;
    const u = destination[index].x;
    const v = destination[index].y;

    augmentedMatrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    augmentedMatrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  const solution = solveLinearSystem(augmentedMatrix);
  return [
    solution[0],
    solution[1],
    solution[2],
    solution[3],
    solution[4],
    solution[5],
    solution[6],
    solution[7],
    1,
  ];
}

function applyHomography(matrix: number[], x: number, y: number): Point {
  'worklet';
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8];

  if (Math.abs(denominator) < 1e-8) {
    return {x: 0, y: 0};
  }

  return {
    x: (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
    y: (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator,
  };
}

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
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = clamp(x0 + 1, 0, width - 1);
  const y1 = clamp(y0 + 1, 0, height - 1);
  const wx = clampedX - x0;
  const wy = clampedY - y0;

  const topLeft = grayscale[y0 * width + x0];
  const topRight = grayscale[y0 * width + x1];
  const bottomLeft = grayscale[y1 * width + x0];
  const bottomRight = grayscale[y1 * width + x1];

  const top = topLeft * (1 - wx) + topRight * wx;
  const bottom = bottomLeft * (1 - wx) + bottomRight * wx;

  return Math.round(top * (1 - wy) + bottom * wy);
}

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

export function warpPerspectiveGrayscale(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
  quad: DetectedQuad,
  outputSize: number,
): Uint8ClampedArray {
  'worklet';
  const source = [
    {x: 0, y: 0},
    {x: outputSize - 1, y: 0},
    {x: outputSize - 1, y: outputSize - 1},
    {x: 0, y: outputSize - 1},
  ];
  const destination = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  const homography = computeHomography(source, destination);
  const output = new Uint8ClampedArray(outputSize * outputSize);

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

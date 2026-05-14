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

type Component = {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
  fillRatio: number;
  boundary: Point[];
};

type VerificationResult = {
  pass: boolean;
  confidence: number;
};

const MIN_COMPONENT_AREA = 5000;
const MAX_COMPONENT_AREA = 500000;
const BORDER_THICKNESS = 20;
const CORNER_REGION = 60;

export {NORMALIZED_MARKER_SIZE, PROCESSING_FRAME_SIZE};

function isBoundaryPixel(
  binary: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  'worklet';
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
    return true;
  }

  const index = y * width + x;
  return (
    binary[index - 1] === 0 ||
    binary[index + 1] === 0 ||
    binary[index - width] === 0 ||
    binary[index + width] === 0
  );
}

function findComponents(binary: Uint8Array, width: number, height: number): Component[] {
  'worklet';
  const visited = new Uint8Array(width * height);
  const components: Component[] = [];

  for (let startY = 0; startY < height; startY += 1) {
    for (let startX = 0; startX < width; startX += 1) {
      const startIndex = startY * width + startX;
      if (binary[startIndex] === 0 || visited[startIndex] === 1) {
        continue;
      }

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

function distance(left: Point, right: Point): number {
  'worklet';
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function buildQuadFromBoundary(boundary: Point[]): DetectedQuad {
  'worklet';
  let topLeft = boundary[0];
  let topRight = boundary[0];
  let bottomRight = boundary[0];
  let bottomLeft = boundary[0];

  let topLeftScore = boundary[0].x + boundary[0].y;
  let topRightScore = boundary[0].x - boundary[0].y;
  let bottomRightScore = boundary[0].x + boundary[0].y;
  let bottomLeftScore = boundary[0].y - boundary[0].x;

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

  return {
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
  };
}

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
    return false;
  }

  if (averageHorizontal < 40 || averageVertical < 40) {
    return false;
  }

  const ratio = averageHorizontal / Math.max(averageVertical, 1);
  if (ratio < 0.8 || ratio > 1.2) {
    return false;
  }

  if (distance(quad.topLeft, quad.bottomRight) < 60) {
    return false;
  }

  return true;
}

function borderBlackRatio(binary: Uint8Array, size: number, border: number): number {
  'worklet';
  let black = 0;
  let total = 0;

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * size;
    for (let x = 0; x < size; x += 1) {
      if (x < border || y < border || x >= size - border || y >= size - border) {
        total += 1;
        black += binary[rowOffset + x];
      }
    }
  }

  return total === 0 ? 0 : black / total;
}

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

  const confidence =
    borderBlack * 0.26 +
    topLeftBlack * 0.22 +
    topRightWhite * 0.14 +
    bottomLeftWhite * 0.14 +
    bottomRightWhite * 0.14 +
    interiorWhite * 0.1;

  return {
    pass:
      borderBlack >= 0.8 &&
      topLeftBlack >= 0.75 &&
      topRightWhite >= 0.7 &&
      bottomLeftWhite >= 0.7 &&
      bottomRightWhite >= 0.7 &&
      interiorWhite >= 0.6,
    confidence,
  };
}

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

export function detectMarkerInSquareFrame(
  rgb: Uint8Array | number[],
  width: number,
  height: number,
): FrameAnalysis | null {
  'worklet';
  const grayscale = toGrayscaleFromRgb(rgb, width, height);
  const blurred = gaussianBlur5x5(grayscale, width, height);
  const binary = thresholdGrayscale(blurred, width, height, computeOtsuThreshold(blurred));
  const components = findComponents(binary, width, height);

  let bestQuad: DetectedQuad | null = null;
  let bestGeometry: MarkerGeometry | null = null;
  let bestBinaryPatch: Uint8Array | null = null;
  let bestGrayscalePatch: Uint8ClampedArray | null = null;
  let bestConfidence = 0;

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component.area < MIN_COMPONENT_AREA || component.area > MAX_COMPONENT_AREA) {
      continue;
    }

    const boxWidth = component.maxX - component.minX + 1;
    const boxHeight = component.maxY - component.minY + 1;
    const aspectRatio = boxWidth / Math.max(boxHeight, 1);
    if (aspectRatio < 0.8 || aspectRatio > 1.2) {
      continue;
    }

    if (component.fillRatio < 0.08 || component.fillRatio > 0.45) {
      continue;
    }

    if (component.boundary.length < 40) {
      continue;
    }

    const quad = buildQuadFromBoundary(component.boundary);
    if (!quadIsUsable(quad)) {
      continue;
    }

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
    const verification = verifyMarkerPatch(oriented.binary);

    if (!verification.pass || verification.confidence <= bestConfidence) {
      continue;
    }

    bestQuad = quad;
    bestGeometry = geometryFromQuad(quad);
    bestBinaryPatch = oriented.binary;
    bestGrayscalePatch = oriented.grayscale;
    bestConfidence = verification.confidence;
  }

  if (
    bestQuad == null ||
    bestGeometry == null ||
    bestBinaryPatch == null ||
    bestGrayscalePatch == null
  ) {
    return null;
  }

  return {
    found: true,
    quad: bestQuad,
    confidence: bestConfidence,
    hash: buildPerceptualHash(bestGrayscalePatch, NORMALIZED_MARKER_SIZE, 16),
    base64: encodeBinaryPatchToPngBase64(bestBinaryPatch, NORMALIZED_MARKER_SIZE),
    geometry: bestGeometry,
  };
}

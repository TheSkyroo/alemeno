const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export const PROCESSING_FRAME_SIZE = 600;
export const NORMALIZED_MARKER_SIZE = 300;

export function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, value));
}

export function toGrayscaleFromRgb(
  rgb: Uint8Array | number[],
  width: number,
  height: number,
): Uint8ClampedArray {
  'worklet';
  const grayscale = new Uint8ClampedArray(width * height);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 3;
    grayscale[index] = Math.round(
      rgb[offset] * 0.299 + rgb[offset + 1] * 0.587 + rgb[offset + 2] * 0.114,
    );
  }

  return grayscale;
}

export function gaussianBlur5x5(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  'worklet';
  const kernel = [1, 4, 6, 4, 1];
  const horizontal = new Float32Array(width * height);
  const output = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -2; k <= 2; k += 1) {
        const sampleX = clamp(x + k, 0, width - 1);
        sum += grayscale[y * width + sampleX] * kernel[k + 2];
      }
      horizontal[y * width + x] = sum / 16;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -2; k <= 2; k += 1) {
        const sampleY = clamp(y + k, 0, height - 1);
        sum += horizontal[sampleY * width + x] * kernel[k + 2];
      }
      output[y * width + x] = Math.round(sum / 16);
    }
  }

  return output;
}

export function computeOtsuThreshold(grayscale: Uint8ClampedArray): number {
  'worklet';
  const histogram = new Int32Array(256);
  const total = grayscale.length;

  for (let index = 0; index < total; index += 1) {
    histogram[grayscale[index]] += 1;
  }

  let sum = 0;
  for (let level = 0; level < 256; level += 1) {
    sum += level * histogram[level];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = -1;
  let threshold = 127;

  for (let level = 0; level < 256; level += 1) {
    weightBackground += histogram[level];
    if (weightBackground === 0) {
      continue;
    }

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) {
      break;
    }

    sumBackground += level * histogram[level];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const meanDelta = meanBackground - meanForeground;
    const variance = weightBackground * weightForeground * meanDelta * meanDelta;

    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = level;
    }
  }

  return threshold;
}

export function thresholdGrayscale(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): Uint8Array {
  'worklet';
  const binary = new Uint8Array(width * height);

  for (let index = 0; index < width * height; index += 1) {
    binary[index] = grayscale[index] <= threshold ? 1 : 0;
  }

  return binary;
}

export function blackRatio(
  binary: Uint8Array,
  size: number,
  startX: number,
  startY: number,
  regionWidth: number,
  regionHeight: number,
): number {
  'worklet';
  let blackPixels = 0;
  let totalPixels = 0;

  const endX = clamp(startX + regionWidth, 0, size);
  const endY = clamp(startY + regionHeight, 0, size);
  const clampedStartX = clamp(startX, 0, size);
  const clampedStartY = clamp(startY, 0, size);

  for (let y = clampedStartY; y < endY; y += 1) {
    const rowOffset = y * size;
    for (let x = clampedStartX; x < endX; x += 1) {
      totalPixels += 1;
      blackPixels += binary[rowOffset + x];
    }
  }

  return totalPixels === 0 ? 0 : blackPixels / totalPixels;
}

export function whiteRatio(
  binary: Uint8Array,
  size: number,
  startX: number,
  startY: number,
  regionWidth: number,
  regionHeight: number,
): number {
  'worklet';
  return 1 - blackRatio(binary, size, startX, startY, regionWidth, regionHeight);
}

export function rotateSquareBinary(
  binary: Uint8Array,
  size: number,
  quarterTurns: number,
): Uint8Array {
  'worklet';
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) {
    return binary.slice();
  }

  const rotated = new Uint8Array(binary.length);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceIndex = y * size + x;
      let targetX = x;
      let targetY = y;

      if (turns === 1) {
        targetX = size - 1 - y;
        targetY = x;
      } else if (turns === 2) {
        targetX = size - 1 - x;
        targetY = size - 1 - y;
      } else {
        targetX = y;
        targetY = size - 1 - x;
      }

      rotated[targetY * size + targetX] = binary[sourceIndex];
    }
  }

  return rotated;
}

export function rotateSquareGrayscale(
  grayscale: Uint8ClampedArray,
  size: number,
  quarterTurns: number,
): Uint8ClampedArray {
  'worklet';
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) {
    return grayscale.slice();
  }

  const rotated = new Uint8ClampedArray(grayscale.length);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceIndex = y * size + x;
      let targetX = x;
      let targetY = y;

      if (turns === 1) {
        targetX = size - 1 - y;
        targetY = x;
      } else if (turns === 2) {
        targetX = size - 1 - x;
        targetY = size - 1 - y;
      } else {
        targetX = y;
        targetY = size - 1 - x;
      }

      rotated[targetY * size + targetX] = grayscale[sourceIndex];
    }
  }

  return rotated;
}

export function buildPerceptualHash(
  grayscale: Uint8ClampedArray,
  size: number,
  grid: number,
): string {
  'worklet';
  const samples: number[] = [];
  const cellSize = size / grid;
  let sampleSum = 0;

  for (let gridY = 0; gridY < grid; gridY += 1) {
    for (let gridX = 0; gridX < grid; gridX += 1) {
      const startX = Math.floor(gridX * cellSize);
      const startY = Math.floor(gridY * cellSize);
      const endX = gridX === grid - 1 ? size : Math.floor((gridX + 1) * cellSize);
      const endY = gridY === grid - 1 ? size : Math.floor((gridY + 1) * cellSize);

      let count = 0;
      let cellSum = 0;
      for (let y = startY; y < endY; y += 1) {
        const rowOffset = y * size;
        for (let x = startX; x < endX; x += 1) {
          count += 1;
          cellSum += grayscale[rowOffset + x];
        }
      }

      const sample = count === 0 ? 0 : cellSum / count;
      samples.push(sample);
      sampleSum += sample;
    }
  }

  const mean = sampleSum / Math.max(samples.length, 1);
  const hashBits: string[] = new Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    hashBits[index] = samples[index] < mean ? '1' : '0';
  }

  return hashBits.join('');
}

function uint32ToBytes(value: number): number[] {
  'worklet';
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ];
}

function adler32(data: number[]): number {
  'worklet';
  let a = 1;
  let b = 0;

  for (let index = 0; index < data.length; index += 1) {
    a = (a + data[index]) % 65521;
    b = (b + a) % 65521;
  }

  return ((b << 16) | a) >>> 0;
}

function crc32(data: number[]): number {
  'worklet';
  let crc = 0xffffffff;

  for (let index = 0; index < data.length; index += 1) {
    crc ^= data[index];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(chunkType: string, chunkData: number[]): number[] {
  'worklet';
  const typeBytes = [
    chunkType.charCodeAt(0),
    chunkType.charCodeAt(1),
    chunkType.charCodeAt(2),
    chunkType.charCodeAt(3),
  ];
  const checksum = crc32(typeBytes.concat(chunkData));

  return uint32ToBytes(chunkData.length)
    .concat(typeBytes)
    .concat(chunkData)
    .concat(uint32ToBytes(checksum));
}

function deflateStore(data: number[]): number[] {
  'worklet';
  const bytes: number[] = [0x78, 0x01];
  let offset = 0;

  while (offset < data.length) {
    const remaining = data.length - offset;
    const blockLength = Math.min(65535, remaining);
    const isFinal = offset + blockLength >= data.length ? 1 : 0;

    bytes.push(isFinal);
    bytes.push(blockLength & 255);
    bytes.push((blockLength >>> 8) & 255);

    const inverseLength = 65535 - blockLength;
    bytes.push(inverseLength & 255);
    bytes.push((inverseLength >>> 8) & 255);

    for (let index = 0; index < blockLength; index += 1) {
      bytes.push(data[offset + index]);
    }

    offset += blockLength;
  }

  return bytes.concat(uint32ToBytes(adler32(data)));
}

function base64Encode(bytes: number[]): string {
  'worklet';
  const segments: string[] = [];

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const chunk = (first << 16) | (second << 8) | third;

    segments.push(BASE64_ALPHABET[(chunk >>> 18) & 63]);
    segments.push(BASE64_ALPHABET[(chunk >>> 12) & 63]);
    segments.push(index + 1 < bytes.length ? BASE64_ALPHABET[(chunk >>> 6) & 63] : '=');
    segments.push(index + 2 < bytes.length ? BASE64_ALPHABET[chunk & 63] : '=');
  }

  return segments.join('');
}

export function encodeBinaryPatchToPngBase64(binary: Uint8Array, size: number): string {
  'worklet';
  const rawImageData: number[] = [];

  for (let y = 0; y < size; y += 1) {
    rawImageData.push(0);
    const rowOffset = y * size;
    for (let x = 0; x < size; x += 1) {
      rawImageData.push(binary[rowOffset + x] === 1 ? 0 : 255);
    }
  }

  const ihdrData = uint32ToBytes(size)
    .concat(uint32ToBytes(size))
    .concat([8, 0, 0, 0, 0]);
  const idatData = deflateStore(rawImageData);

  const pngBytes = PNG_SIGNATURE.concat(createChunk('IHDR', ihdrData))
    .concat(createChunk('IDAT', idatData))
    .concat(createChunk('IEND', []));

  return base64Encode(pngBytes);
}

export function hammingDistance(left: string, right: string): number {
  let distance = 0;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      distance += 1;
    }
  }

  return distance;
}

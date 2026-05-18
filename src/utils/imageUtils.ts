/**
 * imageUtils.ts
 *
 * Low-level image processing utilities used by the marker detection pipeline.
 * All exported functions that are called inside a VisionCamera frame processor
 * are annotated with the `'worklet'` directive so they run on the Reanimated
 * worklet thread without JS-bridge overhead.
 *
 * Processing pipeline overview:
 *  RGB input
 *    → toGrayscaleFromRgb     (luminance conversion)
 *    → gaussianBlur5x5        (noise reduction)
 *    → computeOtsuThreshold   (automatic binarisation threshold)
 *    → thresholdGrayscale     (binary image: 1 = dark, 0 = light)
 *
 * Additional utilities:
 *  blackRatio / whiteRatio    – region pixel-ratio analysis
 *  rotateSquareBinary / rotateSquareGrayscale – 90° rotations
 *  buildPerceptualHash        – 256-bit average-hash for duplicate detection
 *  encodeBinaryPatchToPngBase64 – pure-JS PNG encoder (no native deps)
 *  hammingDistance            – bit-string distance for hash comparison
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Standard PNG file signature (8 bytes). */
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Base64 character alphabet (RFC 4648). */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Side length (px) of the square frame passed to the detection pipeline. */
export const PROCESSING_FRAME_SIZE = 600;

/** Side length (px) of the normalised, perspective-corrected marker patch. */
export const NORMALIZED_MARKER_SIZE = 300;

// ── General helpers ───────────────────────────────────────────────────────────

/**
 * Clamps `value` to the inclusive range [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, value));
}

// ── Colour space conversion ───────────────────────────────────────────────────

/**
 * Converts a packed RGB byte array (3 bytes per pixel) to a grayscale
 * `Uint8ClampedArray` using the standard luminance formula:
 *   Y = 0.299·R + 0.587·G + 0.114·B
 */
export function toGrayscaleFromRgb(
  rgb: Uint8Array | number[],
  width: number,
  height: number,
): Uint8ClampedArray {
  'worklet';
  const grayscale = new Uint8ClampedArray(width * height);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 3; // Each pixel is 3 consecutive bytes: R, G, B
    grayscale[index] = Math.round(
      rgb[offset] * 0.299 + rgb[offset + 1] * 0.587 + rgb[offset + 2] * 0.114,
    );
  }

  return grayscale;
}

// ── Blur ──────────────────────────────────────────────────────────────────────

/**
 * Applies a separable 5×5 Gaussian blur (kernel = [1, 4, 6, 4, 1] / 16)
 * to a grayscale image using two 1-D passes (horizontal then vertical).
 *
 * Pixels outside the image boundary are clamped to the nearest edge pixel.
 */
export function gaussianBlur5x5(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  'worklet';
  const kernel = [1, 4, 6, 4, 1]; // Binomial kernel; sum = 16
  const horizontal = new Float32Array(width * height);
  const output = new Uint8ClampedArray(width * height);

  // Horizontal pass
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

  // Vertical pass
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

// ── Thresholding ──────────────────────────────────────────────────────────────

/**
 * Computes the Otsu optimal binarisation threshold for a grayscale image.
 *
 * Otsu's method maximises the inter-class variance between dark and light
 * pixel groups, yielding an adaptive threshold that works across varying
 * lighting conditions without any hand-tuned constant.
 *
 * @returns An integer threshold in [0, 255].
 */
export function computeOtsuThreshold(grayscale: Uint8ClampedArray): number {
  'worklet';
  const histogram = new Int32Array(256);
  const total = grayscale.length;

  // Build intensity histogram
  for (let index = 0; index < total; index += 1) {
    histogram[grayscale[index]] += 1;
  }

  // Pre-compute the weighted sum of all intensities
  let sum = 0;
  for (let level = 0; level < 256; level += 1) {
    sum += level * histogram[level];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = -1;
  let threshold = 127; // Fallback midpoint

  for (let level = 0; level < 256; level += 1) {
    weightBackground += histogram[level];
    if (weightBackground === 0) {
      continue;
    }

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) {
      break; // All pixels accounted for in the background class
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

/**
 * Converts a grayscale image to a binary (0/1) image.
 * Pixels with intensity ≤ threshold are set to 1 (dark/foreground);
 * all others are set to 0 (light/background).
 */
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

// ── Region analysis ───────────────────────────────────────────────────────────

/**
 * Returns the fraction of pixels within a rectangular region that are dark
 * (binary value = 1).
 *
 * @param binary  - Flat binary image array (1 = dark, 0 = light).
 * @param size    - Side length of the (square) image.
 * @param startX  - Left edge of the region (may be clamped).
 * @param startY  - Top edge of the region (may be clamped).
 * @param regionWidth  - Width of the region.
 * @param regionHeight - Height of the region.
 */
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
      blackPixels += binary[rowOffset + x]; // 1 counts as a black pixel
    }
  }

  return totalPixels === 0 ? 0 : blackPixels / totalPixels;
}

/**
 * Complement of `blackRatio` — returns the fraction of light pixels in a region.
 */
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

// ── Rotation ──────────────────────────────────────────────────────────────────

/**
 * Rotates a square binary image by `quarterTurns * 90°` clockwise.
 * A copy is always returned; the original is not mutated.
 */
export function rotateSquareBinary(
  binary: Uint8Array,
  size: number,
  quarterTurns: number,
): Uint8Array {
  'worklet';
  const turns = ((quarterTurns % 4) + 4) % 4; // Normalise to [0, 3]

  if (turns === 0) {
    return binary.slice(); // No rotation needed
  }

  const rotated = new Uint8Array(binary.length);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceIndex = y * size + x;
      let targetX = x;
      let targetY = y;

      if (turns === 1) {
        // 90° clockwise
        targetX = size - 1 - y;
        targetY = x;
      } else if (turns === 2) {
        // 180°
        targetX = size - 1 - x;
        targetY = size - 1 - y;
      } else {
        // 270° clockwise (= 90° counter-clockwise)
        targetX = y;
        targetY = size - 1 - x;
      }

      rotated[targetY * size + targetX] = binary[sourceIndex];
    }
  }

  return rotated;
}

/**
 * Same as `rotateSquareBinary` but operates on a `Uint8ClampedArray`
 * grayscale image so both binary and grayscale patches can be
 * rotated in sync by `orientMarkerPatch`.
 */
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

// ── Perceptual hashing ────────────────────────────────────────────────────────

/**
 * Builds an average (pHash-style) perceptual hash of a grayscale image.
 *
 * The image is divided into a `grid × grid` array of cells.  The mean
 * intensity of each cell is compared to the overall mean; cells below the
 * mean are encoded as '1', cells above as '0'.
 *
 * The resulting `grid²`-character binary string is used to detect near-
 * duplicate captures via `hammingDistance`.
 *
 * @param grid - Number of cells along each axis (e.g. 16 produces 256 bits).
 */
export function buildPerceptualHash(
  grayscale: Uint8ClampedArray,
  size: number,
  grid: number,
): string {
  'worklet';
  const samples: number[] = [];
  const cellSize = size / grid;
  let sampleSum = 0;

  // Compute the mean intensity for each cell
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

  // Encode: '1' if below mean (darker), '0' if above mean (lighter)
  const mean = sampleSum / Math.max(samples.length, 1);
  const hashBits: string[] = new Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    hashBits[index] = samples[index] < mean ? '1' : '0';
  }

  return hashBits.join('');
}

// ── PNG encoding ──────────────────────────────────────────────────────────────

/**
 * Packs a 32-bit unsigned integer into an array of 4 bytes (big-endian).
 * Used when building PNG chunk headers.
 */
function uint32ToBytes(value: number): number[] {
  'worklet';
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ];
}

/**
 * Computes the Adler-32 checksum of a byte array.
 * Required by the zlib deflate container used inside PNG IDAT chunks.
 */
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

/**
 * Computes the CRC-32 checksum of a byte array.
 * Required for every PNG chunk's integrity field.
 */
function crc32(data: number[]): number {
  'worklet';
  let crc = 0xffffffff;

  for (let index = 0; index < data.length; index += 1) {
    crc ^= data[index];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask); // CRC-32 polynomial
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Wraps `chunkData` in a PNG chunk with the given 4-character `chunkType`.
 * Format: [length 4B][type 4B][data][CRC 4B]
 */
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

/**
 * Wraps `data` in a "stored" (non-compressed) zlib deflate stream.
 * Using store mode avoids the need for a full DEFLATE implementation
 * while still producing a spec-compliant PNG.
 */
function deflateStore(data: number[]): number[] {
  'worklet';
  // zlib header: CMF=0x78 (deflate, window=32 KB), FLG=0x01 (no dict, check bits)
  const bytes: number[] = [0x78, 0x01];
  let offset = 0;

  while (offset < data.length) {
    const remaining = data.length - offset;
    const blockLength = Math.min(65535, remaining); // Max DEFLATE stored block size
    const isFinal = offset + blockLength >= data.length ? 1 : 0;

    // BFINAL + BTYPE=00 (stored)
    bytes.push(isFinal);

    // LEN and NLEN (one's complement of LEN)
    bytes.push(blockLength & 255);
    bytes.push((blockLength >>> 8) & 255);
    const inverseLength = 65535 - blockLength;
    bytes.push(inverseLength & 255);
    bytes.push((inverseLength >>> 8) & 255);

    // Raw data block
    for (let index = 0; index < blockLength; index += 1) {
      bytes.push(data[offset + index]);
    }

    offset += blockLength;
  }

  // Adler-32 checksum of the original (uncompressed) data
  return bytes.concat(uint32ToBytes(adler32(data)));
}

/**
 * Encodes a byte array as a Base64 string (RFC 4648).
 * Pads to a multiple of 4 characters with '=' as required.
 */
function base64Encode(bytes: number[]): string {
  'worklet';
  const segments: string[] = [];

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;

    // Pack three bytes into one 24-bit integer
    const chunk = (first << 16) | (second << 8) | third;

    segments.push(BASE64_ALPHABET[(chunk >>> 18) & 63]);
    segments.push(BASE64_ALPHABET[(chunk >>> 12) & 63]);
    segments.push(index + 1 < bytes.length ? BASE64_ALPHABET[(chunk >>> 6) & 63] : '=');
    segments.push(index + 2 < bytes.length ? BASE64_ALPHABET[chunk & 63] : '=');
  }

  return segments.join('');
}

/**
 * Encodes a flat binary (0/1) patch as a grayscale PNG and returns it
 * as a Base64 string suitable for use in a `data:image/png;base64,…` URI.
 *
 * Binary 1 (dark/foreground) → pixel value 0 (black)
 * Binary 0 (light/background) → pixel value 255 (white)
 *
 * The PNG is a 1-channel (grayscale, bit-depth 8) image with a stored-mode
 * IDAT block — fully compatible with React Native's `<Image>` component.
 */
export function encodeBinaryPatchToPngBase64(binary: Uint8Array, size: number): string {
  'worklet';
  const rawImageData: number[] = [];

  // Build raw PNG scan-line data (filter byte 0 = None, then pixel bytes)
  for (let y = 0; y < size; y += 1) {
    rawImageData.push(0); // PNG filter type: None
    const rowOffset = y * size;
    for (let x = 0; x < size; x += 1) {
      rawImageData.push(binary[rowOffset + x] === 1 ? 0 : 255);
    }
  }

  // IHDR: width, height, bit depth (8), color type (0 = grayscale), compression, filter, interlace
  const ihdrData = uint32ToBytes(size)
    .concat(uint32ToBytes(size))
    .concat([8, 0, 0, 0, 0]);

  const idatData = deflateStore(rawImageData);

  // Assemble the complete PNG byte stream
  const pngBytes = PNG_SIGNATURE
    .concat(createChunk('IHDR', ihdrData))
    .concat(createChunk('IDAT', idatData))
    .concat(createChunk('IEND', []));

  return base64Encode(pngBytes);
}

// ── Hash comparison ───────────────────────────────────────────────────────────

/**
 * Counts the number of positions where two equal-length bit strings differ
 * (Hamming distance).  Strings of unequal length are compared up to the
 * longer string's length; missing characters count as a mismatch.
 *
 * Used to detect near-duplicate captures: a distance below 12 (out of 256)
 * suggests the same marker viewed from a very similar angle.
 */
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

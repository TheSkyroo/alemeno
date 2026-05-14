import React from 'react';
import {StyleSheet, View} from 'react-native';
import Svg, {Line, Polygon, Rect} from 'react-native-svg';
import type {DetectedQuad} from '../types';

type MarkerOverlayProps = {
  active: boolean;
  detectedQuad: DetectedQuad | null;
  frameSize: number;
  guideSize: number;
  processingFrameSize: number;
};

const CORNER_LENGTH = 28;

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
  const guideOffset = (frameSize - guideSize) / 2;
  const guideColor = active ? '#37e58d' : 'rgba(230, 244, 241, 0.42)';
  const polygonPoints =
    detectedQuad == null
      ? null
      : buildPolygonPoints(detectedQuad, frameSize, processingFrameSize);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg height={frameSize} width={frameSize}>
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

const styles = StyleSheet.create({});

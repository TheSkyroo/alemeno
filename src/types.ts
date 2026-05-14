export type Point = {
  x: number;
  y: number;
};

export type DetectedQuad = {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
};

export type MarkerGeometry = {
  area: number;
  centerX: number;
  centerY: number;
};

export type FrameAnalysis = {
  found: true;
  quad: DetectedQuad;
  confidence: number;
  hash: string;
  base64: string;
  geometry: MarkerGeometry;
};

export type MarkerCapture = {
  id: string;
  label: string;
  base64: string;
  hash: string;
  confidence: number;
  geometry: MarkerGeometry;
  quad: DetectedQuad;
  capturedAt: number;
};

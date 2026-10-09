// TypeScript type declarations for Sketchpiler diagram-view SVG layout and rendering.
export interface BoxDims {
  width: number;
  height: number;
  lines: string[];
}

export interface ViewBoxResult {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface ResolvedDiagramLayout {
  positions: Record<string, { x: number; y: number }>;
  edgeSides: Record<string, { fromSide?: string; toSide?: string }>;
}

export interface RenderDiagramOptions {
  padding?: number;
  title?: string;
}

export function escapeXml(val: any): string;

export function wrapText(text: string, maxChars?: number): string[];

export function computeBoxDims(node: { id: string; type: string; text: string }): BoxDims;

export function resolveDiagramLayout(
  representation: { nodes: any[]; edges: any[] },
  savedPositions?: Record<string, { x: number; y: number }> | null,
  savedEdgeSides?: Record<string, { fromSide?: string; toSide?: string }> | null
): ResolvedDiagramLayout;

export function computeDiagramViewBox(
  representation: { nodes: any[]; edges: any[] },
  positions: Record<string, { x: number; y: number }>,
  dimsMap: Map<string, { width: number; height: number }>,
  padding?: number
): ViewBoxResult;

export function renderDiagramSvg(
  representation: { nodes: any[]; edges: any[] },
  positions?: Record<string, { x: number; y: number }>,
  edgeSides?: Record<string, { fromSide?: string; toSide?: string }>,
  options?: RenderDiagramOptions
): string;

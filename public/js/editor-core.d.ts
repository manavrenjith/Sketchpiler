// TypeScript type declarations for Sketchpiler canvas editor core state and actions.
export interface BoxPosition {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface BoxDimensions {
  width: number;
  height: number;
}

export interface LayoutOptions {
  boxWidth?: number;
  boxHeight?: number;
  hSpacing?: number;
  vSpacing?: number;
  startX?: number;
  startY?: number;
  direction?: 'top-down' | 'left-right';
  spacing?: 'compact' | 'normal' | 'roomy';
}

export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';

export interface EdgeSides {
  fromSide?: EdgeSide;
  toSide?: EdgeSide;
}

export interface EdgePathResult {
  path: string;
  labelPoint: { x: number; y: number };
}

export interface HistoryState {
  representation: any;
  positions: Record<string, BoxPosition>;
  edgeSides?: Record<string, EdgeSides>;
}

export interface HistoryManager {
  push(state: HistoryState): void;
  undo(): HistoryState;
  redo(): HistoryState;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly state: HistoryState;
}

export function getNextBoxId(nodes: any[]): string;

export function autoLayout(
  representation: any,
  options?: LayoutOptions
): Record<string, BoxPosition>;

export function isBackEdge(edge: any, positions: Record<string, BoxPosition>): boolean;

export function getBoxSidePoint(box: BoxPosition, side: EdgeSide): { x: number; y: number };

export function edgePath(
  fromBox: BoxPosition,
  toBox: BoxPosition,
  isBackEdge?: boolean,
  fromSide?: EdgeSide | null,
  toSide?: EdgeSide | null,
  label?: string | null
): EdgePathResult;

export function createHistory(initial: HistoryState): HistoryManager;

export function addBox(
  state: HistoryState,
  kind?: string,
  text?: string | null,
  pos?: BoxPosition | null
): HistoryState;

export function deleteBox(state: HistoryState, id: string): HistoryState;

export function setBoxText(state: HistoryState, id: string, text: string): HistoryState;

export function setBoxKind(state: HistoryState, id: string, kind: string): HistoryState;

export function addEdge(
  state: HistoryState,
  from: string,
  to: string,
  label?: string | null,
  sides?: EdgeSides
): {
  success: boolean;
  reason?: string;
  state: HistoryState;
  suggestedLabel?: string | null;
};

export function deleteEdge(state: HistoryState, edgeIdentifier: number | { from: string; to: string }): HistoryState;

export function setEdgeLabel(
  state: HistoryState,
  edgeIdentifier: number | { from: string; to: string },
  label: string | null
): HistoryState;

export function setEdgeEnds(
  state: HistoryState,
  edgeIndex: number,
  newFrom: string,
  newTo: string
): {
  success: boolean;
  reason?: string;
  state: HistoryState;
};

export function clampZoom(zoom: number, min?: number, max?: number): number;

export function zoomAroundPoint(
  currentZoom: number,
  newZoomRaw: number,
  pointerScreenX: number,
  pointerScreenY: number,
  panX: number,
  panY: number,
  minZoom?: number,
  maxZoom?: number
): { zoom: number; panX: number; panY: number };

export function screenToDiagram(
  screenX: number,
  screenY: number,
  panX: number,
  panY: number,
  zoom: number
): { x: number; y: number };

export function diagramToScreen(
  diagramX: number,
  diagramY: number,
  panX: number,
  panY: number,
  zoom: number
): { x: number; y: number };

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export function computeBounds(
  positions: Record<string, BoxPosition>,
  defaultDims?: BoxDimensions
): Bounds;

export function fitToBounds(
  bounds: Bounds,
  viewportWidth: number,
  viewportHeight: number,
  options?: { padding?: number; minZoom?: number; maxZoom?: number }
): { zoom: number; panX: number; panY: number };

export function duplicateBox(
  state: HistoryState,
  nodeId: string,
  offset?: { x: number; y: number }
): HistoryState & { newNode?: any };

export function nudgeBox(
  state: HistoryState,
  nodeId: string,
  dx: number,
  dy: number
): HistoryState;

export function boxesInRect(
  positions: Record<string, BoxPosition>,
  dimsMap: any,
  rect: any
): string[];

export function alignBoxes(
  positions: Record<string, BoxPosition>,
  dimsMap: any,
  nodeIds: string[],
  alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
): Record<string, BoxPosition>;

export function distributeBoxes(
  positions: Record<string, BoxPosition>,
  dimsMap: any,
  nodeIds: string[],
  direction: 'horizontal' | 'vertical'
): Record<string, BoxPosition>;

export function snapToGrid(
  pos: BoxPosition,
  gridSize?: number
): BoxPosition;

export function snapPositionsToGrid(
  positions: Record<string, BoxPosition>,
  nodeIds?: string[] | null,
  gridSize?: number
): Record<string, BoxPosition>;

export function moveGroup(
  positions: Record<string, BoxPosition>,
  nodeIds: string[],
  dx: number,
  dy: number
): Record<string, BoxPosition>;

export function duplicateGroup(
  state: HistoryState,
  nodeIds: string[],
  offset?: { x: number; y: number }
): HistoryState & { newIds: string[] };

export function deleteGroup(
  state: HistoryState,
  nodeIds: string[]
): HistoryState;

export function shouldPan(
  tool: 'select' | 'hand',
  isSpacePressed: boolean,
  button: number
): boolean;

export function getToolCursor(
  tool: 'select' | 'hand',
  isSpacePressed: boolean,
  isPanning: boolean
): string;

export function isEditableElement(
  target: { tagName?: string; isContentEditable?: boolean } | null | undefined
): boolean;

export function getNearestSide(
  boxPos: BoxPosition,
  boxDims: BoxDimensions | undefined,
  point: { x: number; y: number }
): EdgeSide;

export function pickEdgeSides(
  edge: { from: string; to: string; label?: string | null },
  fromNode?: { id: string; type: string } | null,
  toNode?: { id: string; type: string } | null,
  fromPos?: BoxPosition | null,
  toPos?: BoxPosition | null,
  context?: { usedFromSides?: Set<EdgeSide> | Set<string>; usedToSides?: Set<EdgeSide> | Set<string> }
): { fromSide: EdgeSide; toSide: EdgeSide };
export function computeAllEdgeSides(
  representation: any,
  positions: Record<string, BoxPosition>
): Record<string, { fromSide: EdgeSide; toSide: EdgeSide }>;

export function getDownloadPseudocodeFilename(): string;

export function isDownloadEnabled(pseudocode?: string | null): boolean;

export function getDownloadButtonTitle(enabledOrPseudocode?: boolean | string | null): string;

export function formatSaveStatus(
  lastSavedTimeMs: number | null | undefined,
  nowMs?: number
): string;

export function validateRepresentation(rep: any): {
  valid: boolean;
  reason?: string;
};

export type EditorLoadDecision = 'restore-autosave' | 'load-result' | 'load-sample';

export interface EditorLoadResult {
  action: EditorLoadDecision;
  decision: EditorLoadDecision;
  reason: string;
}

export function generateSourceId(): string;

export function decideEditorLoad(options?: {
  arrivedFromReview?: boolean;
  resultSourceId?: string | null;
  autosaveSourceId?: string | null;
  hasResult?: boolean;
  hasAutosave?: boolean;
}): EditorLoadResult;

export function getSourceChipLabel(options: {
  decision: EditorLoadDecision;
  sourceFlag?: string | null;
}): string;

export const PREVIOUS_AUTOSAVE_KEY: string;

export function savePreviousSlot(
  storage: { setItem: (key: string, value: string) => void } | null | undefined,
  state: any
): void;

export function getPreviousSlot(
  storage: { getItem: (key: string) => string | null } | null | undefined
): any;

export function swapAutosaveWithPrevious(
  currentActive: any,
  previousState: any
): { newActive: any; newPrevious: any };

export function applyDoneRoundTrip(
  editorState: any,
  sourceId: string
): any;

export function loadLegacyDiagram(raw: any): {
  representation: any;
  positions: any;
  edgeSides: any;
  sourceId: string | null;
};

// Core TypeScript type definitions for Sketchpiler flowchart nodes, edges, and IR.
export type NodeType = 'start' | 'end' | 'proc' | 'io' | 'dec';

export interface FlowchartNode {
  id: string;
  type: NodeType;
  text: string;
  uncertain: boolean;
}

export interface FlowchartEdge {
  from: string;
  to: string;
  label: string | null;
  uncertain: boolean;
}

export interface FlowchartRepresentation {
  schemaVersion: 1;
  type: 'flowchart';
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
}

export interface ParseResult {
  representation: FlowchartRepresentation;
  warnings: string[];
  truncated: boolean;
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  confidence: number;
}

export interface GenerateResult {
  pseudocode: string;
  warnings: string[];
}

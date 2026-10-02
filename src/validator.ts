// Validates flowchart structural rules: single start, termination, and connectivity.
import { AppError } from './errors.js';
import { FlowchartRepresentation, ValidationResult } from './types.js';

export function validateRepresentation(
  rep: FlowchartRepresentation,
  extraWarnings: string[] = []
): ValidationResult {
  if (!rep || !rep.nodes || rep.nodes.length === 0) {
    throw new AppError('empty_diagram', 'Flowchart contains no nodes');
  }

  const structuralWarnings: string[] = [];
  const nodeMap = new Map<string, (typeof rep.nodes)[0]>();

  for (const node of rep.nodes) {
    nodeMap.set(node.id, node);
  }

  // 1. Exactly one start; at least one end
  const startNodes = rep.nodes.filter(n => n.type === 'start');
  const endNodes = rep.nodes.filter(n => n.type === 'end');

  if (startNodes.length === 0) {
    structuralWarnings.push('No start node found in diagram');
  } else if (startNodes.length > 1) {
    structuralWarnings.push(`Multiple start nodes found: ${startNodes.map(n => n.id).join(', ')}`);
  }

  if (endNodes.length === 0) {
    structuralWarnings.push('No end node found in diagram');
  }

  // 2. Edges to unknown nodes
  const outgoingMap = new Map<string, typeof rep.edges>();
  for (const edge of rep.edges) {
    if (!nodeMap.has(edge.from)) {
      structuralWarnings.push(`Edge references unknown source node: "${edge.from}" (to "${edge.to}")`);
    }
    if (!nodeMap.has(edge.to)) {
      structuralWarnings.push(`Edge references unknown target node: "${edge.to}" (from "${edge.from}")`);
    }

    if (!outgoingMap.has(edge.from)) {
      outgoingMap.set(edge.from, []);
    }
    outgoingMap.get(edge.from)!.push(edge);
  }

  // 3. Every dec node has at least two outgoing edges
  const decNodes = rep.nodes.filter(n => n.type === 'dec');
  for (const dec of decNodes) {
    const outEdges = outgoingMap.get(dec.id) || [];
    if (outEdges.length < 2) {
      structuralWarnings.push(`Decision node ${dec.id} has fewer than 2 outgoing edges (${outEdges.length} found)`);
    }
  }

  // 4. No orphan nodes (unreachable from start)
  if (startNodes.length > 0) {
    const reachable = new Set<string>();
    const queue: string[] = [];

    for (const start of startNodes) {
      reachable.add(start.id);
      queue.push(start.id);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const edges = outgoingMap.get(current) || [];
      for (const edge of edges) {
        if (nodeMap.has(edge.to) && !reachable.has(edge.to)) {
          reachable.add(edge.to);
          queue.push(edge.to);
        }
      }
    }

    for (const node of rep.nodes) {
      if (!reachable.has(node.id)) {
        structuralWarnings.push(`Orphan node unreachable from start: ${node.id} (${node.type} "${node.text}")`);
      }
    }
  }

  const allWarnings = [...extraWarnings, ...structuralWarnings];

  // 5. Confidence score computation
  // Starts at 1.0; deducted by warnings and uncertain flags.
  let confidence = 1.0;
  confidence -= allWarnings.length * 0.1;

  let uncertainCount = 0;
  for (const node of rep.nodes) {
    if (node.uncertain) uncertainCount++;
  }
  for (const edge of rep.edges) {
    if (edge.uncertain) uncertainCount++;
  }
  confidence -= uncertainCount * 0.05;

  confidence = Math.max(0.0, Math.min(1.0, Math.round(confidence * 100) / 100));

  return {
    valid: structuralWarnings.length === 0,
    warnings: allWarnings,
    confidence,
  };
}

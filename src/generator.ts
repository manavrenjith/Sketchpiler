// Generates structured pseudocode from flowchart intermediate representations.
import { FlowchartEdge, FlowchartNode, FlowchartRepresentation, GenerateResult } from './types.js';

function isAssignment(stmt: string): boolean {
  const trimmed = stmt.trim();
  // Must contain '=' and not start with comparison operators (==, <=, >=, !=)
  // Typically: <identifier> = <expression> or <target> = <expression>
  const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_\.\[\]]*)\s*=(?!=)\s*(.+)$/);
  return Boolean(match);
}

function splitProcStatements(text: string): string[] {
  // 1. Split on ';'
  const semiParts = text.split(';').map(s => s.trim()).filter(Boolean);
  const result: string[] = [];

  for (const part of semiParts) {
    // 2. Check if part can be split on comma: only if EVERY comma-separated segment is an assignment
    if (part.includes(',')) {
      const commaParts = part.split(',').map(s => s.trim()).filter(Boolean);
      if (commaParts.length > 1 && commaParts.every(isAssignment)) {
        result.push(...commaParts);
        continue;
      }
    }
    result.push(part);
  }

  return result;
}

function formatIoNode(text: string): string {
  const trimmed = text.trim();
  const inputMatch = trimmed.match(/^(?:Input|Read)\s+(.*)$/i);
  if (inputMatch) {
    return `INPUT ${inputMatch[1].trim()}`;
  }
  const outputMatch = trimmed.match(/^(?:Display|Print|Output)\s+(.*)$/i);
  if (outputMatch) {
    return `OUTPUT ${outputMatch[1].trim()}`;
  }
  return trimmed;
}

// normalizeCondition: keep in sync with the other copy
export function normalizeCondition(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const original = text.trim();
  if (!original) return '';

  let s = original;

  // Case-insensitively remove ONE leading "if" or "while" only when it is a whole word
  // (followed by whitespace or "("). "iffy > 3" and "if" alone stay unchanged.
  s = s.replace(/^(?:if|while)(?=\s|\()/i, '').trim();

  // Remove trailing "?" and spaces
  s = s.replace(/[\s?]*\?[\s?]*$/, '').trim();

  // Remove ONE pair of outer parentheses only when they are balanced and wrap the whole condition
  if (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') {
        depth++;
      } else if (s[i] === ')') {
        depth--;
        if (depth === 0 && i < s.length - 1) {
          wrapsAll = false;
          break;
        }
      }
    }
    if (wrapsAll && depth === 0) {
      s = s.slice(1, -1).trim();
    }
  }

  // Map the Unicode symbols ≤ ≥ ≠ to <= >= !=. Collapse repeated spaces.
  s = s
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/≠/g, '!=')
    .replace(/\s+/g, ' ')
    .trim();

  // If the result would be empty, return the original text trimmed.
  if (!s) {
    return original;
  }

  return s;
}

export const cleanCondition = normalizeCondition;

export function generatePseudocode(rep: FlowchartRepresentation): GenerateResult {
  const warnings: string[] = [];

  if (!rep.nodes || rep.nodes.length === 0) {
    return { pseudocode: '', warnings: ['Flowchart has no nodes'] };
  }

  const nodeMap = new Map<string, FlowchartNode>();
  for (const node of rep.nodes) {
    nodeMap.set(node.id, node);
  }

  const outgoingMap = new Map<string, FlowchartEdge[]>();
  for (const edge of rep.edges) {
    if (!outgoingMap.has(edge.from)) {
      outgoingMap.set(edge.from, []);
    }
    outgoingMap.get(edge.from)!.push(edge);
  }

  // Find start node
  const startNode = rep.nodes.find(n => n.type === 'start') || rep.nodes[0];

  // Helper to check reachability between two nodes without passing through stopNode
  function canReach(fromId: string, targetId: string, stopNodeId: string | null): boolean {
    if (fromId === targetId) return true;
    const visited = new Set<string>();
    const queue = [fromId];
    visited.add(fromId);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr === targetId) return true;
      if (stopNodeId && curr === stopNodeId) continue;

      const edges = outgoingMap.get(curr) || [];
      for (const edge of edges) {
        if (!visited.has(edge.to) && nodeMap.has(edge.to)) {
          visited.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    return false;
  }

  // Helper to find common convergence/join node between two branch paths
  function findJoinNode(
    nodeAId: string,
    nodeBId: string,
    stopNodeId: string | null
  ): string | null {
    function getReachableSet(startId: string): Set<string> {
      const set = new Set<string>();
      const queue = [startId];
      set.add(startId);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (stopNodeId && curr === stopNodeId) continue;
        const edges = outgoingMap.get(curr) || [];
        for (const edge of edges) {
          if (!set.has(edge.to) && nodeMap.has(edge.to)) {
            set.add(edge.to);
            queue.push(edge.to);
          }
        }
      }
      return set;
    }

    const reachA = getReachableSet(nodeAId);
    const reachB = getReachableSet(nodeBId);

    // Find nodes present in both reachA and reachB that are not 'end' nodes and not stopNode
    const candidates: string[] = [];
    for (const id of reachA) {
      if (reachB.has(id)) {
        if (id !== stopNodeId && nodeMap.get(id)?.type !== 'end') {
          candidates.push(id);
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Return the candidate that is closest (topological BFS from start)
    return candidates[0];
  }

  let unstructuredFallbackNeeded = false;

  function generateNodeSequence(
    currentId: string | null,
    stopNodeId: string | null,
    visitedInScope: Set<string>,
    indent: string
  ): string[] {
    const lines: string[] = [];

    let curr: string | null = currentId;

    while (curr && curr !== stopNodeId) {
      if (!nodeMap.has(curr)) {
        warnings.push(`Reference to missing node "${curr}"`);
        break;
      }

      if (visitedInScope.has(curr)) {
        // Cycle detected that cannot be structured
        unstructuredFallbackNeeded = true;
        lines.push(`${indent}GOTO ${curr}`);
        break;
      }

      const node = nodeMap.get(curr)!;
      const edges = outgoingMap.get(curr) || [];

      if (node.type === 'start') {
        curr = edges.length > 0 ? edges[0].to : null;
        continue;
      }

      if (node.type === 'end') {
        break;
      }

      if (node.type === 'io') {
        lines.push(`${indent}${formatIoNode(node.text)}`);
        curr = edges.length > 0 ? edges[0].to : null;
        continue;
      }

      if (node.type === 'proc') {
        const statements = splitProcStatements(node.text);
        for (const stmt of statements) {
          lines.push(`${indent}${stmt}`);
        }
        curr = edges.length > 0 ? edges[0].to : null;
        continue;
      }

      if (node.type === 'dec') {
        const condition = normalizeCondition(node.text);

        if (edges.length < 2) {
          warnings.push(`Decision node ${curr} has fewer than 2 edges; treating as sequential`);
          lines.push(`${indent}REM Decision: ${condition}`);
          curr = edges.length > 0 ? edges[0].to : null;
          continue;
        }

        const edgeA = edges[0];
        const edgeB = edges[1];

        // 1. Check for WHILE loop (back-edge returning to current dec node)
        const aReturns = canReach(edgeA.to, curr, null);
        const bReturns = canReach(edgeB.to, curr, null);

        if (aReturns || bReturns) {
          const bodyEdge = aReturns ? edgeA : edgeB;
          const exitEdge = aReturns ? edgeB : edgeA;

          if (!bodyEdge.label && !exitEdge.label) {
            warnings.push(`Decision node ${curr} has unlabelled outgoing edges; defaulting loop branch to ${bodyEdge.to}`);
          }

          lines.push(`${indent}WHILE ${condition} DO`);
          const bodyVisited = new Set(visitedInScope);
          bodyVisited.add(curr);
          const bodyLines = generateNodeSequence(bodyEdge.to, curr, bodyVisited, indent + '  ');
          lines.push(...bodyLines);
          lines.push(`${indent}END WHILE`);

          // Follow exit branch
          curr = exitEdge.to;
          continue;
        }

        // 2. IF ... ELSE branching
        // Determine THEN (Yes/True) vs ELSE (No/False)
        let thenEdge = edgeA;
        let elseEdge = edgeB;

        const isAFalse = edgeA.label && /^(no|false)$/i.test(edgeA.label.trim());
        const isBTrue = edgeB.label && /^(yes|true)$/i.test(edgeB.label.trim());

        if (isAFalse || isBTrue) {
          thenEdge = edgeB;
          elseEdge = edgeA;
        } else if (!edgeA.label && !edgeB.label) {
          warnings.push(`Decision node ${curr} has unlabelled outgoing edges; defaulting ${edgeA.to} to THEN, ${edgeB.to} to ELSE`);
        }

        // Find join node if paths converge
        const joinNode = findJoinNode(thenEdge.to, elseEdge.to, stopNodeId);

        lines.push(`${indent}IF ${condition} THEN`);
        const scopeVisited = new Set(visitedInScope);
        scopeVisited.add(curr);

        const thenLines = generateNodeSequence(thenEdge.to, joinNode || stopNodeId, new Set(scopeVisited), indent + '  ');
        lines.push(...thenLines);

        const elseLines = generateNodeSequence(elseEdge.to, joinNode || stopNodeId, new Set(scopeVisited), indent + '  ');
        if (elseLines.length > 0) {
          lines.push(`${indent}ELSE`);
          lines.push(...elseLines);
        }

        lines.push(`${indent}END IF`);

        // If branches joined, continue traversal from join node
        if (joinNode) {
          curr = joinNode;
        } else {
          // Both branches ended separately
          break;
        }
        continue;
      }

      // Any other type
      curr = edges.length > 0 ? edges[0].to : null;
    }

    return lines;
  }

  // Attempt structured generation
  const structuredLines = generateNodeSequence(startNode.id, null, new Set(), '');

  if (unstructuredFallbackNeeded) {
    warnings.push('Unstructured control flow detected; fell back to labelled GOTO statements');
    // Fallback: Labelled steps with GOTO for every node to ensure no node is silently dropped
    const gotoLines: string[] = [];
    for (const node of rep.nodes) {
      if (node.type === 'start') continue;
      gotoLines.push(`${node.id}:`);
      if (node.type === 'io') {
        gotoLines.push(`  ${formatIoNode(node.text)}`);
      } else if (node.type === 'proc') {
        for (const s of splitProcStatements(node.text)) {
          gotoLines.push(`  ${s}`);
        }
      } else if (node.type === 'dec') {
        const cond = normalizeCondition(node.text);
        const edges = outgoingMap.get(node.id) || [];
        for (const edge of edges) {
          const lbl = edge.label ? ` (${edge.label})` : '';
          gotoLines.push(`  IF ${cond}${lbl} GOTO ${edge.to}`);
        }
        continue;
      } else if (node.type === 'end') {
        gotoLines.push(`  STOP`);
        continue;
      }
      const edges = outgoingMap.get(node.id) || [];
      if (edges.length === 1 && edges[0].to !== rep.nodes[rep.nodes.indexOf(node) + 1]?.id) {
        gotoLines.push(`  GOTO ${edges[0].to}`);
      }
    }
    return {
      pseudocode: gotoLines.join('\n'),
      warnings,
    };
  }

  return {
    pseudocode: structuredLines.join('\n'),
    warnings,
  };
}

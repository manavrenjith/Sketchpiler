// Parses text extracted from the vision model into flowchart nodes and edges.
import { AppError } from './errors.js';
import { FlowchartEdge, FlowchartNode, FlowchartRepresentation, NodeType, ParseResult } from './types.js';

const VALID_TYPES = new Set<string>(['start', 'end', 'proc', 'io', 'dec']);
const RESERVED_HEADERS = new Set<string>(['er', 'uml']);

export function parseDsl(rawText: string): ParseResult {
  if (!rawText || !rawText.trim()) {
    throw new AppError('empty_diagram', 'Input text is empty');
  }

  const rawLines = rawText.split(/\r?\n/);
  const cleanLines: string[] = [];

  // 1. Strip markdown code fences and whitespace
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```')) {
      continue;
    }
    cleanLines.push(trimmed);
  }

  // Remove leading and trailing empty lines
  while (cleanLines.length > 0 && cleanLines[0] === '') {
    cleanLines.shift();
  }
  while (cleanLines.length > 0 && cleanLines[cleanLines.length - 1] === '') {
    cleanLines.pop();
  }

  if (cleanLines.length === 0) {
    throw new AppError('empty_diagram', 'No content found after stripping code fences');
  }

  const warnings: string[] = [];
  let truncated = false;
  let headerFound = false;
  const nodes: FlowchartNode[] = [];
  const edges: FlowchartEdge[] = [];

  // Check the first non-empty line for header
  const firstLine = cleanLines[0].toLowerCase();
  if (RESERVED_HEADERS.has(firstLine)) {
    throw new AppError('unparseable_output', `Unsupported diagram type "${firstLine}". Only "flowchart" is supported.`);
  }

  if (firstLine === 'flowchart') {
    headerFound = true;
    cleanLines.shift();
  } else if (/^[a-zA-Z0-9_-]+$/.test(firstLine) && !firstLine.startsWith('n') && !firstLine.startsWith('e')) {
    // Unknown single-token header
    throw new AppError('unparseable_output', `Invalid or unknown header "${cleanLines[0]}". Expected "flowchart".`);
  }

  // Check remaining lines
  for (let i = 0; i < cleanLines.length; i++) {
    let line = cleanLines[i];
    if (!line) {
      continue;
    }

    const isLastLine = i === cleanLines.length - 1;

    // Check if line is a late-occurring header
    if (!headerFound && line.toLowerCase() === 'flowchart') {
      headerFound = true;
      continue;
    }

    // Check uncertain marker "~" at the end of the line
    let uncertain = false;
    if (/\s*~\s*$/.test(line)) {
      uncertain = true;
      line = line.replace(/\s*~\s*$/, '').trim();
    }

    // Try parsing Node: N<id> <type> "<text>"
    const nodeMatch = line.match(/^N(\d+)\s+([a-zA-Z]+)\s+(.*)$/i);
    if (nodeMatch) {
      const id = 'N' + nodeMatch[1];
      const typeStr = nodeMatch[2].toLowerCase();
      let textContent = nodeMatch[3].trim();

      if (!VALID_TYPES.has(typeStr)) {
        if (isLastLine) {
          truncated = true;
          break;
        }
        warnings.push(`Unknown node type "${typeStr}" on line: "${cleanLines[i]}"`);
        continue;
      }

      // Check quoted text
      if (textContent.startsWith('"')) {
        if (!textContent.endsWith('"') || textContent.length < 2) {
          // Unclosed quote: line was cut off / truncated
          if (isLastLine) {
            truncated = true;
            break;
          }
          warnings.push(`Unclosed quote on line: "${cleanLines[i]}"`);
          continue;
        }
        // Extract content between first and last quote
        let text = textContent.slice(1, -1);
        // Unescape escaped quotes
        text = text.replace(/\\"/g, '"');

        nodes.push({
          id,
          type: typeStr as NodeType,
          text,
          uncertain,
        });
        continue;
      } else {
        if (isLastLine) {
          truncated = true;
          break;
        }
        warnings.push(`Node text must be quoted on line: "${cleanLines[i]}"`);
        continue;
      }
    }

    // Try parsing Edge: E N<from> N<to> ["<label>"]
    const edgeMatch = line.match(/^E\s+N(\d+)\s+N(\d+)(?:\s+(.*))?$/i);
    if (edgeMatch) {
      const from = 'N' + edgeMatch[1];
      const to = 'N' + edgeMatch[2];
      const rawLabel = edgeMatch[3] ? edgeMatch[3].trim() : '';

      let label: string | null = null;
      if (rawLabel) {
        if (rawLabel.startsWith('"')) {
          if (!rawLabel.endsWith('"') || rawLabel.length < 2) {
            if (isLastLine) {
              truncated = true;
              break;
            }
            warnings.push(`Unclosed quote in edge label on line: "${cleanLines[i]}"`);
            continue;
          }
          label = rawLabel.slice(1, -1).replace(/\\"/g, '"');
        } else {
          // Accept unquoted label gracefully
          label = rawLabel;
        }
      }

      edges.push({
        from,
        to,
        label,
        uncertain,
      });
      continue;
    }

    // Line did not match Node or Edge pattern
    if (isLastLine) {
      // Final line is truncated / incomplete
      truncated = true;
      break;
    } else {
      warnings.push(`Skipped unparseable line: "${cleanLines[i]}"`);
    }
  }

  if (!headerFound) {
    warnings.push('Missing required "flowchart" header');
  }

  if (nodes.length === 0) {
    throw new AppError('empty_diagram', 'No flowchart nodes could be parsed from input');
  }

  const representation: FlowchartRepresentation = {
    schemaVersion: 1,
    type: 'flowchart',
    nodes,
    edges,
  };

  return {
    representation,
    warnings,
    truncated,
  };
}

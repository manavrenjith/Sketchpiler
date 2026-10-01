// Converts Sketchpiler flowchart representations into Mermaid diagram syntax.
import { FlowchartRepresentation, NodeType } from './types.js';

function escapeMermaidText(text: string): string {
  return text.replace(/"/g, '#quot;');
}

function formatNodeLabel(id: string, type: NodeType, text: string): string {
  const escaped = escapeMermaidText(text);
  switch (type) {
    case 'start':
    case 'end':
      return `${id}(["${escaped}"])`;
    case 'io':
      return `${id}[/"${escaped}"/]`;
    case 'dec':
      return `${id}{"${escaped}"}`;
    case 'proc':
    default:
      return `${id}["${escaped}"]`;
  }
}

export function buildMermaid(rep: FlowchartRepresentation): string {
  const lines: string[] = ['flowchart TD'];

  // Add nodes
  for (const node of rep.nodes) {
    lines.push(`  ${formatNodeLabel(node.id, node.type, node.text)}`);
  }

  // Add edges
  for (const edge of rep.edges) {
    if (edge.label && edge.label.trim()) {
      const cleanLabel = edge.label.replace(/"/g, '#quot;');
      lines.push(`  ${edge.from} -->|"${cleanLabel}"| ${edge.to}`);
    } else {
      lines.push(`  ${edge.from} --> ${edge.to}`);
    }
  }

  return lines.join('\n');
}

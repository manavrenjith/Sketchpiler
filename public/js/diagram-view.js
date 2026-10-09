// Pure read-only SVG diagram renderer matching Sketchpiler editor layout and styles.
import {
    autoLayout,
    isBackEdge,
    edgePath,
    pickEdgeSides,
    computeAllEdgeSides
} from './editor-core.js';

/**
 * Escapes XML/SVG special characters.
 * @param {any} val
 * @returns {string}
 */
export function escapeXml(val) {
    if (val == null) return '';
    return String(val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Wraps text into lines not exceeding maxChars per line.
 * (Duplicated from public/editor-canvas.html line 1687 for future refactoring)
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string[]}
 */
export function wrapText(text, maxChars = 22) {
    if (!text) return [""];
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = "";
    for (const w of words) {
        if (!cur) {
            cur = w;
        } else if ((cur + " " + w).length <= maxChars) {
            cur += " " + w;
        } else {
            lines.push(cur);
            cur = w;
        }
    }
    if (cur) lines.push(cur);
    return lines.length > 0 ? lines : [text];
}

/**
 * Computes bounding dimensions for a box node.
 * (Duplicated from public/editor-canvas.html line 1706 for future refactoring)
 * @param {{ id: string, type: string, text: string }} node
 * @returns {{ width: number, height: number, lines: string[] }}
 */
export function computeBoxDims(node) {
    const text = node && node.text != null ? node.text : '';
    const lines = wrapText(text, 22);
    let maxLen = 0;
    lines.forEach(l => { if (l.length > maxLen) maxLen = l.length; });

    let width = Math.max(140, Math.min(240, maxLen * 8.5 + 40));
    let height = Math.max(56, lines.length * 18 + 26);

    if (node && node.type === 'dec') {
        width = Math.max(width + 24, 150);
        height = Math.max(height + 16, 68);
    }
    return { width: Math.round(width), height: Math.round(height), lines };
}

/**
 * Resolves diagram layout positions and edge sides.
 * - Reuses saved positions where box IDs match current IR nodes.
 * - For nodes without saved positions (or unedited diagrams), applies pure autoLayout.
 * - Resolves edge connection sides from saved sides or auto-computes them.
 * @param {{ nodes: any[], edges: any[] }} representation
 * @param {Record<string, { x: number, y: number }>|null|undefined} savedPositions
 * @param {Record<string, { fromSide?: string, toSide?: string }>|null|undefined} savedEdgeSides
 * @returns {{ positions: Record<string, { x: number, y: number }>, edgeSides: Record<string, { fromSide?: any, toSide?: any }> }}
 */
export function resolveDiagramLayout(representation, savedPositions, savedEdgeSides) {
    if (!representation || !Array.isArray(representation.nodes)) {
        return { positions: {}, edgeSides: {} };
    }

    const nodes = representation.nodes;
    const hasSaved = savedPositions && typeof savedPositions === 'object';
    const matchingPositions = {};
    let missingAny = false;

    for (const node of nodes) {
        if (hasSaved && savedPositions[node.id] && typeof savedPositions[node.id].x === 'number' && typeof savedPositions[node.id].y === 'number') {
            matchingPositions[node.id] = {
                x: savedPositions[node.id].x,
                y: savedPositions[node.id].y
            };
        } else {
            missingAny = true;
        }
    }

    let finalPositions;
    if (Object.keys(matchingPositions).length === 0) {
        // Never edited or no matching boxes: use autoLayout
        finalPositions = autoLayout(representation);
    } else if (missingAny) {
        // Partial saved positions: compute auto layout and merge matching saved
        const auto = autoLayout(representation);
        finalPositions = { ...auto, ...matchingPositions };
    } else {
        // All nodes match saved positions
        finalPositions = matchingPositions;
    }

    // Resolve edge attachment sides
    const computedSides = computeAllEdgeSides(representation, finalPositions);
    const finalSides = { ...computedSides };

    if (savedEdgeSides && typeof savedEdgeSides === 'object') {
        const edges = Array.isArray(representation.edges) ? representation.edges : [];
        for (const edge of edges) {
            const key = `${edge.from}->${edge.to}`;
            if (savedEdgeSides[key] && (savedEdgeSides[key].fromSide || savedEdgeSides[key].toSide)) {
                finalSides[key] = {
                    fromSide: savedEdgeSides[key].fromSide || computedSides[key]?.fromSide || 'bottom',
                    toSide: savedEdgeSides[key].toSide || computedSides[key]?.toSide || 'top'
                };
            }
        }
    }

    return {
        positions: finalPositions,
        edgeSides: finalSides
    };
}

/**
 * Computes bounding box encompassing all diagram elements with padding.
 * @param {{ nodes: any[], edges: any[] }} representation
 * @param {Record<string, { x: number, y: number }>} positions
 * @param {Map<string, { width: number, height: number }>} dimsMap
 * @param {number} [padding]
 * @returns {{ minX: number, minY: number, width: number, height: number }}
 */
export function computeDiagramViewBox(representation, positions, dimsMap, padding = 40) {
    const nodes = (representation && Array.isArray(representation.nodes)) ? representation.nodes : [];
    if (nodes.length === 0) {
        return { minX: 0, minY: 0, width: 400, height: 280 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of nodes) {
        const p = positions[node.id];
        if (!p) continue;
        const d = dimsMap.get(node.id) || { width: 140, height: 60 };
        const left = p.x - d.width / 2;
        const right = p.x + d.width / 2;
        const top = p.y - d.height / 2;
        const bottom = p.y + d.height / 2;

        if (left < minX) minX = left;
        if (right > maxX) maxX = right;
        if (top < minY) minY = top;
        if (bottom > maxY) maxY = bottom;
    }

    // Account for back-edge side curvature (sideOffset is 70 in edgePath)
    const edges = (representation && Array.isArray(representation.edges)) ? representation.edges : [];
    for (const edge of edges) {
        if (isBackEdge(edge, positions)) {
            const p1 = positions[edge.from];
            const p2 = positions[edge.to];
            if (p1 && p2) {
                const curveApex = Math.min(p1.x, p2.x) - 100;
                if (curveApex < minX) minX = curveApex;
            }
        }
    }

    if (minX === Infinity) {
        return { minX: 0, minY: 0, width: 400, height: 280 };
    }

    const viewBoxX = Math.round(minX - padding);
    const viewBoxY = Math.round(minY - padding);
    const viewBoxW = Math.max(120, Math.round(maxX - minX + padding * 2));
    const viewBoxH = Math.max(100, Math.round(maxY - minY + padding * 2));

    return {
        minX: viewBoxX,
        minY: viewBoxY,
        width: viewBoxW,
        height: viewBoxH
    };
}

/**
 * Renders a flowchart diagram as an accessible, read-only SVG string.
 * @param {{ nodes: any[], edges: any[] }} representation
 * @param {Record<string, { x: number, y: number }>} [positions]
 * @param {Record<string, { fromSide?: string, toSide?: string }>} [edgeSides]
 * @param {{ padding?: number, title?: string }} [options]
 * @returns {string}
 */
export function renderDiagramSvg(representation, positions = {}, edgeSides = {}, options = {}) {
    if (!representation || !Array.isArray(representation.nodes)) {
        return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Empty flowchart" class="review-diagram-svg" viewBox="0 0 400 280"></svg>`;
    }

    const nodes = representation.nodes;
    const edges = Array.isArray(representation.edges) ? representation.edges : [];

    // Map box dimensions
    const dimsMap = new Map();
    nodes.forEach(n => dimsMap.set(n.id, computeBoxDims(n)));

    const nodeMap = new Map();
    nodes.forEach(n => nodeMap.set(n.id, n));

    // Compute bounding viewBox
    const padding = typeof options.padding === 'number' ? options.padding : 40;
    const vb = computeDiagramViewBox(representation, positions, dimsMap, padding);

    const ariaLabel = escapeXml(
        options.title || `Flowchart with ${nodes.length} box${nodes.length === 1 ? '' : 'es'} and ${edges.length} arrow${edges.length === 1 ? '' : 's'}`
    );

    // 1. Render Edges Layer
    let edgesSvg = '';
    for (const edge of edges) {
        const p1 = positions[edge.from];
        const p2 = positions[edge.to];
        if (!p1 || !p2) continue;

        const d1 = dimsMap.get(edge.from) || { width: 140, height: 60 };
        const d2 = dimsMap.get(edge.to) || { width: 140, height: 60 };

        const fromBox = { x: p1.x, y: p1.y, width: d1.width, height: d1.height };
        const toBox = { x: p2.x, y: p2.y, width: d2.width, height: d2.height };

        const edgeKey = `${edge.from}->${edge.to}`;
        const storedSides = edgeSides[edgeKey] || {};

        const fromNode = nodeMap.get(edge.from);
        const toNode = nodeMap.get(edge.to);
        const defaultSides = pickEdgeSides(edge, fromNode, toNode, p1, p2);

        const effectiveFromSide = storedSides.fromSide || defaultSides.fromSide;
        const effectiveToSide = storedSides.toSide || defaultSides.toSide;

        const back = isBackEdge(edge, positions);
        const { path, labelPoint } = edgePath(fromBox, toBox, back, effectiveFromSide, effectiveToSide, edge.label);

        let edgeItem = `<g class="edge-group">`;
        edgeItem += `<path d="${escapeXml(path)}" class="edge-path" marker-end="url(#review-arrowhead)" />`;

        if (edge.label && String(edge.label).trim()) {
            const labelText = String(edge.label).trim();
            const textWidth = Math.max(30, labelText.length * 7 + 14);
            const textHeight = 18;
            edgeItem += `<rect x="${Math.round(labelPoint.x - textWidth / 2)}" y="${Math.round(labelPoint.y - textHeight / 2)}" width="${textWidth}" height="${textHeight}" class="edge-label-bg" rx="6" />`;
            edgeItem += `<text x="${Math.round(labelPoint.x)}" y="${Math.round(labelPoint.y + 4)}" class="edge-label-text" text-anchor="middle">${escapeXml(labelText)}</text>`;
        }
        edgeItem += `</g>`;
        edgesSvg += edgeItem;
    }

    // 2. Render Boxes Layer
    let boxesSvg = '';
    for (const node of nodes) {
        const pos = positions[node.id] || { x: 400, y: 100 };
        const dims = dimsMap.get(node.id) || { width: 140, height: 60, lines: [node.text || ''] };
        const w = dims.width;
        const h = dims.height;

        let shapeSvg = '';
        if (node.type === 'start' || node.type === 'end') {
            shapeSvg = `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${h / 2}" ry="${h / 2}" class="box-shape" />`;
        } else if (node.type === 'io') {
            const slant = 14;
            const pts = `${-w / 2 + slant},${-h / 2} ${w / 2 + slant},${-h / 2} ${w / 2 - slant},${h / 2} ${-w / 2 - slant},${h / 2}`;
            shapeSvg = `<polygon points="${pts}" class="box-shape" />`;
        } else if (node.type === 'dec') {
            const pts = `0,${-h / 2} ${w / 2},0 0,${h / 2} ${-w / 2},0`;
            shapeSvg = `<polygon points="${pts}" class="box-shape" />`;
        } else {
            shapeSvg = `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="8" ry="8" class="box-shape" />`;
        }

        const idBadgeSvg = `<text x="0" y="${Math.round(-h / 2 + 14)}" class="box-id-badge" text-anchor="middle">${escapeXml(node.id)}</text>`;

        const lines = dims.lines;
        const lineHeight = 16;
        const startTextY = Math.round(4 - ((lines.length - 1) * lineHeight) / 2);

        let tspansSvg = '';
        lines.forEach((line, lineIdx) => {
            tspansSvg += `<tspan x="0" y="${startTextY + lineIdx * lineHeight}">${escapeXml(line)}</tspan>`;
        });
        const textSvg = `<text class="box-text" text-anchor="middle">${tspansSvg}</text>`;

        boxesSvg += `<g class="box-group" data-node-id="${escapeXml(node.id)}" data-kind="${escapeXml(node.type)}" transform="translate(${pos.x}, ${pos.y})">${shapeSvg}${idBadgeSvg}${textSvg}</g>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${ariaLabel}" class="review-diagram-svg" viewBox="${vb.minX} ${vb.minY} ${vb.width} ${vb.height}"><defs><marker id="review-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--edge-stroke, #6e6e73)" /></marker></defs><g class="review-edges-layer">${edgesSvg}</g><g class="review-boxes-layer">${boxesSvg}</g></svg>`;
}

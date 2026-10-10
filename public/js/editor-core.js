/**
 * editor-core.js
 * Pure ES module for the Flowchart Canvas Editor.
 * No DOM access at import - safe for Node.js test environments.
 */

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

export function getNextBoxId(nodes) {
    let maxId = 0;
    if (Array.isArray(nodes)) {
        for (const node of nodes) {
            const m = String(node.id).match(/^N(\d+)$/i);
            if (m) {
                const val = parseInt(m[1], 10);
                if (val > maxId) maxId = val;
            }
        }
    }
    return `N${maxId + 1}`;
}

/**
 * Layered top-down auto-layout.
 * Level = longest path from start node, ignoring back-edges (edges whose target is not deeper).
 * Each level's boxes in a row, centered. Disconnected nodes placed at the bottom.
 * Returns { [id]: { x: number, y: number } }
 */
export function autoLayout(representation, options = {}) {
    if (!representation || !Array.isArray(representation.nodes) || representation.nodes.length === 0) {
        return {};
    }

    const {
        boxWidth = 150,
        boxHeight = 60,
        startX = 500,
        startY = 60,
        direction = 'top-down',
        spacing = 'normal'
    } = options;

    let hSpacing = options.hSpacing;
    let vSpacing = options.vSpacing;

    if (direction === 'left-right') {
        const presets = {
            compact: { h: 180, v: 90 },
            normal:  { h: 240, v: 120 },
            roomy:   { h: 300, v: 160 }
        };
        const p = presets[spacing] || presets.normal;
        if (hSpacing === undefined) hSpacing = p.h;
        if (vSpacing === undefined) vSpacing = p.v;
    } else {
        const presets = {
            compact: { h: 170, v: 100 },
            normal:  { h: 220, v: 140 },
            roomy:   { h: 280, v: 190 }
        };
        const p = presets[spacing] || presets.normal;
        if (hSpacing === undefined) hSpacing = p.h;
        if (vSpacing === undefined) vSpacing = p.v;
    }

    const nodes = representation.nodes;
    const edges = Array.isArray(representation.edges) ? representation.edges : [];
    const nodeMap = new Map();
    nodes.forEach(n => nodeMap.set(n.id, n));

    // 1. Identify start node (or first node)
    const startNodes = nodes.filter(n => n.type === 'start');
    const startNode = startNodes.length > 0 ? startNodes[0] : nodes[0];

    // 2. BFS from start to find reachability and base depth
    const bfsDist = new Map();
    const queue = [startNode.id];
    bfsDist.set(startNode.id, 0);

    while (queue.length > 0) {
        const curr = queue.shift();
        const currDist = bfsDist.get(curr);
        const outEdges = edges.filter(e => e.from === curr && nodeMap.has(e.to));
        for (const e of outEdges) {
            if (!bfsDist.has(e.to)) {
                bfsDist.set(e.to, currDist + 1);
                queue.push(e.to);
            }
        }
    }

    // 3. Forward edges: target must be deeper (bfsDist.to > bfsDist.from).
    // Back-edges (target not deeper: bfsDist.to <= bfsDist.from) are ignored for level calculation.
    const forwardEdges = edges.filter(e => {
        if (!bfsDist.has(e.from) || !bfsDist.has(e.to)) return false;
        return bfsDist.get(e.to) > bfsDist.get(e.from);
    });

    // 4. Compute longest path from start node on the forward DAG
    const longestPath = new Map();
    longestPath.set(startNode.id, 0);

    function getLevel(nodeId) {
        if (longestPath.has(nodeId)) return longestPath.get(nodeId);
        const inEdges = forwardEdges.filter(e => e.to === nodeId);
        if (inEdges.length === 0) {
            longestPath.set(nodeId, 0);
            return 0;
        }
        let maxLvl = 0;
        for (const e of inEdges) {
            maxLvl = Math.max(maxLvl, getLevel(e.from) + 1);
        }
        longestPath.set(nodeId, maxLvl);
        return maxLvl;
    }

    for (const id of bfsDist.keys()) {
        getLevel(id);
    }

    let maxLevel = 0;
    for (const lvl of longestPath.values()) {
        if (lvl > maxLevel) maxLevel = lvl;
    }

    // 5. Disconnected nodes placed at the bottom/end (maxLevel + 1)
    const nodeLevels = new Map();
    for (const node of nodes) {
        if (longestPath.has(node.id)) {
            nodeLevels.set(node.id, longestPath.get(node.id));
        } else {
            nodeLevels.set(node.id, maxLevel + 1);
        }
    }

    // 6. Group nodes by level
    const levelGroups = new Map();
    for (const node of nodes) {
        const lvl = nodeLevels.get(node.id);
        if (!levelGroups.has(lvl)) levelGroups.set(lvl, []);
        levelGroups.get(lvl).push(node.id);
    }

    const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);
    const positions = {};

    if (direction === 'left-right') {
        const baseStartX = options.startX !== undefined ? options.startX : 100;
        const baseStartY = options.startY !== undefined ? options.startY : 250;

        for (const lvl of sortedLevels) {
            const group = levelGroups.get(lvl);
            const count = group.length;
            const colX = baseStartX + lvl * hSpacing;
            const totalColHeight = (count - 1) * vSpacing;
            const startColY = baseStartY - totalColHeight / 2;

            group.forEach((id, idx) => {
                const y = startColY + idx * vSpacing;
                positions[id] = { x: colX, y };
            });
        }

        const allY = Object.values(positions).map(p => p.y);
        const minY = Math.min(...allY);
        if (minY < 60) {
            const shiftY = 60 - minY;
            for (const id of Object.keys(positions)) {
                positions[id].y += shiftY;
            }
        }
    } else {
        for (const lvl of sortedLevels) {
            const group = levelGroups.get(lvl);
            const count = group.length;
            const rowY = startY + lvl * vSpacing;
            const totalRowWidth = (count - 1) * hSpacing;
            const startRowX = startX - totalRowWidth / 2;

            group.forEach((id, idx) => {
                const x = startRowX + idx * hSpacing;
                positions[id] = { x, y: rowY };
            });
        }
    }

    const edgeSides = computeAllEdgeSides(representation, positions);
    Object.defineProperty(positions, '_edgeSides', {
        value: edgeSides,
        enumerable: false,
        writable: true,
        configurable: true
    });

    return positions;
}

/**
 * Calculates border intersection point of ray from (cx, cy) to (tx, ty) with box of size w x h.
 */
function getRectIntersection(cx, cy, w, h, tx, ty) {
    const dx = tx - cx;
    const dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };

    const hw = w / 2;
    const hh = h / 2;

    const scaleX = dx !== 0 ? Math.abs(hw / dx) : Infinity;
    const scaleY = dy !== 0 ? Math.abs(hh / dy) : Infinity;
    const scale = Math.min(scaleX, scaleY);

    return {
        x: cx + dx * scale,
        y: cy + dy * scale
    };
}

/**
 * Determines whether an edge is a back-edge based on positions.
 */
export function isBackEdge(edge, positions) {
    if (!positions || !positions[edge.from] || !positions[edge.to]) return false;
    return positions[edge.to].y <= positions[edge.from].y;
}

/**
 * Returns the anchor point coordinate on the specified side of a box.
 * @param {{ x: number, y: number, width?: number, height?: number }} box
 * @param {'top' | 'right' | 'bottom' | 'left'} side
 * @returns {{ x: number, y: number }}
 */
export function getBoxSidePoint(box, side) {
    const w = box.width || 140;
    const h = box.height || 60;
    switch (side) {
        case 'top':
            return { x: box.x, y: box.y - h / 2 };
        case 'right':
            return { x: box.x + w / 2, y: box.y };
        case 'bottom':
            return { x: box.x, y: box.y + h / 2 };
        case 'left':
            return { x: box.x - w / 2, y: box.y };
        default:
            return { x: box.x, y: box.y };
    }
}

/**
 * Generates SVG path string plus a label point for an arrow from fromBox to toBox.
 * fromBox, toBox: { x, y, width?, height? }
 * isBackEdge: boolean (if true, curves out to the side)
 * fromSide, toSide: optional explicit attachment sides ('top' | 'right' | 'bottom' | 'left')
 * label: optional edge label string (for YES/NO offset positioning)
 * Returns { path: string, labelPoint: { x: number, y: number } }
 */
export function edgePath(fromBox, toBox, isBackEdge = false, fromSide = null, toSide = null, label = null) {
    const w1 = fromBox.width || 140;
    const h1 = fromBox.height || 60;
    const w2 = toBox.width || 140;
    const h2 = toBox.height || 60;

    const start = fromSide
        ? getBoxSidePoint(fromBox, fromSide)
        : (isBackEdge ? { x: fromBox.x - w1 / 2, y: fromBox.y } : getRectIntersection(fromBox.x, fromBox.y, w1, h1, toBox.x, toBox.y));

    const end = toSide
        ? getBoxSidePoint(toBox, toSide)
        : (isBackEdge ? { x: toBox.x - w2 / 2, y: toBox.y } : getRectIntersection(toBox.x, toBox.y, w2, h2, fromBox.x, fromBox.y));

    if (!isBackEdge) {
        const path = `M ${Math.round(start.x)} ${Math.round(start.y)} L ${Math.round(end.x)} ${Math.round(end.y)}`;
        let labelPoint = {
            x: Math.round((start.x + end.x) / 2),
            y: Math.round((start.y + end.y) / 2)
        };

        if (label && /^(yes|no)$/i.test(String(label).trim())) {
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const isVertical = Math.abs(dy) >= Math.abs(dx);
            const offset = 14;
            if (isVertical) {
                // Shift rightwards so label doesn't sit on top of vertical arrow line
                labelPoint.x += offset;
            } else {
                // Shift upwards so label doesn't sit on top of horizontal arrow line
                labelPoint.y -= offset;
            }
        }

        return { path, labelPoint };
    }

    // Back-edge: curve out to the side so it does not overlap forward edges
    const minX = Math.min(start.x, end.x);
    const sideOffset = 70;
    const curveX = minX - sideOffset;

    const path = `M ${Math.round(start.x)} ${Math.round(start.y)} C ${Math.round(curveX)} ${Math.round(start.y)}, ${Math.round(curveX)} ${Math.round(end.y)}, ${Math.round(end.x)} ${Math.round(end.y)}`;

    // Approximate label point near the outer apex of the curve
    const labelPoint = {
        x: Math.round(curveX + 10),
        y: Math.round((start.y + end.y) / 2)
    };

    return { path, labelPoint };
}

/**
 * History manager: createHistory(initial)
 * push(state), undo(), redo(), canUndo, canRedo; max 100 steps.
 * Pushing after an undo clears the redo branch.
 * A state is { representation, positions }.
 */
export function createHistory(initial) {
    let past = [];
    let present = clone(initial);
    let future = [];
    const MAX_STEPS = 100;

    return {
        push(state) {
            past.push(clone(present));
            if (past.length > MAX_STEPS) {
                past.shift();
            }
            present = clone(state);
            future = [];
        },
        undo() {
            if (past.length === 0) return clone(present);
            future.unshift(clone(present));
            present = past.pop();
            return clone(present);
        },
        redo() {
            if (future.length === 0) return clone(present);
            past.push(clone(present));
            present = future.shift();
            return clone(present);
        },
        get canUndo() {
            return past.length > 0;
        },
        get canRedo() {
            return future.length > 0;
        },
        get state() {
            return clone(present);
        }
    };
}

/**
 * Pure edit operations returning new state (no mutations).
 */

export function addBox(state, kind = 'proc', text = null, pos = null) {
    const nextId = getNextBoxId(state.representation.nodes);
    const defaultTexts = {
        start: 'Start',
        end: 'End',
        proc: 'Step',
        io: 'Input x',
        dec: 'Condition ?'
    };

    const newNode = {
        id: nextId,
        type: kind,
        text: text !== null && text !== undefined ? String(text) : (defaultTexts[kind] || 'Step'),
        uncertain: false
    };

    let newPos = pos;
    if (!newPos) {
        // Place below lowest node or at default
        let maxY = 60;
        let avgX = 500;
        if (state.positions) {
            const vals = Object.values(state.positions);
            if (vals.length > 0) {
                maxY = Math.max(...vals.map(p => p.y));
                avgX = vals.reduce((sum, p) => sum + p.x, 0) / vals.length;
            }
        }
        newPos = { x: Math.round(avgX), y: maxY + 140 };
    }

    return {
        representation: {
            ...state.representation,
            nodes: [...state.representation.nodes, newNode],
            edges: [...state.representation.edges]
        },
        positions: {
            ...state.positions,
            [nextId]: { x: newPos.x, y: newPos.y }
        },
        edgeSides: { ...(state.edgeSides || {}) }
    };
}

export function deleteBox(state, id) {
    const nodes = state.representation.nodes.filter(n => n.id !== id);
    // Cascade delete connecting arrows
    const edges = state.representation.edges.filter(e => e.from !== id && e.to !== id);

    const positions = { ...state.positions };
    delete positions[id];

    const edgeSides = { ...(state.edgeSides || {}) };
    for (const key of Object.keys(edgeSides)) {
        if (key.startsWith(`${id}->`) || key.endsWith(`->${id}`)) {
            delete edgeSides[key];
        }
    }

    return {
        representation: {
            ...state.representation,
            nodes,
            edges
        },
        positions,
        edgeSides
    };
}

export function setBoxText(state, id, text) {
    const nodes = state.representation.nodes.map(n => {
        if (n.id === id) {
            return { ...n, text: String(text) };
        }
        return n;
    });

    return {
        representation: {
            ...state.representation,
            nodes
        },
        positions: { ...state.positions },
        edgeSides: { ...(state.edgeSides || {}) }
    };
}

export function setBoxKind(state, id, kind) {
    const nodes = state.representation.nodes.map(n => {
        if (n.id === id) {
            return { ...n, type: kind };
        }
        return n;
    });

    return {
        representation: {
            ...state.representation,
            nodes
        },
        positions: { ...state.positions },
        edgeSides: { ...(state.edgeSides || {}) }
    };
}

export function addEdge(state, from, to, label = undefined, sides = undefined) {
    if (from === to) {
        return {
            success: false,
            reason: 'Self-loops are not allowed',
            state
        };
    }

    const exists = state.representation.edges.some(e => e.from === from && e.to === to);
    if (exists) {
        return {
            success: false,
            reason: 'An arrow between these boxes already exists',
            state
        };
    }

    const fromNode = state.representation.nodes.find(n => n.id === from);
    const toNode = state.representation.nodes.find(n => n.id === to);
    if (!fromNode || !toNode) {
        return {
            success: false,
            reason: 'Source or target box does not exist',
            state
        };
    }

    // Label suggestion for decision nodes: if from is dec, suggest "Yes", then "No"
    let suggestedLabel = null;
    if (fromNode.type === 'dec') {
        const existingOut = state.representation.edges.filter(e => e.from === from);
        const hasYes = existingOut.some(e => (e.label || '').trim().toLowerCase() === 'yes');
        const hasNo = existingOut.some(e => (e.label || '').trim().toLowerCase() === 'no');
        if (!hasYes) {
            suggestedLabel = 'Yes';
        } else if (!hasNo) {
            suggestedLabel = 'No';
        }
    }

    const finalLabel = label !== undefined ? label : suggestedLabel;

    const newEdge = {
        from,
        to,
        label: finalLabel || null,
        uncertain: false
    };

    const newEdgeSides = { ...(state.edgeSides || {}) };
    if (sides && (sides.fromSide || sides.toSide)) {
        newEdgeSides[`${from}->${to}`] = {
            ...(sides.fromSide ? { fromSide: sides.fromSide } : {}),
            ...(sides.toSide ? { toSide: sides.toSide } : {})
        };
    }

    const newState = {
        representation: {
            ...state.representation,
            edges: [...state.representation.edges, newEdge]
        },
        positions: { ...state.positions },
        edgeSides: newEdgeSides
    };

    return {
        success: true,
        state: newState,
        suggestedLabel
    };
}

export function deleteEdge(state, edgeIdentifier) {
    let edges;
    let deletedEdge = null;
    if (typeof edgeIdentifier === 'number') {
        deletedEdge = state.representation.edges[edgeIdentifier] || null;
        edges = state.representation.edges.filter((_, idx) => idx !== edgeIdentifier);
    } else if (edgeIdentifier && typeof edgeIdentifier === 'object') {
        const { from, to } = edgeIdentifier;
        deletedEdge = state.representation.edges.find(e => e.from === from && e.to === to) || null;
        edges = state.representation.edges.filter(e => !(e.from === from && e.to === to));
    } else {
        edges = [...state.representation.edges];
    }

    const edgeSides = { ...(state.edgeSides || {}) };
    if (deletedEdge) {
        delete edgeSides[`${deletedEdge.from}->${deletedEdge.to}`];
    }

    return {
        representation: {
            ...state.representation,
            edges
        },
        positions: { ...state.positions },
        edgeSides
    };
}

export function setEdgeLabel(state, edgeIdentifier, label) {
    let edges;
    const cleanLabel = (label || '').trim() || null;

    if (typeof edgeIdentifier === 'number') {
        edges = state.representation.edges.map((e, idx) => {
            if (idx === edgeIdentifier) {
                return { ...e, label: cleanLabel };
            }
            return e;
        });
    } else if (edgeIdentifier && typeof edgeIdentifier === 'object') {
        const { from, to } = edgeIdentifier;
        edges = state.representation.edges.map(e => {
            if (e.from === from && e.to === to) {
                return { ...e, label: cleanLabel };
            }
            return e;
        });
    } else {
        edges = [...state.representation.edges];
    }

    return {
        representation: {
            ...state.representation,
            edges
        },
        positions: { ...state.positions },
        edgeSides: { ...(state.edgeSides || {}) }
    };
}

export function setEdgeEnds(state, edgeIndex, newFrom, newTo) {
    if (newFrom === newTo) {
        return {
            success: false,
            reason: 'Self-loops are not allowed',
            state
        };
    }

    const duplicate = state.representation.edges.some(
        (e, idx) => idx !== edgeIndex && e.from === newFrom && e.to === newTo
    );
    if (duplicate) {
        return {
            success: false,
            reason: 'An arrow between these boxes already exists',
            state
        };
    }

    const currentEdge = state.representation.edges[edgeIndex];
    const oldKey = currentEdge ? `${currentEdge.from}->${currentEdge.to}` : null;
    const newKey = `${newFrom}->${newTo}`;

    const edges = state.representation.edges.map((e, idx) => {
        if (idx === edgeIndex) {
            return { ...e, from: newFrom, to: newTo };
        }
        return e;
    });

    const edgeSides = { ...(state.edgeSides || {}) };
    if (oldKey && edgeSides[oldKey]) {
        edgeSides[newKey] = edgeSides[oldKey];
        delete edgeSides[oldKey];
    }

    return {
        success: true,
        state: {
            representation: {
                ...state.representation,
                edges
            },
            positions: { ...state.positions },
            edgeSides
        }
    };
}

/**
 * Zoom math utilities
 */
export function clampZoom(zoom, min = 0.25, max = 3.0) {
    return Math.min(max, Math.max(min, zoom));
}

export function zoomAroundPoint(currentZoom, newZoomRaw, pointerScreenX, pointerScreenY, panX, panY, minZoom = 0.25, maxZoom = 3.0) {
    const zoom = clampZoom(newZoomRaw, minZoom, maxZoom);
    const diagramX = (pointerScreenX - panX) / currentZoom;
    const diagramY = (pointerScreenY - panY) / currentZoom;
    const newPanX = pointerScreenX - diagramX * zoom;
    const newPanY = pointerScreenY - diagramY * zoom;
    return {
        zoom,
        panX: Math.round(newPanX * 100) / 100,
        panY: Math.round(newPanY * 100) / 100
    };
}

/**
 * Screen-to-diagram coordinate conversion
 */
export function screenToDiagram(screenX, screenY, panX, panY, zoom) {
    return {
        x: (screenX - panX) / zoom,
        y: (screenY - panY) / zoom
    };
}

export function diagramToScreen(diagramX, diagramY, panX, panY, zoom) {
    return {
        x: diagramX * zoom + panX,
        y: diagramY * zoom + panY
    };
}

/**
 * Bounding box computation and fit-to-bounds calculations
 */
export function computeBounds(positions, defaultDims = { width: 140, height: 60 }) {
    const ids = positions ? Object.keys(positions) : [];
    if (ids.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const id of ids) {
        const p = positions[id];
        if (!p) continue;
        const hw = (defaultDims.width || 140) / 2;
        const hh = (defaultDims.height || 60) / 2;
        if (p.x - hw < minX) minX = p.x - hw;
        if (p.x + hw > maxX) maxX = p.x + hw;
        if (p.y - hh < minY) minY = p.y - hh;
        if (p.y + hh > maxY) maxY = p.y + hh;
    }

    if (minX === Infinity) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY
    };
}

export function fitToBounds(bounds, viewportWidth, viewportHeight, options = {}) {
    const { padding = 40, minZoom = 0.25, maxZoom = 3.0 } = options;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        return {
            zoom: 1.0,
            panX: Math.round(viewportWidth / 2),
            panY: Math.round(viewportHeight / 2)
        };
    }

    const availableW = Math.max(10, viewportWidth - padding * 2);
    const availableH = Math.max(10, viewportHeight - padding * 2);
    const scaleX = availableW / bounds.width;
    const scaleY = availableH / bounds.height;
    const zoom = clampZoom(Math.min(scaleX, scaleY), minZoom, maxZoom);

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const panX = viewportWidth / 2 - centerX * zoom;
    const panY = viewportHeight / 2 - centerY * zoom;

    return {
        zoom,
        panX: Math.round(panX * 100) / 100,
        panY: Math.round(panY * 100) / 100
    };
}

/**
 * Duplicate a box with an offset
 */
export function duplicateBox(state, nodeId, offset = { x: 40, y: 40 }) {
    const node = state.representation.nodes.find(n => n.id === nodeId);
    if (!node) return state;

    const nextId = getNextBoxId(state.representation.nodes);
    const origPos = (state.positions && state.positions[nodeId]) || { x: 500, y: 200 };
    const dx = offset && typeof offset.x === 'number' ? offset.x : 40;
    const dy = offset && typeof offset.y === 'number' ? offset.y : 40;
    const newPos = { x: origPos.x + dx, y: origPos.y + dy };

    const newNode = {
        ...clone(node),
        id: nextId
    };

    return {
        representation: {
            ...state.representation,
            nodes: [...state.representation.nodes, newNode],
            edges: [...state.representation.edges]
        },
        positions: {
            ...state.positions,
            [nextId]: newPos
        },
        edgeSides: { ...(state.edgeSides || {}) },
        newNode
    };
}

/**
 * Nudge a box position
 */
export function nudgeBox(state, nodeId, dx, dy) {
    const pos = state.positions && state.positions[nodeId];
    if (!pos) return state;

    return {
        representation: {
            ...state.representation,
            nodes: [...state.representation.nodes],
            edges: [...state.representation.edges]
        },
        positions: {
            ...state.positions,
            [nodeId]: {
                x: pos.x + dx,
                y: pos.y + dy
            }
        },
        edgeSides: { ...(state.edgeSides || {}) }
    };
}

/**
 * Selection hit-test: returns IDs of boxes intersecting the given rectangle
 */
export function boxesInRect(positions, dimsMap, rect) {
    if (!positions || !rect) return [];
    const minX = Math.min(
        rect.minX ?? (rect.x != null ? rect.x : rect.x1),
        rect.maxX ?? (rect.x != null && rect.width != null ? rect.x + rect.width : rect.x2)
    );
    const maxX = Math.max(
        rect.minX ?? (rect.x != null ? rect.x : rect.x1),
        rect.maxX ?? (rect.x != null && rect.width != null ? rect.x + rect.width : rect.x2)
    );
    const minY = Math.min(
        rect.minY ?? (rect.y != null ? rect.y : rect.y1),
        rect.maxY ?? (rect.y != null && rect.height != null ? rect.y + rect.height : rect.y2)
    );
    const maxY = Math.max(
        rect.minY ?? (rect.y != null ? rect.y : rect.y1),
        rect.maxY ?? (rect.y != null && rect.height != null ? rect.y + rect.height : rect.y2)
    );

    const result = [];
    for (const id of Object.keys(positions)) {
        const p = positions[id];
        if (!p) continue;
        let d = { width: 140, height: 60 };
        if (dimsMap) {
            if (typeof dimsMap.get === 'function') d = dimsMap.get(id) || d;
            else if (dimsMap[id]) d = dimsMap[id];
        }
        const boxLeft = p.x - (d.width || 140) / 2;
        const boxRight = p.x + (d.width || 140) / 2;
        const boxTop = p.y - (d.height || 60) / 2;
        const boxBottom = p.y + (d.height || 60) / 2;

        const intersects = boxRight >= minX && boxLeft <= maxX && boxBottom >= minY && boxTop <= maxY;
        if (intersects) {
            result.push(id);
        }
    }
    return result;
}

/**
 * Align boxes: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
 */
export function alignBoxes(positions, dimsMap, nodeIds, alignment) {
    if (!positions || !Array.isArray(nodeIds) || nodeIds.length < 2) {
        return clone(positions || {});
    }

    const validIds = nodeIds.filter(id => positions[id]);
    if (validIds.length < 2) return clone(positions);

    const getDims = id => {
        let d = { width: 140, height: 60 };
        if (dimsMap) {
            if (typeof dimsMap.get === 'function') d = dimsMap.get(id) || d;
            else if (dimsMap[id]) d = dimsMap[id];
        }
        return { width: d.width || 140, height: d.height || 60 };
    };

    const boxes = validIds.map(id => {
        const p = positions[id];
        const d = getDims(id);
        return {
            id,
            x: p.x,
            y: p.y,
            w: d.width,
            h: d.height,
            left: p.x - d.width / 2,
            right: p.x + d.width / 2,
            top: p.y - d.height / 2,
            bottom: p.y + d.height / 2
        };
    });

    const minLeft = Math.min(...boxes.map(b => b.left));
    const maxRight = Math.max(...boxes.map(b => b.right));
    const minTop = Math.min(...boxes.map(b => b.top));
    const maxBottom = Math.max(...boxes.map(b => b.bottom));
    const centerX = (minLeft + maxRight) / 2;
    const centerY = (minTop + maxBottom) / 2;

    const newPositions = clone(positions);

    for (const b of boxes) {
        let newX = b.x;
        let newY = b.y;

        switch (alignment) {
            case 'left':
                newX = minLeft + b.w / 2;
                break;
            case 'center':
                newX = Math.round(centerX);
                break;
            case 'right':
                newX = maxRight - b.w / 2;
                break;
            case 'top':
                newY = minTop + b.h / 2;
                break;
            case 'middle':
                newY = Math.round(centerY);
                break;
            case 'bottom':
                newY = maxBottom - b.h / 2;
                break;
        }

        newPositions[b.id] = { x: Math.round(newX), y: Math.round(newY) };
    }

    return newPositions;
}

/**
 * Distribute boxes with equal gaps: 'horizontal' | 'vertical'
 */
export function distributeBoxes(positions, dimsMap, nodeIds, direction) {
    if (!positions || !Array.isArray(nodeIds) || nodeIds.length < 3) {
        return clone(positions || {});
    }

    const validIds = nodeIds.filter(id => positions[id]);
    if (validIds.length < 3) return clone(positions);

    const getDims = id => {
        let d = { width: 140, height: 60 };
        if (dimsMap) {
            if (typeof dimsMap.get === 'function') d = dimsMap.get(id) || d;
            else if (dimsMap[id]) d = dimsMap[id];
        }
        return { width: d.width || 140, height: d.height || 60 };
    };

    const boxes = validIds.map(id => {
        const p = positions[id];
        const d = getDims(id);
        return {
            id,
            x: p.x,
            y: p.y,
            w: d.width,
            h: d.height,
            left: p.x - d.width / 2,
            right: p.x + d.width / 2,
            top: p.y - d.height / 2,
            bottom: p.y + d.height / 2
        };
    });

    const newPositions = clone(positions);

    if (direction === 'horizontal') {
        boxes.sort((a, b) => a.left - b.left);
        const first = boxes[0];
        const last = boxes[boxes.length - 1];
        const minLeft = first.left;
        const maxRight = last.right;
        const totalBoxWidth = boxes.reduce((sum, b) => sum + b.w, 0);
        const totalGap = (maxRight - minLeft) - totalBoxWidth;
        const gap = totalGap / (boxes.length - 1);

        let currentLeft = minLeft;
        for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            const newX = currentLeft + b.w / 2;
            newPositions[b.id] = { x: Math.round(newX), y: b.y };
            currentLeft += b.w + gap;
        }
    } else if (direction === 'vertical') {
        boxes.sort((a, b) => a.top - b.top);
        const first = boxes[0];
        const last = boxes[boxes.length - 1];
        const minTop = first.top;
        const maxBottom = last.bottom;
        const totalBoxHeight = boxes.reduce((sum, b) => sum + b.h, 0);
        const totalGap = (maxBottom - minTop) - totalBoxHeight;
        const gap = totalGap / (boxes.length - 1);

        let currentTop = minTop;
        for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            const newY = currentTop + b.h / 2;
            newPositions[b.id] = { x: b.x, y: Math.round(newY) };
            currentTop += b.h + gap;
        }
    }

    return newPositions;
}

/**
 * Snap coordinates to grid
 */
export function snapToGrid(pos, gridSize = 20) {
    if (!pos) return { x: 0, y: 0 };
    return {
        x: Math.round(pos.x / gridSize) * gridSize,
        y: Math.round(pos.y / gridSize) * gridSize
    };
}

export function snapPositionsToGrid(positions, nodeIds = null, gridSize = 20) {
    if (!positions) return {};
    const newPositions = clone(positions);
    const targetIds = Array.isArray(nodeIds) && nodeIds.length > 0 ? nodeIds : Object.keys(positions);
    for (const id of targetIds) {
        if (newPositions[id]) {
            newPositions[id] = snapToGrid(newPositions[id], gridSize);
        }
    }
    return newPositions;
}

/**
 * Move a group of boxes by dx, dy
 */
export function moveGroup(positions, nodeIds, dx, dy) {
    if (!positions || !Array.isArray(nodeIds)) return clone(positions || {});
    const newPositions = clone(positions);
    for (const id of nodeIds) {
        if (newPositions[id]) {
            newPositions[id] = {
                x: newPositions[id].x + dx,
                y: newPositions[id].y + dy
            };
        }
    }
    return newPositions;
}

/**
 * Duplicate a group of boxes, keeping arrows between the copied boxes
 */
export function duplicateGroup(state, nodeIds, offset = { x: 40, y: 40 }) {
    if (!state || !state.representation || !Array.isArray(nodeIds) || nodeIds.length === 0) {
        return clone(state || {});
    }

    const idSet = new Set(nodeIds);
    const validNodes = state.representation.nodes.filter(n => idSet.has(n.id));
    if (validNodes.length === 0) return clone(state);

    const dx = offset && typeof offset.x === 'number' ? offset.x : 40;
    const dy = offset && typeof offset.y === 'number' ? offset.y : 40;

    const workingNodes = [...state.representation.nodes];
    const idMap = new Map();
    const newNodes = [];
    const newPositions = { ...state.positions };

    for (const node of validNodes) {
        const nextId = getNextBoxId(workingNodes);
        idMap.set(node.id, nextId);
        const newNode = {
            ...clone(node),
            id: nextId
        };
        newNodes.push(newNode);
        workingNodes.push(newNode);

        const origPos = (state.positions && state.positions[node.id]) || { x: 500, y: 200 };
        newPositions[nextId] = {
            x: origPos.x + dx,
            y: origPos.y + dy
        };
    }

    // Replicate edges where both from and to are in the group
    const newEdges = [];
    const edgeSides = { ...(state.edgeSides || {}) };
    const edges = Array.isArray(state.representation.edges) ? state.representation.edges : [];
    for (const edge of edges) {
        if (idMap.has(edge.from) && idMap.has(edge.to)) {
            const newFrom = idMap.get(edge.from);
            const newTo = idMap.get(edge.to);
            newEdges.push({
                from: newFrom,
                to: newTo,
                label: edge.label != null ? edge.label : null,
                uncertain: !!edge.uncertain
            });
            const oldKey = `${edge.from}->${edge.to}`;
            if (edgeSides[oldKey]) {
                edgeSides[`${newFrom}->${newTo}`] = { ...edgeSides[oldKey] };
            }
        }
    }

    return {
        representation: {
            ...state.representation,
            nodes: [...state.representation.nodes, ...newNodes],
            edges: [...edges, ...newEdges]
        },
        positions: newPositions,
        edgeSides,
        newIds: Array.from(idMap.values())
    };
}

/**
 * Delete a group of boxes and their arrows
 */
export function deleteGroup(state, nodeIds) {
    if (!state || !state.representation || !Array.isArray(nodeIds) || nodeIds.length === 0) {
        return clone(state || {});
    }

    const idSet = new Set(nodeIds);
    const nodes = state.representation.nodes.filter(n => !idSet.has(n.id));
    const edges = (state.representation.edges || []).filter(e => !idSet.has(e.from) && !idSet.has(e.to));

    const positions = { ...state.positions };
    for (const id of idSet) {
        delete positions[id];
    }

    const edgeSides = { ...(state.edgeSides || {}) };
    for (const id of idSet) {
        for (const key of Object.keys(edgeSides)) {
            if (key.startsWith(`${id}->`) || key.endsWith(`->${id}`)) {
                delete edgeSides[key];
            }
        }
    }

    return {
        representation: {
            ...state.representation,
            nodes,
            edges
        },
        positions,
        edgeSides
    };
}

/**
 * Determines whether pointerdown on the canvas should initiate panning.
 * @param {'select' | 'hand'} tool - Current active tool
 * @param {boolean} isSpacePressed - Whether space bar is held
 * @param {number} button - Mouse button (0 = left, 1 = middle, 2 = right)
 * @returns {boolean}
 */
export function shouldPan(tool, isSpacePressed, button) {
    if (button === 1) return true; // Middle mouse always pans
    if (button === 0) {
        return tool === 'hand' || !!isSpacePressed;
    }
    return false;
}

/**
 * Resolves the effective cursor style for the canvas based on tool and pan state.
 * @param {'select' | 'hand'} tool
 * @param {boolean} isSpacePressed
 * @param {boolean} isPanning
 * @returns {string}
 */
export function getToolCursor(tool, isSpacePressed, isPanning) {
    if (isPanning) return 'grabbing';
    if (tool === 'hand' || isSpacePressed) return 'grab';
    return 'default';
}

/**
 * Checks whether an active element should consume single-key tool shortcuts (V, H) as text entry.
 * @param {{ tagName?: string, isContentEditable?: boolean } | null | undefined} target
 * @returns {boolean}
 */
export function isEditableElement(target) {
    if (!target) return false;
    const tag = (target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(target.isContentEditable);
}

/**
 * Given a box position, dimensions, and a diagram point (e.g. drop point),
 * returns the side ('top' | 'right' | 'bottom' | 'left') closest to that point.
 * @param {{ x: number, y: number }} boxPos
 * @param {{ width?: number, height?: number }} boxDims
 * @param {{ x: number, y: number }} point
 * @returns {'top' | 'right' | 'bottom' | 'left'}
 */
export function getNearestSide(boxPos, boxDims, point) {
    if (!boxPos || !point) return 'top';
    const w = (boxDims && boxDims.width) || 140;
    const h = (boxDims && boxDims.height) || 60;

    const sides = [
        { side: 'top', x: boxPos.x, y: boxPos.y - h / 2 },
        { side: 'right', x: boxPos.x + w / 2, y: boxPos.y },
        { side: 'bottom', x: boxPos.x, y: boxPos.y + h / 2 },
        { side: 'left', x: boxPos.x - w / 2, y: boxPos.y }
    ];

    let minDistance = Infinity;
    let closestSide = 'top';

    for (const s of sides) {
        const dx = point.x - s.x;
        const dy = point.y - s.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistance) {
            minDistance = distSq;
            closestSide = s.side;
        }
    }

    return closestSide;
}

/**
 * Picks attachment sides for an arrow based on box geometry and node semantics.
 *
 * Rules:
 * 1. Generic dominant axis rule:
 *    - Vertical dominant (|dy| >= |dx|):
 *      - if dy >= 0 (target is below source): source bottom -> target top
 *      - if dy < 0 (target is above source): source top -> target bottom
 *    - Horizontal dominant (|dx| > |dy|):
 *      - if dx >= 0 (target is right of source): source right -> target left
 *      - if dx < 0 (target is left of source): source left -> target right
 *
 * 2. Decision boxes:
 *    - The arrow arriving from the previous box enters at 'top'.
 *    - "YES" outgoing arrow leaves from 'bottom'.
 *    - "NO" outgoing arrow leaves from 'right'.
 *    - A back-edge into the decision (loop, where source.y >= decision.y) enters at 'left'.
 *
 * 3. Fallback collision rule:
 *    - If a preferred decision side is already used by another arrow of the same kind
 *      (e.g., another outgoing arrow from the same source, or another incoming arrow to the same target),
 *      fall back to the generic dominant axis rule.
 *
 * @param {object} edge - { from: string, to: string, label?: string | null }
 * @param {object} [fromNode] - { id: string, type: string }
 * @param {object} [toNode] - { id: string, type: string }
 * @param {{ x: number, y: number }} [fromPos] - Position of source box
 * @param {{ x: number, y: number }} [toPos] - Position of target box
 * @param {object} [context] - { usedFromSides?: Set<string>, usedToSides?: Set<string> }
 * @returns {{ fromSide: 'top'|'right'|'bottom'|'left', toSide: 'top'|'right'|'bottom'|'left' }}
 */
export function pickEdgeSides(edge, fromNode, toNode, fromPos, toPos, context = {}) {
    const fp = fromPos || { x: 0, y: 0 };
    const tp = toPos || { x: 0, y: 0 };
    const dx = tp.x - fp.x;
    const dy = tp.y - fp.y;

    // 1. Generic dominant axis rule
    let genericFromSide;
    let genericToSide;
    if (Math.abs(dy) >= Math.abs(dx)) {
        if (dy >= 0) {
            genericFromSide = 'bottom';
            genericToSide = 'top';
        } else {
            genericFromSide = 'top';
            genericToSide = 'bottom';
        }
    } else {
        if (dx >= 0) {
            genericFromSide = 'right';
            genericToSide = 'left';
        } else {
            genericFromSide = 'left';
            genericToSide = 'right';
        }
    }

    const usedFrom = context.usedFromSides || new Set();
    const usedTo = context.usedToSides || new Set();

    let fromSide = genericFromSide;
    let toSide = genericToSide;

    const fromType = fromNode ? fromNode.type : null;
    const toType = toNode ? toNode.type : null;
    const labelUpper = edge && edge.label ? String(edge.label).trim().toUpperCase() : '';

    // 2. Decision source rules:
    if (fromType === 'dec') {
        let preferredFrom = null;
        if (labelUpper === 'YES') {
            preferredFrom = 'bottom';
        } else if (labelUpper === 'NO') {
            preferredFrom = 'right';
        }

        if (preferredFrom) {
            if (!usedFrom.has(preferredFrom)) {
                fromSide = preferredFrom;
            } else {
                fromSide = genericFromSide;
            }
        }
    }

    // 3. Decision target rules:
    if (toType === 'dec') {
        let preferredTo = null;
        const isBack = fp.y >= tp.y;
        if (isBack) {
            preferredTo = 'left';
        } else {
            preferredTo = 'top';
        }

        if (preferredTo) {
            if (!usedTo.has(preferredTo)) {
                toSide = preferredTo;
            } else {
                toSide = genericToSide;
            }
        }
    }

    // If source is a back-edge loop into decision and curves from left:
    if (toType === 'dec' && fp.y >= tp.y && toSide === 'left' && fromType !== 'dec') {
        fromSide = 'left';
    }

    return { fromSide, toSide };
}

/**
 * Computes default attachment sides for all edges in a representation based on layout positions.
 * @param {object} representation - { nodes: any[], edges: any[] }
 * @param {Record<string, { x: number, y: number }>} positions
 * @returns {Record<string, { fromSide: 'top'|'right'|'bottom'|'left', toSide: 'top'|'right'|'bottom'|'left' }>}
 */
export function computeAllEdgeSides(representation, positions) {
    if (!representation || !Array.isArray(representation.edges) || !positions) {
        return {};
    }

    const nodes = Array.isArray(representation.nodes) ? representation.nodes : [];
    const nodeMap = new Map();
    nodes.forEach(n => nodeMap.set(n.id, n));

    const usedFromByNode = new Map();
    const usedToByNode = new Map();
    const result = {};

    for (const edge of representation.edges) {
        const fromNode = nodeMap.get(edge.from);
        const toNode = nodeMap.get(edge.to);
        const fromPos = positions[edge.from];
        const toPos = positions[edge.to];

        if (!fromPos || !toPos) continue;

        if (!usedFromByNode.has(edge.from)) usedFromByNode.set(edge.from, new Set());
        if (!usedToByNode.has(edge.to)) usedToByNode.set(edge.to, new Set());

        const context = {
            usedFromSides: usedFromByNode.get(edge.from),
            usedToSides: usedToByNode.get(edge.to)
        };

        const sides = pickEdgeSides(edge, fromNode, toNode, fromPos, toPos, context);
        usedFromByNode.get(edge.from).add(sides.fromSide);
        usedToByNode.get(edge.to).add(sides.toSide);

        result[`${edge.from}->${edge.to}`] = sides;
    }

    return result;
}

/**
 * Returns the standard filename for downloading generated pseudocode.
 * @returns {string}
 */
export function getDownloadPseudocodeFilename() {
    return 'sketchpiler-pseudocode.txt';
}

/**
 * Checks whether pseudocode text exists and is eligible for download.
 * @param {string|null|undefined} pseudocode
 * @returns {boolean}
 */
export function isDownloadEnabled(pseudocode) {
    return Boolean(pseudocode && typeof pseudocode === 'string' && pseudocode.trim().length > 0);
}

/**
 * Returns the appropriate tooltip title for the pseudocode download button.
 * @param {boolean|string|null|undefined} enabledOrPseudocode
 * @returns {string}
 */
export function getDownloadButtonTitle(enabledOrPseudocode) {
    const isOk = typeof enabledOrPseudocode === 'boolean'
        ? enabledOrPseudocode
        : isDownloadEnabled(enabledOrPseudocode);
    return isOk ? 'Download pseudocode as .txt' : 'Nothing to download yet';
}

/**
 * Formats the save status string based on elapsed time.
 * @param {number|null|undefined} lastSavedTimeMs
 * @param {number} [nowMs]
 * @returns {string}
 */
export function formatSaveStatus(lastSavedTimeMs, nowMs) {
    if (lastSavedTimeMs == null || typeof lastSavedTimeMs !== 'number') {
        return 'Saved just now';
    }
    const current = typeof nowMs === 'number' ? nowMs : Date.now();
    const diffMs = Math.max(0, current - lastSavedTimeMs);
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) {
        return 'Saved just now';
    }
    return `Saved ${mins} min ago`;
}

/**
 * Client-side structural validation of flowchart representation.
 * @param {any} rep
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateRepresentation(rep) {
    if (!rep || !Array.isArray(rep.nodes) || rep.nodes.length === 0) {
        return { valid: false, reason: "Flowchart contains no nodes" };
    }
    const nodes = rep.nodes;
    const edges = Array.isArray(rep.edges) ? rep.edges : [];
    const startNodes = nodes.filter(n => n.type === "start");
    if (startNodes.length === 0) return { valid: false, reason: "No start node found in diagram" };
    if (startNodes.length > 1) return { valid: false, reason: "Multiple start nodes found: " + startNodes.map(n => n.id).join(", ") };
    const endNodes = nodes.filter(n => n.type === "end");
    if (endNodes.length === 0) return { valid: false, reason: "No end node found in diagram" };

    const nodeMap = new Map();
    nodes.forEach(n => nodeMap.set(n.id, true));
    for (let i = 0; i < edges.length; i++) {
        if (!nodeMap.has(edges[i].from)) return { valid: false, reason: 'Edge references unknown source node: "' + edges[i].from + '" (to "' + edges[i].to + '")' };
        if (!nodeMap.has(edges[i].to)) return { valid: false, reason: 'Edge references unknown target node: "' + edges[i].to + '" (from "' + edges[i].from + '")' };
    }

    const decNodes = nodes.filter(n => n.type === "dec");
    for (let j = 0; j < decNodes.length; j++) {
        const out = edges.filter(e => e.from === decNodes[j].id);
        if (out.length < 2) return { valid: false, reason: "Decision node " + decNodes[j].id + " has fewer than 2 outgoing edges (" + out.length + " found)" };
    }

    const reachable = new Set();
    const queue = [startNodes[0].id];
    reachable.add(startNodes[0].id);
    while (queue.length > 0) {
        const cur = queue.shift();
        for (let k = 0; k < edges.length; k++) {
            if (edges[k].from === cur && nodeMap.has(edges[k].to) && !reachable.has(edges[k].to)) {
                reachable.add(edges[k].to);
                queue.push(edges[k].to);
            }
        }
    }
    for (let m = 0; m < nodes.length; m++) {
        if (!reachable.has(nodes[m].id)) {
            return { valid: false, reason: "Orphan node unreachable from start: " + nodes[m].id + " (" + nodes[m].type + ' "' + (nodes[m].text || "") + '")' };
        }
    }
    return { valid: true };
}

/**
 * Generates a unique diagram sourceId.
 * Uses crypto.randomUUID when available, with a timestamp fallback.
 * @returns {string}
 */
export function generateSourceId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try {
            return crypto.randomUUID();
        } catch (_) { }
    }
    return 'src-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * Pure decision rule for editor startup.
 *
 * @param {object} [options]
 * @param {boolean} [options.arrivedFromReview=false] - Whether arrived from Review ("Edit this diagram")
 * @param {string|null|undefined} [options.resultSourceId] - sourceId of current result in Review
 * @param {string|null|undefined} [options.autosaveSourceId] - sourceId stored in the autosave
 * @param {boolean} [options.hasResult=false] - Whether a valid result diagram is present in storage
 * @param {boolean} [options.hasAutosave=false] - Whether a valid autosave diagram is present in storage
 * @returns {{ action: 'restore-autosave' | 'load-result' | 'load-sample', decision: 'restore-autosave' | 'load-result' | 'load-sample', reason: string }}
 */
export function decideEditorLoad({
    arrivedFromReview = false,
    resultSourceId = null,
    autosaveSourceId = null,
    hasResult = false,
    hasAutosave = false
} = {}) {
    if (!arrivedFromReview) {
        // Opened directly (nav link, reload, bookmark, no arrival flag):
        // restore the autosave if it exists, otherwise the result, otherwise the sample.
        // NEVER discard an autosave in this case.
        if (hasAutosave) {
            return {
                action: 'restore-autosave',
                decision: 'restore-autosave',
                reason: 'Direct open: existing autosave restored'
            };
        }
        if (hasResult) {
            return {
                action: 'load-result',
                decision: 'load-result',
                reason: 'Direct open: loaded current result'
            };
        }
        return {
            action: 'load-sample',
            decision: 'load-sample',
            reason: 'Direct open: loaded default sample'
        };
    }

    // Arrived from Review ("Edit this diagram"):
    // restore the autosave only when both ids exist and match; otherwise load the current result.
    // Missing ids on either side count as "different" for the Review arrival.
    const idsMatch = Boolean(resultSourceId) &&
                     Boolean(autosaveSourceId) &&
                     resultSourceId === autosaveSourceId;

    if (hasAutosave && idsMatch) {
        return {
            action: 'restore-autosave',
            decision: 'restore-autosave',
            reason: 'Review arrival: autosave sourceId matches current result; restored autosave'
        };
    }

    if (hasResult) {
        return {
            action: 'load-result',
            decision: 'load-result',
            reason: hasAutosave
                ? 'Review arrival: autosave sourceId differs or is missing; loaded current result'
                : 'Review arrival: no autosave found; loaded current result'
        };
    }

    return {
        action: 'load-sample',
        decision: 'load-sample',
        reason: 'Review arrival: no result found; loaded default sample'
    };
}

/**
 * Resolves source chip wording:
 * - "Loaded from Review" after a fresh load
 * - "Restored your edits" after an autosave restore
 * - "Recorded example" for the recorded sample
 *
 * @param {object} options
 * @param {'restore-autosave' | 'load-result' | 'load-sample'} options.decision
 * @param {string|null|undefined} [options.sourceFlag]
 * @returns {string}
 */
export function getSourceChipLabel({ decision, sourceFlag }) {
    if (decision === 'restore-autosave') {
        return 'Restored your edits';
    }
    if (decision === 'load-sample') {
        return 'Recorded example';
    }
    if (sourceFlag === 'recorded') {
        return 'Recorded example';
    }
    return 'Loaded from Review';
}

export const PREVIOUS_AUTOSAVE_KEY = 'flowchart_editor_previous_state';

/**
 * Saves replaced autosave to the single "previous" slot.
 * Overwrites any older previous slot (never appends).
 *
 * @param {object} storage
 * @param {string|object} state
 */
export function savePreviousSlot(storage, state) {
    if (!storage || typeof storage.setItem !== 'function') return;
    const value = typeof state === 'string' ? state : JSON.stringify(state);
    storage.setItem(PREVIOUS_AUTOSAVE_KEY, value);
}

/**
 * Retrieves state from the single "previous" slot.
 *
 * @param {object} storage
 * @returns {any}
 */
export function getPreviousSlot(storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    const raw = storage.getItem(PREVIOUS_AUTOSAVE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

/**
 * Swaps active autosave and previous autosave.
 *
 * @param {object} currentActive
 * @param {object} previousState
 * @returns {{ newActive: object, newPrevious: object }}
 */
export function swapAutosaveWithPrevious(currentActive, previousState) {
    return {
        newActive: clone(previousState),
        newPrevious: clone(currentActive)
    };
}

/**
 * Performs client-side "Done" round-trip saving.
 * Preserves the exact same sourceId.
 *
 * @param {object} editorState
 * @param {string} sourceId
 * @returns {object}
 */
export function applyDoneRoundTrip(editorState, sourceId) {
    return {
        representation: clone(editorState.representation),
        positions: clone(editorState.positions),
        edgeSides: clone(editorState.edgeSides || {}),
        sourceId: sourceId,
        isEditor: true
    };
}

/**
 * Loads a legacy diagram/autosave object without a sourceId.
 *
 * @param {object} raw
 * @returns {{ representation: any, positions: any, edgeSides: any, sourceId: string|null }}
 */
export function loadLegacyDiagram(raw) {
    if (!raw || !raw.representation) {
        return { representation: null, positions: null, edgeSides: {}, sourceId: null };
    }
    return {
        representation: clone(raw.representation),
        positions: raw.positions ? clone(raw.positions) : null,
        edgeSides: raw.edgeSides ? clone(raw.edgeSides) : {},
        sourceId: raw.sourceId || null
    };
}


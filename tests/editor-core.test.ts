// Unit tests for canvas editor geometry, layout, history, and graph manipulation.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDsl } from '../src/parser.js';
import {
  autoLayout,
  edgePath,
  isBackEdge,
  createHistory,
  addBox,
  deleteBox,
  setBoxText,
  setBoxKind,
  addEdge,
  deleteEdge,
  setEdgeLabel,
  setEdgeEnds,
  clampZoom,
  zoomAroundPoint,
  screenToDiagram,
  diagramToScreen,
  computeBounds,
  fitToBounds,
  duplicateBox,
  nudgeBox,
  boxesInRect,
  alignBoxes,
  distributeBoxes,
  snapToGrid,
  snapPositionsToGrid,
  moveGroup,
  duplicateGroup,
  deleteGroup,
  shouldPan,
  getToolCursor,
  isEditableElement,
  getBoxSidePoint,
  getNearestSide,
  pickEdgeSides,
  computeAllEdgeSides,
  getDownloadPseudocodeFilename,
  isDownloadEnabled,
  getDownloadButtonTitle,
  formatSaveStatus,
  validateRepresentation,
  generateSourceId,
  decideEditorLoad,
  getSourceChipLabel,
  PREVIOUS_AUTOSAVE_KEY,
  savePreviousSlot,
  getPreviousSlot,
  swapAutosaveWithPrevious,
  applyDoneRoundTrip,
  loadLegacyDiagram,
} from '../public/js/editor-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

describe('editor-core: autoLayout', () => {
  it('01_sum_of_n fixture: places every id, ignores loop-back for levels, no two boxes overlap', () => {
    const dsl = fs.readFileSync(path.join(fixturesDir, '01_sum_of_n.txt'), 'utf8');
    const parsed = parseDsl(dsl);
    const rep = parsed.representation;

    const positions = autoLayout(rep);

    // 1. Every id placed
    for (const node of rep.nodes) {
      assert.ok(positions[node.id], `Node ${node.id} missing from layout positions`);
      assert.strictEqual(typeof positions[node.id].x, 'number');
      assert.strictEqual(typeof positions[node.id].y, 'number');
    }

    // 2. Loop-back edge (N5 -> N4) ignored for levels:
    // N1 (level 0), N2 (level 1), N3 (level 2), N4 (level 3), N5 & N6 (level 4), N7 (level 5)
    assert.ok(positions['N1'].y < positions['N2'].y);
    assert.ok(positions['N2'].y < positions['N3'].y);
    assert.ok(positions['N3'].y < positions['N4'].y);
    assert.ok(positions['N4'].y < positions['N5'].y);
    assert.ok(positions['N4'].y < positions['N6'].y);
    // N5 and N6 are at the same level (same y)
    assert.strictEqual(positions['N5'].y, positions['N6'].y);
    // N7 is below N5/N6
    assert.ok(positions['N5'].y < positions['N7'].y);
    assert.ok(positions['N6'].y < positions['N7'].y);

    // 3. No two boxes overlap (assuming box width 150, height 60)
    const boxW = 150;
    const boxH = 60;
    const ids = Object.keys(positions);

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const p1 = positions[ids[i]];
        const p2 = positions[ids[j]];

        const dx = Math.abs(p1.x - p2.x);
        const dy = Math.abs(p1.y - p2.y);
        const overlaps = dx < boxW && dy < boxH;
        assert.ok(!overlaps, `Box ${ids[i]} and ${ids[j]} overlap! dx=${dx}, dy=${dy}`);
      }
    }
  });

  it('disconnected node placed at the bottom', () => {
    const rep = {
      schemaVersion: 1,
      type: 'flowchart',
      nodes: [
        { id: 'N1', type: 'start', text: 'Start', uncertain: false },
        { id: 'N2', type: 'end', text: 'End', uncertain: false },
        { id: 'N3', type: 'proc', text: 'Disconnected Step', uncertain: false },
      ],
      edges: [
        { from: 'N1', to: 'N2', label: null, uncertain: false },
      ],
    };

    const positions = autoLayout(rep);
    assert.ok(positions['N1'].y < positions['N2'].y);
    // N3 is disconnected, placed below connected nodes
    assert.ok(positions['N2'].y < positions['N3'].y);
  });

  it('empty graph returns empty layout object', () => {
    assert.deepStrictEqual(autoLayout({ nodes: [], edges: [] }), {});
    assert.deepStrictEqual(autoLayout(null), {});
  });
});

describe('editor-core: History', () => {
  it('undo, redo, branch clearing on push, and max limit 100', () => {
    const initial = { representation: { nodes: [{ id: 'N1' }], edges: [] }, positions: { N1: { x: 10, y: 10 } } };
    const history = createHistory(initial);

    assert.strictEqual(history.canUndo, false);
    assert.strictEqual(history.canRedo, false);

    // Push state 1
    const state1 = { representation: { nodes: [{ id: 'N1' }, { id: 'N2' }], edges: [] }, positions: { N1: { x: 10, y: 10 }, N2: { x: 20, y: 20 } } };
    history.push(state1);
    assert.strictEqual(history.canUndo, true);
    assert.strictEqual(history.canRedo, false);

    // Push state 2
    const state2 = { representation: { nodes: [{ id: 'N1' }, { id: 'N2' }, { id: 'N3' }], edges: [] }, positions: {} };
    history.push(state2);

    // Undo -> state 1
    const u1 = history.undo();
    assert.strictEqual(u1.representation.nodes.length, 2);
    assert.strictEqual(history.canUndo, true);
    assert.strictEqual(history.canRedo, true);

    // Redo -> state 2
    const r1 = history.redo();
    assert.strictEqual(r1.representation.nodes.length, 3);
    assert.strictEqual(history.canUndo, true);
    assert.strictEqual(history.canRedo, false);

    // Undo again, then push new state -> clears redo branch
    history.undo();
    const branchState = { representation: { nodes: [{ id: 'N_BRANCH' }], edges: [] }, positions: {} };
    history.push(branchState);
    assert.strictEqual(history.canRedo, false); // redo branch cleared!
    assert.strictEqual(history.state.representation.nodes[0].id, 'N_BRANCH');

    // Max 100 steps limit test
    const h2 = createHistory({ representation: { nodes: [] }, positions: {} });
    for (let i = 1; i <= 150; i++) {
      h2.push({ representation: { nodes: [{ id: `N${i}` }] }, positions: {} });
    }
    // Can undo at most 100 times
    let undoCount = 0;
    while (h2.canUndo) {
      h2.undo();
      undoCount++;
    }
    assert.strictEqual(undoCount, 100);
  });

  it('createHistory: state getter returns a clone, preventing external property mutation', () => {
    const h = createHistory({
      representation: { nodes: [{ id: 'N1' }], edges: [] },
      positions: { N1: { x: 100, y: 100 } }
    });
    // Attempting to mutate property on getter clone does not affect internal state
    h.state.positions.N1 = { x: 999, y: 999 };
    assert.strictEqual(h.state.positions.N1.x, 100);
    assert.strictEqual(h.state.positions.N1.y, 100);
  });
});

describe('editor-core: Edit operations', () => {
  const baseState = {
    representation: {
      schemaVersion: 1,
      type: 'flowchart',
      nodes: [
        { id: 'N1', type: 'start', text: 'Start', uncertain: false },
        { id: 'N2', type: 'dec', text: 'Check ?', uncertain: false },
        { id: 'N3', type: 'end', text: 'End', uncertain: false },
      ],
      edges: [
        { from: 'N1', to: 'N2', label: null, uncertain: false },
        { from: 'N2', to: 'N3', label: null, uncertain: false },
      ],
    },
    positions: {
      N1: { x: 500, y: 50 },
      N2: { x: 500, y: 150 },
      N3: { x: 500, y: 250 },
    },
  };

  it('addBox: adds box with next free ID without mutating original state', () => {
    const nextState = addBox(baseState, 'proc', 'My new step');

    assert.notStrictEqual(nextState, baseState);
    assert.strictEqual(baseState.representation.nodes.length, 3); // no mutation
    assert.strictEqual(nextState.representation.nodes.length, 4);

    const newNode = nextState.representation.nodes[3];
    assert.strictEqual(newNode.id, 'N4');
    assert.strictEqual(newNode.type, 'proc');
    assert.strictEqual(newNode.text, 'My new step');
    assert.ok(nextState.positions['N4']);
  });

  it('deleteBox: deletes box AND cascade deletes its arrows', () => {
    const nextState = deleteBox(baseState, 'N2');

    assert.strictEqual(baseState.representation.nodes.length, 3); // no mutation
    assert.strictEqual(nextState.representation.nodes.length, 2);
    assert.ok(!nextState.representation.nodes.some((n: any) => n.id === 'N2'));

    // Both edges connected to N2 removed
    assert.strictEqual(nextState.representation.edges.length, 0);
    assert.strictEqual(nextState.positions['N2'], undefined);
  });

  it('setBoxText and setBoxKind: update node properties', () => {
    const s1 = setBoxText(baseState, 'N1', 'Begin');
    assert.strictEqual(s1.representation.nodes[0].text, 'Begin');
    assert.strictEqual(baseState.representation.nodes[0].text, 'Start'); // no mutation

    const s2 = setBoxKind(baseState, 'N1', 'proc');
    assert.strictEqual(s2.representation.nodes[0].type, 'proc');
    assert.strictEqual(baseState.representation.nodes[0].type, 'start'); // no mutation
  });

  it('addEdge: rejects self-loop and duplicate edge with reason', () => {
    // 1. Self-loop
    const r1 = addEdge(baseState, 'N1', 'N1');
    assert.strictEqual(r1.success, false);
    assert.ok(r1.reason && r1.reason.includes('Self-loop'));

    // 2. Duplicate edge (N1 -> N2 already exists)
    const r2 = addEdge(baseState, 'N1', 'N2');
    assert.strictEqual(r2.success, false);
    assert.ok(r2.reason && r2.reason.includes('already exists'));
  });

  it('addEdge: suggests Yes, then No when from is a decision node', () => {
    // Current edges from N2 has no label: N2 -> N3
    // Reset edges to test Yes/No cleanly
    const testState = {
      ...baseState,
      representation: {
        ...baseState.representation,
        nodes: [
          { id: 'N1', type: 'start', text: 'Start', uncertain: false },
          { id: 'N2', type: 'dec', text: 'i < 10 ?', uncertain: false },
          { id: 'N3', type: 'proc', text: 'Step A', uncertain: false },
          { id: 'N4', type: 'proc', text: 'Step B', uncertain: false },
        ],
        edges: [],
      },
    };

    // First outgoing edge from N2: should suggest "Yes"
    const res1 = addEdge(testState, 'N2', 'N3');
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.suggestedLabel, 'Yes');
    assert.strictEqual(res1.state.representation.edges[0].label, 'Yes');

    // Second outgoing edge from N2: should suggest "No"
    const res2 = addEdge(res1.state, 'N2', 'N4');
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.suggestedLabel, 'No');
    assert.strictEqual(res2.state.representation.edges[1].label, 'No');
  });

  it('deleteEdge, setEdgeLabel, setEdgeEnds work correctly', () => {
    // deleteEdge by index
    const s1 = deleteEdge(baseState, 0);
    assert.strictEqual(s1.representation.edges.length, 1);
    assert.strictEqual(s1.representation.edges[0].from, 'N2');

    // setEdgeLabel
    const s2 = setEdgeLabel(baseState, 0, 'New Label');
    assert.strictEqual(s2.representation.edges[0].label, 'New Label');

    // setEdgeEnds
    const s3 = setEdgeEnds(baseState, 0, 'N1', 'N3');
    assert.strictEqual(s3.success, true);
    assert.strictEqual(s3.state.representation.edges[0].to, 'N3');

    // setEdgeEnds rejects self-loop
    const s4 = setEdgeEnds(baseState, 0, 'N1', 'N1');
    assert.strictEqual(s4.success, false);
    assert.ok(s4.reason && s4.reason.includes('Self-loop'));
  });
});

describe('editor-core: edgePath', () => {
  it('forward edge: straight line border to border with midpoint label', () => {
    const fromBox = { x: 500, y: 100, width: 140, height: 60 };
    const toBox = { x: 500, y: 240, width: 140, height: 60 };

    const { path, labelPoint } = edgePath(fromBox, toBox, false);

    assert.ok(path.startsWith('M'));
    assert.ok(path.includes('L'));
    // Start should be bottom of fromBox: (500, 130)
    // End should be top of toBox: (500, 210)
    assert.strictEqual(path, 'M 500 130 L 500 210');
    assert.deepStrictEqual(labelPoint, { x: 500, y: 170 });
  });

  it('back edge: curves out to the side with Bezier curve and offset label', () => {
    const fromBox = { x: 390, y: 620, width: 140, height: 60 };
    const toBox = { x: 500, y: 480, width: 140, height: 60 };

    assert.strictEqual(isBackEdge({ from: 'N5', to: 'N4' }, { N5: fromBox, N4: toBox }), true);

    const { path, labelPoint } = edgePath(fromBox, toBox, true);

    assert.ok(path.startsWith('M'));
    assert.ok(path.includes('C')); // Cubic bezier curve
    // Label point should be shifted to the left (x < min(x1, x2))
    assert.ok(labelPoint.x < fromBox.x - fromBox.width / 2);
  });
});

describe('editor-core: Zoom and Screen-to-Diagram math', () => {
  it('clampZoom: clamps zoom between 0.25 (25%) and 3.0 (300%)', () => {
    assert.strictEqual(clampZoom(0.1), 0.25);
    assert.strictEqual(clampZoom(4.5), 3.0);
    assert.strictEqual(clampZoom(1.5), 1.5);
  });

  it('screenToDiagram and diagramToScreen are exact inverses', () => {
    const panX = 120;
    const panY = 80;
    const zoom = 1.5;

    const screen = { x: 345, y: 260 };
    const diag = screenToDiagram(screen.x, screen.y, panX, panY, zoom);
    const convertedBack = diagramToScreen(diag.x, diag.y, panX, panY, zoom);

    assert.strictEqual(Math.round(convertedBack.x), screen.x);
    assert.strictEqual(Math.round(convertedBack.y), screen.y);
  });

  it('zoomAroundPoint: diagram point under pointer remains invariant', () => {
    const pointer = { x: 400, y: 300 };
    const currentZoom = 1.0;
    const pan = { x: 50, y: 50 };

    // Diagram point before zoom
    const diagBefore = screenToDiagram(pointer.x, pointer.y, pan.x, pan.y, currentZoom);

    // Zoom in to 2.0
    const result = zoomAroundPoint(currentZoom, 2.0, pointer.x, pointer.y, pan.x, pan.y);
    assert.strictEqual(result.zoom, 2.0);

    // Diagram point after zoom should map back to the same pointer screen position
    const screenAfter = diagramToScreen(diagBefore.x, diagBefore.y, result.panX, result.panY, result.zoom);
    assert.strictEqual(Math.round(screenAfter.x), pointer.x);
    assert.strictEqual(Math.round(screenAfter.y), pointer.y);
  });
});

describe('editor-core: fitToBounds', () => {
  it('computes bounds and centers diagram within viewport with padding and zoom clamping', () => {
    const positions = {
      N1: { x: 200, y: 100 },
      N2: { x: 600, y: 500 },
    };

    const bounds = computeBounds(positions, { width: 140, height: 60 });
    // minX = 200 - 70 = 130, maxX = 600 + 70 = 670, width = 540
    // minY = 100 - 30 = 70, maxY = 500 + 30 = 530, height = 460
    assert.strictEqual(bounds.width, 540);
    assert.strictEqual(bounds.height, 460);

    const vpW = 1000;
    const vpH = 700;
    const fit = fitToBounds(bounds, vpW, vpH, { padding: 40 });

    assert.ok(fit.zoom >= 0.25 && fit.zoom <= 3.0);
    // Center in diagram space
    const centerDiagX = (bounds.minX + bounds.maxX) / 2;
    const centerDiagY = (bounds.minY + bounds.maxY) / 2;
    // Map center to screen using fit.panX, fit.panY, fit.zoom
    const centerScreenX = centerDiagX * fit.zoom + fit.panX;
    const centerScreenY = centerDiagY * fit.zoom + fit.panY;

    assert.strictEqual(Math.round(centerScreenX), vpW / 2);
    assert.strictEqual(Math.round(centerScreenY), vpH / 2);
  });

  it('handles empty bounds gracefully', () => {
    const bounds = computeBounds({});
    const fit = fitToBounds(bounds, 800, 600);
    assert.strictEqual(fit.zoom, 1.0);
    assert.strictEqual(fit.panX, 400);
    assert.strictEqual(fit.panY, 300);
  });
});

describe('editor-core: duplicateBox and nudgeBox', () => {
  const baseState = {
    representation: {
      schemaVersion: 1,
      type: 'flowchart',
      nodes: [
        { id: 'N1', type: 'proc', text: 'Step 1', uncertain: false },
        { id: 'N2', type: 'io', text: 'Output', uncertain: false },
      ],
      edges: [
        { from: 'N1', to: 'N2', label: null, uncertain: false },
      ],
    },
    positions: {
      N1: { x: 300, y: 150 },
      N2: { x: 300, y: 300 },
    },
  };

  it('duplicateBox: creates a new box with next free ID and offset position without mutating', () => {
    const nextState = duplicateBox(baseState, 'N1', { x: 40, y: 40 });

    assert.notStrictEqual(nextState, baseState);
    assert.strictEqual(baseState.representation.nodes.length, 2); // unmutated
    assert.strictEqual(nextState.representation.nodes.length, 3);

    const dup = nextState.representation.nodes[2];
    assert.strictEqual(dup.id, 'N3');
    assert.strictEqual(dup.type, 'proc');
    assert.strictEqual(dup.text, 'Step 1');
    assert.deepStrictEqual(nextState.positions['N3'], { x: 340, y: 190 });
  });

  it('nudgeBox: updates position by dx, dy without mutating', () => {
    const nudged10 = nudgeBox(baseState, 'N1', 10, 0);
    assert.notStrictEqual(nudged10, baseState);
    assert.strictEqual(baseState.positions['N1'].x, 300); // unmutated
    assert.strictEqual(nudged10.positions['N1'].x, 310);
    assert.strictEqual(nudged10.positions['N1'].y, 150);

    const nudged50 = nudgeBox(baseState, 'N1', 0, 50);
    assert.strictEqual(nudged50.positions['N1'].y, 200);
  });
});

describe('editor-core: autoLayout direction and spacing options', () => {
  it('01_sum_of_n fixture in left-right direction: places all ids, no overlaps, loop-back ignored', () => {
    const dsl = fs.readFileSync(path.join(fixturesDir, '01_sum_of_n.txt'), 'utf8');
    const parsed = parseDsl(dsl);
    const rep = parsed.representation;

    const positions = autoLayout(rep, { direction: 'left-right', spacing: 'normal' });

    // 1. Every id placed
    for (const node of rep.nodes) {
      assert.ok(positions[node.id], `Node ${node.id} missing from layout positions`);
      assert.strictEqual(typeof positions[node.id].x, 'number');
      assert.strictEqual(typeof positions[node.id].y, 'number');
    }

    // 2. Left-to-right ordering along x:
    // N1 (lvl 0) < N2 (lvl 1) < N3 (lvl 2) < N4 (lvl 3) < N5/N6 (lvl 4) < N7 (lvl 5)
    assert.ok(positions['N1'].x < positions['N2'].x);
    assert.ok(positions['N2'].x < positions['N3'].x);
    assert.ok(positions['N3'].x < positions['N4'].x);
    assert.ok(positions['N4'].x < positions['N5'].x);
    assert.ok(positions['N4'].x < positions['N6'].x);
    assert.strictEqual(positions['N5'].x, positions['N6'].x);
    assert.ok(positions['N5'].x < positions['N7'].x);

    // 3. No two boxes overlap (width 150, height 60)
    const boxW = 150;
    const boxH = 60;
    const ids = Object.keys(positions);

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const p1 = positions[ids[i]];
        const p2 = positions[ids[j]];
        const dx = Math.abs(p1.x - p2.x);
        const dy = Math.abs(p1.y - p2.y);
        const overlaps = dx < boxW && dy < boxH;
        assert.ok(!overlaps, `Boxes ${ids[i]} and ${ids[j]} overlap in left-right layout! dx=${dx}, dy=${dy}`);
      }
    }
  });

  it('compact and roomy spacing change layout distances proportionally', () => {
    const rep = {
      schemaVersion: 1,
      type: 'flowchart',
      nodes: [
        { id: 'N1', type: 'start', text: 'Start', uncertain: false },
        { id: 'N2', type: 'end', text: 'End', uncertain: false },
      ],
      edges: [{ from: 'N1', to: 'N2', label: null, uncertain: false }],
    };

    const posCompact = autoLayout(rep, { direction: 'top-down', spacing: 'compact' });
    const posNormal = autoLayout(rep, { direction: 'top-down', spacing: 'normal' });
    const posRoomy = autoLayout(rep, { direction: 'top-down', spacing: 'roomy' });

    const distCompact = posCompact['N2'].y - posCompact['N1'].y;
    const distNormal = posNormal['N2'].y - posNormal['N1'].y;
    const distRoomy = posRoomy['N2'].y - posRoomy['N1'].y;

    assert.ok(distCompact < distNormal, 'Compact spacing should be smaller than normal');
    assert.ok(distNormal < distRoomy, 'Roomy spacing should be larger than normal');
  });
});

describe('editor-core: Multi-select hit test (boxesInRect)', () => {
  const positions = {
    N1: { x: 100, y: 100 }, // box: [30..170, 70..130]
    N2: { x: 300, y: 100 }, // box: [230..370, 70..130]
    N3: { x: 500, y: 300 }, // box: [430..570, 270..330]
  };
  const dimsMap = {
    N1: { width: 140, height: 60 },
    N2: { width: 140, height: 60 },
    N3: { width: 140, height: 60 },
  };

  it('returns only boxes intersecting the selection rectangle', () => {
    // Rect enclosing N1 and partially overlapping N2
    const rect = { minX: 50, minY: 50, maxX: 250, maxY: 150 };
    const hits = boxesInRect(positions, dimsMap, rect);
    assert.ok(hits.includes('N1'));
    assert.ok(hits.includes('N2'));
    assert.ok(!hits.includes('N3'));
  });

  it('returns empty array when rect touches no boxes', () => {
    const rect = { minX: 1000, minY: 1000, maxX: 1200, maxY: 1200 };
    assert.deepStrictEqual(boxesInRect(positions, dimsMap, rect), []);
  });
});

describe('editor-core: Align and Distribute', () => {
  const positions = {
    A: { x: 100, y: 100 }, // w=100 -> left=50, right=150; h=50 -> top=75, bottom=125
    B: { x: 300, y: 150 }, // w=100 -> left=250, right=350; h=50 -> top=125, bottom=175
    C: { x: 600, y: 220 }, // w=100 -> left=550, right=650; h=50 -> top=195, bottom=245
  };
  const dimsMap = {
    A: { width: 100, height: 50 },
    B: { width: 100, height: 50 },
    C: { width: 100, height: 50 },
  };

  it('alignBoxes: left, center, right, top, middle, bottom', () => {
    // minLeft = 50. Left alignment: every box left edge = 50 -> center = 50 + 50 = 100
    const alignedLeft = alignBoxes(positions, dimsMap, ['A', 'B', 'C'], 'left');
    assert.strictEqual(alignedLeft['A'].x, 100);
    assert.strictEqual(alignedLeft['B'].x, 100);
    assert.strictEqual(alignedLeft['C'].x, 100);

    // maxRight = 650. Right alignment: every box right edge = 650 -> center = 650 - 50 = 600
    const alignedRight = alignBoxes(positions, dimsMap, ['A', 'B', 'C'], 'right');
    assert.strictEqual(alignedRight['A'].x, 600);
    assert.strictEqual(alignedRight['B'].x, 600);
    assert.strictEqual(alignedRight['C'].x, 600);

    // center: mid between minLeft(50) and maxRight(650) is 350
    const alignedCenter = alignBoxes(positions, dimsMap, ['A', 'B', 'C'], 'center');
    assert.strictEqual(alignedCenter['A'].x, 350);
    assert.strictEqual(alignedCenter['B'].x, 350);
    assert.strictEqual(alignedCenter['C'].x, 350);

    // minTop = 75. Top alignment: top = 75 -> center = 75 + 25 = 100
    const alignedTop = alignBoxes(positions, dimsMap, ['A', 'B', 'C'], 'top');
    assert.strictEqual(alignedTop['A'].y, 100);
    assert.strictEqual(alignedTop['B'].y, 100);
    assert.strictEqual(alignedTop['C'].y, 100);

    // middle: mid between minTop(75) and maxBottom(245) is 160
    const alignedMiddle = alignBoxes(positions, dimsMap, ['A', 'B', 'C'], 'middle');
    assert.strictEqual(alignedMiddle['A'].y, 160);
    assert.strictEqual(alignedMiddle['B'].y, 160);
    assert.strictEqual(alignedMiddle['C'].y, 160);

    // maxBottom = 245. Bottom alignment: bottom = 245 -> center = 245 - 25 = 220
    const alignedBottom = alignBoxes(positions, dimsMap, ['A', 'B', 'C'], 'bottom');
    assert.strictEqual(alignedBottom['A'].y, 220);
    assert.strictEqual(alignedBottom['B'].y, 220);
    assert.strictEqual(alignedBottom['C'].y, 220);
  });

  it('distributeBoxes: horizontal with equal gaps', () => {
    // Span: left=50 to right=650. Total box width = 100 * 3 = 300.
    // Remaining space = 600 - 300 = 300. Gap = 300 / 2 = 150.
    // Box A: left 50, right 150 -> x = 100
    // Box B: left 150 + 150 = 300, right 400 -> x = 350
    // Box C: left 400 + 150 = 550, right 650 -> x = 600
    const distH = distributeBoxes(positions, dimsMap, ['A', 'B', 'C'], 'horizontal');
    assert.strictEqual(distH['A'].x, 100);
    assert.strictEqual(distH['B'].x, 350);
    assert.strictEqual(distH['C'].x, 600);
  });

  it('distributeBoxes: vertical with equal gaps', () => {
    // Span: top=75 to bottom=245. Total box height = 50 * 3 = 150.
    // Remaining space = (245 - 75) - 150 = 170 - 150 = 20. Gap = 20 / 2 = 10.
    // Box A: top 75, bottom 125 -> y = 100
    // Box B: top 125 + 10 = 135, bottom 185 -> y = 160
    // Box C: top 185 + 10 = 195, bottom 245 -> y = 220
    const distV = distributeBoxes(positions, dimsMap, ['A', 'B', 'C'], 'vertical');
    assert.strictEqual(distV['A'].y, 100);
    assert.strictEqual(distV['B'].y, 160);
    assert.strictEqual(distV['C'].y, 220);
  });
});

describe('editor-core: Snap to Grid', () => {
  it('snapToGrid: rounds to nearest 20px', () => {
    assert.deepStrictEqual(snapToGrid({ x: 23, y: 49 }, 20), { x: 20, y: 40 });
    assert.deepStrictEqual(snapToGrid({ x: 31, y: 55 }, 20), { x: 40, y: 60 });
  });

  it('snapPositionsToGrid: snaps target node positions', () => {
    const pos = { A: { x: 22, y: 39 }, B: { x: 105, y: 208 } };
    const snapped = snapPositionsToGrid(pos, ['A'], 20);
    assert.deepStrictEqual(snapped['A'], { x: 20, y: 40 });
    assert.deepStrictEqual(snapped['B'], { x: 105, y: 208 }); // unchanged
  });
});

describe('editor-core: Group Move, Duplicate, and Delete', () => {
  const baseState = {
    representation: {
      schemaVersion: 1,
      type: 'flowchart',
      nodes: [
        { id: 'N1', type: 'proc', text: 'Step 1', uncertain: false },
        { id: 'N2', type: 'proc', text: 'Step 2', uncertain: false },
        { id: 'N3', type: 'proc', text: 'Step 3', uncertain: false },
      ],
      edges: [
        { from: 'N1', to: 'N2', label: 'edge1', uncertain: false },
        { from: 'N2', to: 'N3', label: 'edge2', uncertain: false },
      ],
    },
    positions: {
      N1: { x: 100, y: 100 },
      N2: { x: 200, y: 200 },
      N3: { x: 300, y: 300 },
    },
  };

  it('moveGroup: moves specified nodes by dx, dy without mutation', () => {
    const moved = moveGroup(baseState.positions, ['N1', 'N2'], 30, 40);
    assert.deepStrictEqual(moved['N1'], { x: 130, y: 140 });
    assert.deepStrictEqual(moved['N2'], { x: 230, y: 240 });
    assert.deepStrictEqual(moved['N3'], { x: 300, y: 300 }); // unchanged
    assert.strictEqual(baseState.positions['N1'].x, 100); // unmutated
  });

  it('moveGroup: moves single box by dx, dy without mutating original positions', () => {
    const moved = moveGroup(baseState.positions, ['N1'], 45, -25);
    assert.deepStrictEqual(moved['N1'], { x: 145, y: 75 });
    assert.deepStrictEqual(moved['N2'], { x: 200, y: 200 }); // unchanged
    assert.strictEqual(baseState.positions['N1'].x, 100); // unmutated
  });

  it('duplicateGroup: clones nodes AND replicates arrows between them', () => {
    // Duplicate N1 and N2 (connected by edge1)
    const res = duplicateGroup(baseState, ['N1', 'N2'], { x: 50, y: 50 });

    assert.strictEqual(res.representation.nodes.length, 5); // 3 original + 2 duplicated
    assert.strictEqual(res.newIds.length, 2);
    const [newId1, newId2] = res.newIds;
    assert.strictEqual(newId1, 'N4');
    assert.strictEqual(newId2, 'N5');

    // Arrow between N1 and N2 should be replicated between N4 and N5
    assert.strictEqual(res.representation.edges.length, 3); // 2 original + 1 replicated
    const replicatedEdge = res.representation.edges.find((e: any) => e.from === 'N4' && e.to === 'N5');
    assert.ok(replicatedEdge);
    assert.strictEqual(replicatedEdge.label, 'edge1');

    // Positions shifted by +50, +50
    assert.deepStrictEqual(res.positions['N4'], { x: 150, y: 150 });
    assert.deepStrictEqual(res.positions['N5'], { x: 250, y: 250 });
  });

  it('deleteGroup: deletes specified nodes and cascade deletes their arrows', () => {
    const res = deleteGroup(baseState, ['N1', 'N2']);
    assert.strictEqual(res.representation.nodes.length, 1);
    assert.strictEqual(res.representation.nodes[0].id, 'N3');
    // Both edges connected to N1 and N2 removed
    assert.strictEqual(res.representation.edges.length, 0);
    assert.strictEqual(res.positions['N1'], undefined);
    assert.strictEqual(res.positions['N2'], undefined);
    assert.ok(res.positions['N3']);
  });
});

describe('editor-core: Tool Mode Helpers (Select vs Hand)', () => {
  it('shouldPan: resolves when to initiate canvas panning', () => {
    // Select tool
    assert.strictEqual(shouldPan('select', false, 0), false);
    assert.strictEqual(shouldPan('select', true, 0), true);
    assert.strictEqual(shouldPan('select', false, 1), true); // middle click

    // Hand tool
    assert.strictEqual(shouldPan('hand', false, 0), true);
    assert.strictEqual(shouldPan('hand', true, 0), true);
    assert.strictEqual(shouldPan('hand', false, 1), true); // middle click

    // Right click (button === 2)
    assert.strictEqual(shouldPan('select', false, 2), false);
    assert.strictEqual(shouldPan('hand', false, 2), false);
  });

  it('getToolCursor: resolves appropriate cursor string', () => {
    assert.strictEqual(getToolCursor('select', false, false), 'default');
    assert.strictEqual(getToolCursor('select', true, false), 'grab');
    assert.strictEqual(getToolCursor('hand', false, false), 'grab');
    assert.strictEqual(getToolCursor('hand', true, false), 'grab');
    assert.strictEqual(getToolCursor('select', false, true), 'grabbing');
    assert.strictEqual(getToolCursor('hand', false, true), 'grabbing');
    assert.strictEqual(getToolCursor('select', true, true), 'grabbing');
  });

  it('isEditableElement: detects form controls and contentEditable targets', () => {
    assert.strictEqual(isEditableElement(null), false);
    assert.strictEqual(isEditableElement(undefined), false);
    assert.strictEqual(isEditableElement({ tagName: 'DIV' }), false);
    assert.strictEqual(isEditableElement({ tagName: 'BODY' }), false);
    assert.strictEqual(isEditableElement({ tagName: 'INPUT' }), true);
    assert.strictEqual(isEditableElement({ tagName: 'textarea' }), true);
    assert.strictEqual(isEditableElement({ tagName: 'select' }), true);
    assert.strictEqual(isEditableElement({ tagName: 'DIV', isContentEditable: true }), true);
  });
});

describe('editor-core: Arrow Attachment Sides & Smart Defaults (Round 5)', () => {
  it('getBoxSidePoint: returns correct anchor coordinates on box boundary', () => {
    const box = { x: 400, y: 300, width: 140, height: 60 };
    assert.deepStrictEqual(getBoxSidePoint(box, 'top'), { x: 400, y: 270 });
    assert.deepStrictEqual(getBoxSidePoint(box, 'right'), { x: 470, y: 300 });
    assert.deepStrictEqual(getBoxSidePoint(box, 'bottom'), { x: 400, y: 330 });
    assert.deepStrictEqual(getBoxSidePoint(box, 'left'), { x: 330, y: 300 });
  });

  it('getNearestSide: determines closest side of box to given pointer coordinate', () => {
    const boxPos = { x: 400, y: 300 };
    const boxDims = { width: 140, height: 60 };

    // Near top midpoint (400, 270)
    assert.strictEqual(getNearestSide(boxPos, boxDims, { x: 405, y: 260 }), 'top');
    // Near right midpoint (470, 300)
    assert.strictEqual(getNearestSide(boxPos, boxDims, { x: 480, y: 305 }), 'right');
    // Near bottom midpoint (400, 330)
    assert.strictEqual(getNearestSide(boxPos, boxDims, { x: 395, y: 340 }), 'bottom');
    // Near left midpoint (330, 300)
    assert.strictEqual(getNearestSide(boxPos, boxDims, { x: 320, y: 295 }), 'left');
  });

  it('pickEdgeSides: dominant axis generic rule (vertical and horizontal)', () => {
    const fromNode = { id: 'N1', type: 'proc' };
    const toNode = { id: 'N2', type: 'proc' };

    // Target below (dy = 150 > dx = 0) -> bottom -> top
    const res1 = pickEdgeSides({ from: 'N1', to: 'N2' }, fromNode, toNode, { x: 400, y: 100 }, { x: 400, y: 250 });
    assert.deepStrictEqual(res1, { fromSide: 'bottom', toSide: 'top' });

    // Target above (dy = -150) -> top -> bottom
    const res2 = pickEdgeSides({ from: 'N1', to: 'N2' }, fromNode, toNode, { x: 400, y: 250 }, { x: 400, y: 100 });
    assert.deepStrictEqual(res2, { fromSide: 'top', toSide: 'bottom' });

    // Target right (dx = 200 > dy = 0) -> right -> left
    const res3 = pickEdgeSides({ from: 'N1', to: 'N2' }, fromNode, toNode, { x: 400, y: 200 }, { x: 600, y: 200 });
    assert.deepStrictEqual(res3, { fromSide: 'right', toSide: 'left' });

    // Target left (dx = -200) -> left -> right
    const res4 = pickEdgeSides({ from: 'N1', to: 'N2' }, fromNode, toNode, { x: 600, y: 200 }, { x: 400, y: 200 });
    assert.deepStrictEqual(res4, { fromSide: 'left', toSide: 'right' });
  });

  it('pickEdgeSides: decision box rules for YES, NO, incoming and back-edge', () => {
    const decNode = { id: 'N4', type: 'dec' };
    const prevNode = { id: 'N3', type: 'proc' };
    const yesNode = { id: 'N5', type: 'proc' };
    const noNode = { id: 'N6', type: 'io' };

    const decPos = { x: 400, y: 300 };
    const prevPos = { x: 400, y: 150 };
    const yesPos = { x: 300, y: 450 };
    const noPos = { x: 550, y: 450 };

    // 1. Arrow arriving from previous box into decision enters at 'top'
    const incomingRes = pickEdgeSides({ from: 'N3', to: 'N4' }, prevNode, decNode, prevPos, decPos);
    assert.strictEqual(incomingRes.toSide, 'top');

    // 2. "YES" leaves from bottom of decision
    const yesRes = pickEdgeSides({ from: 'N4', to: 'N5', label: 'YES' }, decNode, yesNode, decPos, yesPos);
    assert.strictEqual(yesRes.fromSide, 'bottom');

    // 3. "NO" leaves from right of decision
    const noRes = pickEdgeSides({ from: 'N4', to: 'N6', label: 'NO' }, decNode, noNode, decPos, noPos);
    assert.strictEqual(noRes.fromSide, 'right');

    // 4. Back-edge loop into decision enters at 'left'
    const loopRes = pickEdgeSides({ from: 'N5', to: 'N4' }, yesNode, decNode, yesPos, decPos);
    assert.strictEqual(loopRes.toSide, 'left');
    assert.strictEqual(loopRes.fromSide, 'left'); // Curves out from left
  });

  it('pickEdgeSides: collision fallback when side already in use by same kind of edge', () => {
    const decNode = { id: 'N4', type: 'dec' };
    const targetNode = { id: 'N5', type: 'proc' };
    const decPos = { x: 400, y: 300 };
    const targetPos = { x: 400, y: 450 };

    // If 'bottom' is already used by another outgoing arrow from decNode
    const contextWithUsedBottom = {
      usedFromSides: new Set(['bottom'])
    };
    const res = pickEdgeSides(
      { from: 'N4', to: 'N5', label: 'YES' },
      decNode,
      targetNode,
      decPos,
      targetPos,
      contextWithUsedBottom
    );
    // Should fall back to generic rule
    assert.strictEqual(res.fromSide, 'bottom'); // generic dy > 0 is bottom, but if horizontal dominant:
    const horizTargetPos = { x: 600, y: 310 };
    const resHoriz = pickEdgeSides(
      { from: 'N4', to: 'N5', label: 'YES' },
      decNode,
      targetNode,
      decPos,
      horizTargetPos,
      contextWithUsedBottom
    );
    // Generic rule for dx=200, dy=10 is right -> left
    assert.strictEqual(resHoriz.fromSide, 'right');
  });

  it('computeAllEdgeSides: assigns sides for 01_sum_of_n style flowchart', () => {
    const rep = {
      nodes: [
        { id: 'N3', type: 'proc' },
        { id: 'N4', type: 'dec' },
        { id: 'N5', type: 'proc' },
        { id: 'N6', type: 'io' },
      ],
      edges: [
        { from: 'N3', to: 'N4', label: null },
        { from: 'N4', to: 'N5', label: 'YES' },
        { from: 'N4', to: 'N6', label: 'NO' },
        { from: 'N5', to: 'N4', label: null },
      ]
    };
    const positions = {
      N3: { x: 400, y: 150 },
      N4: { x: 400, y: 300 },
      N5: { x: 300, y: 450 },
      N6: { x: 550, y: 450 },
    };

    const sides = computeAllEdgeSides(rep, positions);

    // Incoming N3 -> N4 enters top of N4
    assert.deepStrictEqual(sides['N3->N4'], { fromSide: 'bottom', toSide: 'top' });
    // YES leaves bottom
    assert.strictEqual(sides['N4->N5'].fromSide, 'bottom');
    // NO leaves right
    assert.strictEqual(sides['N4->N6'].fromSide, 'right');
    // Back-edge N5 -> N4 enters left of N4 (no collision with N3->N4!)
    assert.deepStrictEqual(sides['N5->N4'], { fromSide: 'left', toSide: 'left' });
  });

  it('edgePath: honors explicit fromSide and toSide', () => {
    const fromBox = { x: 400, y: 100, width: 140, height: 60 };
    const toBox = { x: 400, y: 250, width: 140, height: 60 };

    // Explicit right -> left connection
    const { path, labelPoint } = edgePath(fromBox, toBox, false, 'right', 'left');
    // fromBox right is (470, 100), toBox left is (330, 250)
    assert.strictEqual(path, 'M 470 100 L 330 250');
    assert.deepStrictEqual(labelPoint, { x: 400, y: 175 });
  });

  it('edgePath: offsets YES/NO labels off the arrow line', () => {
    const fromBox = { x: 400, y: 100, width: 140, height: 60 };
    const toBox = { x: 400, y: 240, width: 140, height: 60 };

    // Vertical arrow without label: midpoint (400, 170)
    const resNoLabel = edgePath(fromBox, toBox, false, 'bottom', 'top', null);
    assert.deepStrictEqual(resNoLabel.labelPoint, { x: 400, y: 170 });

    // Vertical arrow with YES label: offset 14px to the right off the line
    const resYes = edgePath(fromBox, toBox, false, 'bottom', 'top', 'YES');
    assert.strictEqual(resYes.labelPoint.x, 414);
    assert.strictEqual(resYes.labelPoint.y, 170);

    // Horizontal arrow with NO label: offset 14px upwards off the line
    const fromH = { x: 400, y: 200, width: 140, height: 60 };
    const toH = { x: 600, y: 200, width: 140, height: 60 };
    const resNo = edgePath(fromH, toH, false, 'right', 'left', 'NO');
    assert.strictEqual(resNo.labelPoint.x, 500);
    assert.strictEqual(resNo.labelPoint.y, 186); // 200 - 14
  });

  it('addEdge, deleteBox, deleteGroup, duplicateGroup maintain edgeSides', () => {
    const state = {
      representation: {
        nodes: [
          { id: 'N1', type: 'proc', text: 'Step 1' },
          { id: 'N2', type: 'proc', text: 'Step 2' }
        ],
        edges: []
      },
      positions: {
        N1: { x: 100, y: 100 },
        N2: { x: 100, y: 250 }
      },
      edgeSides: {}
    };

    // addEdge with sides
    const addRes = addEdge(state, 'N1', 'N2', null, { fromSide: 'bottom', toSide: 'top' });
    assert.ok(addRes.success);
    assert.ok(addRes.state.edgeSides);
    assert.deepStrictEqual(addRes.state.edgeSides['N1->N2'], { fromSide: 'bottom', toSide: 'top' });

    // duplicateGroup duplicates edges and their sides
    const dupRes = duplicateGroup(addRes.state, ['N1', 'N2'], { x: 50, y: 50 });
    const newN1 = dupRes.newIds[0];
    const newN2 = dupRes.newIds[1];
    assert.ok(dupRes.edgeSides);
    assert.deepStrictEqual(dupRes.edgeSides[`${newN1}->${newN2}`], { fromSide: 'bottom', toSide: 'top' });

    // deleteBox removes connected edgeSides
    const delRes = deleteBox(addRes.state, 'N1');
    assert.ok(delRes.edgeSides);
    assert.strictEqual(delRes.edgeSides['N1->N2'], undefined);
  });
});

describe('editor-core: Round 7 Pure Functions', () => {
  it('getDownloadPseudocodeFilename returns sketchpiler-pseudocode.txt', () => {
    assert.strictEqual(getDownloadPseudocodeFilename(), 'sketchpiler-pseudocode.txt');
  });

  it('isDownloadEnabled checks pseudocode string content', () => {
    assert.strictEqual(isDownloadEnabled(null), false);
    assert.strictEqual(isDownloadEnabled(undefined), false);
    assert.strictEqual(isDownloadEnabled(''), false);
    assert.strictEqual(isDownloadEnabled('   \n  '), false);
    assert.strictEqual(isDownloadEnabled('START\n  x = 1\nEND'), true);
  });

  it('getDownloadButtonTitle provides correct accessible tooltips', () => {
    assert.strictEqual(getDownloadButtonTitle(false), 'Nothing to download yet');
    assert.strictEqual(getDownloadButtonTitle(true), 'Download pseudocode as .txt');
    assert.strictEqual(getDownloadButtonTitle(''), 'Nothing to download yet');
    assert.strictEqual(getDownloadButtonTitle('CODE'), 'Download pseudocode as .txt');
  });

  it('formatSaveStatus formats elapsed time correctly', () => {
    const base = 1000000;
    // Just now (< 60s)
    assert.strictEqual(formatSaveStatus(base, base), 'Saved just now');
    assert.strictEqual(formatSaveStatus(base, base + 29000), 'Saved just now');
    assert.strictEqual(formatSaveStatus(base, base + 59999), 'Saved just now');

    // 1 min ago
    assert.strictEqual(formatSaveStatus(base, base + 60000), 'Saved 1 min ago');
    assert.strictEqual(formatSaveStatus(base, base + 90000), 'Saved 1 min ago');
    assert.strictEqual(formatSaveStatus(base, base + 119999), 'Saved 1 min ago');

    // 2+ min ago
    assert.strictEqual(formatSaveStatus(base, base + 120000), 'Saved 2 min ago');
    assert.strictEqual(formatSaveStatus(base, base + 300000), 'Saved 5 min ago');

    // Edge cases
    assert.strictEqual(formatSaveStatus(null, base), 'Saved just now');
    assert.strictEqual(formatSaveStatus(undefined, base), 'Saved just now');
  });

  it('validateRepresentation checks diagram structural validity offline', () => {
    // Empty
    assert.deepStrictEqual(validateRepresentation(null), { valid: false, reason: 'Flowchart contains no nodes' });
    assert.deepStrictEqual(validateRepresentation({ nodes: [] }), { valid: false, reason: 'Flowchart contains no nodes' });

    // No start
    const noStart = {
      nodes: [{ id: 'N1', type: 'proc', text: 'Step' }, { id: 'N2', type: 'end', text: 'End' }],
      edges: [{ from: 'N1', to: 'N2' }]
    };
    assert.strictEqual(validateRepresentation(noStart).valid, false);
    assert.match(validateRepresentation(noStart).reason!, /No start node/);

    // Multiple starts
    const multiStart = {
      nodes: [{ id: 'S1', type: 'start', text: 'S1' }, { id: 'S2', type: 'start', text: 'S2' }, { id: 'E1', type: 'end', text: 'E' }],
      edges: [{ from: 'S1', to: 'E1' }]
    };
    assert.strictEqual(validateRepresentation(multiStart).valid, false);
    assert.match(validateRepresentation(multiStart).reason!, /Multiple start nodes/);

    // No end
    const noEnd = {
      nodes: [{ id: 'S1', type: 'start', text: 'Start' }, { id: 'P1', type: 'proc', text: 'Step' }],
      edges: [{ from: 'S1', to: 'P1' }]
    };
    assert.strictEqual(validateRepresentation(noEnd).valid, false);
    assert.match(validateRepresentation(noEnd).reason!, /No end node/);

    // Unknown edge node
    const badEdge = {
      nodes: [{ id: 'S1', type: 'start', text: 'Start' }, { id: 'E1', type: 'end', text: 'End' }],
      edges: [{ from: 'S1', to: 'NON_EXISTENT' }]
    };
    assert.strictEqual(validateRepresentation(badEdge).valid, false);
    assert.match(validateRepresentation(badEdge).reason!, /Edge references unknown target node/);

    // Decision with < 2 outgoing edges
    const badDec = {
      nodes: [{ id: 'S1', type: 'start', text: 'Start' }, { id: 'D1', type: 'dec', text: 'Cond?' }, { id: 'E1', type: 'end', text: 'End' }],
      edges: [{ from: 'S1', to: 'D1' }, { from: 'D1', to: 'E1', label: 'YES' }]
    };
    assert.strictEqual(validateRepresentation(badDec).valid, false);
    assert.match(validateRepresentation(badDec).reason!, /fewer than 2 outgoing edges/);

    // Orphan node unreachable from start
    const orphan = {
      nodes: [{ id: 'S1', type: 'start', text: 'Start' }, { id: 'E1', type: 'end', text: 'End' }, { id: 'P1', type: 'proc', text: 'Lost' }],
      edges: [{ from: 'S1', to: 'E1' }]
    };
    assert.strictEqual(validateRepresentation(orphan).valid, false);
    assert.match(validateRepresentation(orphan).reason!, /Orphan node unreachable/);

    // Valid diagram
    const validRep = {
      nodes: [
        { id: 'S1', type: 'start', text: 'Start' },
        { id: 'D1', type: 'dec', text: 'Cond?' },
        { id: 'P1', type: 'proc', text: 'Step' },
        { id: 'E1', type: 'end', text: 'End' }
      ],
      edges: [
        { from: 'S1', to: 'D1' },
        { from: 'D1', to: 'P1', label: 'YES' },
        { from: 'D1', to: 'E1', label: 'NO' },
        { from: 'P1', to: 'E1' }
      ]
    };
    assert.deepStrictEqual(validateRepresentation(validRep), { valid: true });
  });
});

describe('editor-core: Editor Handoff & Diagram Identity (Round 10)', () => {
  describe('decideEditorLoad rule table', () => {
    it('direct open with autosave restores autosave regardless of result', () => {
      // Without result
      const res1 = decideEditorLoad({
        arrivedFromReview: false,
        hasAutosave: true,
        hasResult: false,
      });
      assert.strictEqual(res1.action, 'restore-autosave');
      assert.strictEqual(res1.decision, 'restore-autosave');
      assert.ok(res1.reason.length > 0);

      // With result
      const res2 = decideEditorLoad({
        arrivedFromReview: false,
        hasAutosave: true,
        hasResult: true,
        resultSourceId: 'id-result',
        autosaveSourceId: 'id-autosave',
      });
      assert.strictEqual(res2.action, 'restore-autosave');
      assert.strictEqual(res2.decision, 'restore-autosave');
      assert.ok(res2.reason.length > 0);
    });

    it('direct open without autosave loads result if available', () => {
      const res = decideEditorLoad({
        arrivedFromReview: false,
        hasAutosave: false,
        hasResult: true,
        resultSourceId: 'id-result',
      });
      assert.strictEqual(res.action, 'load-result');
      assert.strictEqual(res.decision, 'load-result');
      assert.ok(res.reason.length > 0);
    });

    it('direct open without autosave and without result loads sample', () => {
      const res = decideEditorLoad({
        arrivedFromReview: false,
        hasAutosave: false,
        hasResult: false,
      });
      assert.strictEqual(res.action, 'load-sample');
      assert.strictEqual(res.decision, 'load-sample');
      assert.ok(res.reason.length > 0);
    });

    it('Review arrival with matching id restores autosave', () => {
      const res = decideEditorLoad({
        arrivedFromReview: true,
        hasAutosave: true,
        hasResult: true,
        resultSourceId: 'same-id-123',
        autosaveSourceId: 'same-id-123',
      });
      assert.strictEqual(res.action, 'restore-autosave');
      assert.strictEqual(res.decision, 'restore-autosave');
      assert.ok(res.reason.includes('matches'));
    });

    it('Review arrival with differing id loads current result', () => {
      const res = decideEditorLoad({
        arrivedFromReview: true,
        hasAutosave: true,
        hasResult: true,
        resultSourceId: 'diagram-B',
        autosaveSourceId: 'diagram-A',
      });
      assert.strictEqual(res.action, 'load-result');
      assert.strictEqual(res.decision, 'load-result');
      assert.ok(res.reason.length > 0);
    });

    it('Review arrival with missing ids counts as different and loads result', () => {
      // resultSourceId missing (null)
      const res1 = decideEditorLoad({
        arrivedFromReview: true,
        hasAutosave: true,
        hasResult: true,
        resultSourceId: null,
        autosaveSourceId: 'id-auto',
      });
      assert.strictEqual(res1.action, 'load-result');

      // autosaveSourceId missing (null)
      const res2 = decideEditorLoad({
        arrivedFromReview: true,
        hasAutosave: true,
        hasResult: true,
        resultSourceId: 'id-res',
        autosaveSourceId: null,
      });
      assert.strictEqual(res2.action, 'load-result');

      // Both missing (null)
      const res3 = decideEditorLoad({
        arrivedFromReview: true,
        hasAutosave: true,
        hasResult: true,
        resultSourceId: null,
        autosaveSourceId: null,
      });
      assert.strictEqual(res3.action, 'load-result');

      // Both missing (undefined)
      const res4 = decideEditorLoad({
        arrivedFromReview: true,
        hasAutosave: true,
        hasResult: true,
        resultSourceId: undefined,
        autosaveSourceId: undefined,
      });
      assert.strictEqual(res4.action, 'load-result');

      // Both empty strings
      const res5 = decideEditorLoad({
        arrivedFromReview: true,
        hasAutosave: true,
        hasResult: true,
        resultSourceId: '',
        autosaveSourceId: '',
      });
      assert.strictEqual(res5.action, 'load-result');
    });

    it('Review arrival with no result loads sample', () => {
      const res1 = decideEditorLoad({
        arrivedFromReview: true,
        hasAutosave: false,
        hasResult: false,
      });
      assert.strictEqual(res1.action, 'load-sample');

      const res2 = decideEditorLoad({
        arrivedFromReview: true,
        hasAutosave: true,
        hasResult: false,
        autosaveSourceId: 'some-id',
      });
      assert.strictEqual(res2.action, 'load-sample');
    });
  });

  describe('generateSourceId', () => {
    it('generates non-empty unique string IDs', () => {
      const id1 = generateSourceId();
      const id2 = generateSourceId();
      assert.strictEqual(typeof id1, 'string');
      assert.ok(id1.length > 5);
      assert.strictEqual(typeof id2, 'string');
      assert.notStrictEqual(id1, id2);
    });
  });

  describe('sourceId round trip & legacy data', () => {
    it('sourceId survives a Done round trip', () => {
      const testId = 'diagram-source-roundtrip-test';
      const editorState = {
        representation: {
          nodes: [{ id: 'N1', type: 'start', text: 'Start' }, { id: 'N2', type: 'end', text: 'End' }],
          edges: [{ from: 'N1', to: 'N2' }],
        },
        positions: {
          N1: { x: 100, y: 100 },
          N2: { x: 100, y: 200 },
        },
        edgeSides: {
          'N1->N2': { fromSide: 'bottom', toSide: 'top' },
        },
      };

      const result = applyDoneRoundTrip(editorState, testId);
      assert.strictEqual(result.sourceId, testId);
      assert.strictEqual(result.isEditor, true);
      assert.deepStrictEqual(result.representation, editorState.representation);
      assert.deepStrictEqual(result.positions, editorState.positions);
      assert.deepStrictEqual(result.edgeSides, editorState.edgeSides);
    });

    it('a legacy object without a sourceId loads', () => {
      const legacyAutosave = {
        representation: {
          nodes: [{ id: 'N1', type: 'start', text: 'Start' }],
          edges: [],
        },
        positions: {
          N1: { x: 50, y: 50 },
        },
      };

      const loaded = loadLegacyDiagram(legacyAutosave);
      assert.strictEqual(loaded.sourceId, null);
      assert.deepStrictEqual(loaded.representation, legacyAutosave.representation);
      assert.deepStrictEqual(loaded.positions, legacyAutosave.positions);

      // Direct open decision restores legacy autosave
      const decision = decideEditorLoad({
        arrivedFromReview: false,
        hasAutosave: true,
        autosaveSourceId: loaded.sourceId,
      });
      assert.strictEqual(decision.action, 'restore-autosave');

      // Review arrival counts missing legacy sourceId as different and loads result
      const reviewDecision = decideEditorLoad({
        arrivedFromReview: true,
        hasAutosave: true,
        hasResult: true,
        resultSourceId: 'new-result-id',
        autosaveSourceId: loaded.sourceId,
      });
      assert.strictEqual(reviewDecision.action, 'load-result');
    });
  });

  describe('previous slot behavior', () => {
    it('the previous slot is overwritten, never appended', () => {
      const storageMap = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => storageMap.get(k) || null,
        setItem: (k: string, v: string) => { storageMap.set(k, v); },
      };

      const stateA = { representation: { nodes: [{ id: 'A' }] }, sourceId: 'src-A' };
      const stateB = { representation: { nodes: [{ id: 'B' }] }, sourceId: 'src-B' };
      const stateC = { representation: { nodes: [{ id: 'C' }] }, sourceId: 'src-C' };

      // Save first state
      savePreviousSlot(mockStorage, stateA);
      assert.strictEqual(storageMap.size, 1);
      assert.deepStrictEqual(getPreviousSlot(mockStorage), stateA);

      // Overwrite with second state
      savePreviousSlot(mockStorage, stateB);
      assert.strictEqual(storageMap.size, 1, 'Previous slot should remain a single entry, not append');
      assert.deepStrictEqual(getPreviousSlot(mockStorage), stateB);

      // Overwrite with third state
      savePreviousSlot(mockStorage, stateC);
      assert.strictEqual(storageMap.size, 1, 'Previous slot should not grow on multiple saves');
      assert.deepStrictEqual(getPreviousSlot(mockStorage), stateC);

      // Verify slot key constant
      assert.strictEqual(PREVIOUS_AUTOSAVE_KEY, 'flowchart_editor_previous_state');
    });

    it('swapAutosaveWithPrevious swaps active and previous states', () => {
      const currentActive = { representation: { nodes: [{ id: 'Current' }] }, sourceId: 'src-current' };
      const previousState = { representation: { nodes: [{ id: 'Prev' }] }, sourceId: 'src-prev' };

      const { newActive, newPrevious } = swapAutosaveWithPrevious(currentActive, previousState);
      assert.deepStrictEqual(newActive, previousState);
      assert.deepStrictEqual(newPrevious, currentActive);
    });
  });

  describe('getSourceChipLabel wording', () => {
    it('returns exact wording per Step 4 rules', () => {
      // Autosave restore
      assert.strictEqual(getSourceChipLabel({ decision: 'restore-autosave' }), 'Restored your edits');
      assert.strictEqual(getSourceChipLabel({ decision: 'restore-autosave', sourceFlag: 'upload' }), 'Restored your edits');

      // Fresh load from review
      assert.strictEqual(getSourceChipLabel({ decision: 'load-result', sourceFlag: 'upload' }), 'Loaded from Review');
      assert.strictEqual(getSourceChipLabel({ decision: 'load-result', sourceFlag: 'editor' }), 'Loaded from Review');

      // Sample load
      assert.strictEqual(getSourceChipLabel({ decision: 'load-result', sourceFlag: 'recorded' }), 'Recorded example');
      assert.strictEqual(getSourceChipLabel({ decision: 'load-sample' }), 'Recorded example');
    });
  });
});




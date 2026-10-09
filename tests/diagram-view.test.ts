// Unit tests for read-only SVG diagram layout computation and rendering.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeXml,
  wrapText,
  computeBoxDims,
  resolveDiagramLayout,
  computeDiagramViewBox,
  renderDiagramSvg
} from '../public/js/diagram-view.js';

describe('diagram-view: XML Escaping and Text Wrapping', () => {
  it('escapeXml escapes dangerous XML characters', () => {
    assert.strictEqual(escapeXml('foo & bar < baz > "qux" \'quux\''), 'foo &amp; bar &lt; baz &gt; &quot;qux&quot; &apos;quux&apos;');
    assert.strictEqual(escapeXml(null), '');
    assert.strictEqual(escapeXml(undefined), '');
  });

  it('wrapText splits strings within maxChars', () => {
    assert.deepStrictEqual(wrapText(''), ['']);
    assert.deepStrictEqual(wrapText('Short text'), ['Short text']);
    const longText = 'This is a long sentence that should be wrapped across multiple lines';
    const lines = wrapText(longText, 22);
    assert.ok(lines.length > 1);
    for (const line of lines) {
      assert.ok(line.length <= 25, `Line exceeded expected max length: "${line}"`);
    }
  });

  it('computeBoxDims returns appropriate dimensions per shape kind', () => {
    const procNode = { id: 'N1', type: 'proc', text: 'sum = 0' };
    const procDims = computeBoxDims(procNode);
    assert.ok(procDims.width >= 140 && procDims.width <= 240);
    assert.ok(procDims.height >= 56);

    const decNode = { id: 'N2', type: 'dec', text: 'is i <= n ?' };
    const decDims = computeBoxDims(decNode);
    assert.ok(decDims.width >= 150);
    assert.ok(decDims.height >= 68);
  });
});

describe('diagram-view: Layout Resolution', () => {
  const sampleRep = {
    nodes: [
      { id: 'N1', type: 'start', text: 'Start' },
      { id: 'N2', type: 'proc', text: 'Step 1' },
      { id: 'N3', type: 'end', text: 'End' }
    ],
    edges: [
      { from: 'N1', to: 'N2', label: null },
      { from: 'N2', to: 'N3', label: null }
    ]
  };

  it('uses pure autoLayout when no saved positions exist (fresh upload or sample)', () => {
    const layout = resolveDiagramLayout(sampleRep, null, null);
    assert.ok(layout.positions['N1']);
    assert.ok(layout.positions['N2']);
    assert.ok(layout.positions['N3']);
    assert.strictEqual(typeof layout.positions['N1'].x, 'number');
    assert.strictEqual(typeof layout.positions['N1'].y, 'number');
    assert.ok(layout.edgeSides['N1->N2']);
  });

  it('preserves saved positions matching current IR and ignores deleted boxes', () => {
    const savedPos = {
      N1: { x: 120, y: 150 },
      N2: { x: 300, y: 400 },
      N3: { x: 500, y: 600 },
      DELETED_NODE: { x: 999, y: 999 } // should be ignored
    };
    const savedSides = {
      'N1->N2': { fromSide: 'right', toSide: 'left' }
    };

    const layout = resolveDiagramLayout(sampleRep, savedPos, savedSides);
    assert.deepStrictEqual(layout.positions['N1'], { x: 120, y: 150 });
    assert.deepStrictEqual(layout.positions['N2'], { x: 300, y: 400 });
    assert.deepStrictEqual(layout.positions['N3'], { x: 500, y: 600 });
    assert.strictEqual(layout.positions['DELETED_NODE'], undefined);
    assert.strictEqual(layout.edgeSides['N1->N2'].fromSide, 'right');
    assert.strictEqual(layout.edgeSides['N1->N2'].toSide, 'left');
  });

  it('fills in missing box positions using autoLayout', () => {
    const partialSaved = {
      N1: { x: 100, y: 100 }
      // N2 and N3 missing
    };
    const layout = resolveDiagramLayout(sampleRep, partialSaved, null);
    assert.deepStrictEqual(layout.positions['N1'], { x: 100, y: 100 });
    assert.ok(layout.positions['N2'], 'N2 should be filled by autoLayout');
    assert.ok(layout.positions['N3'], 'N3 should be filled by autoLayout');
  });
});

describe('diagram-view: SVG Renderer and ViewBox', () => {
  const fixtureRep = {
    nodes: [
      { id: 'S1', type: 'start', text: 'Start' },
      { id: 'IO1', type: 'io', text: 'Input n' },
      { id: 'D1', type: 'dec', text: 'n > 0 ?' },
      { id: 'P1', type: 'proc', text: 'Do work' },
      { id: 'E1', type: 'end', text: 'End' }
    ],
    edges: [
      { from: 'S1', to: 'IO1', label: null },
      { from: 'IO1', to: 'D1', label: null },
      { from: 'D1', to: 'P1', label: 'YES' },
      { from: 'D1', to: 'E1', label: 'NO' },
      { from: 'P1', to: 'E1', label: null }
    ]
  };

  it('computeDiagramViewBox computes valid non-zero bounds', () => {
    const layout = resolveDiagramLayout(fixtureRep, null, null);
    const dimsMap = new Map();
    fixtureRep.nodes.forEach(n => dimsMap.set(n.id, computeBoxDims(n)));

    const vb = computeDiagramViewBox(fixtureRep, layout.positions, dimsMap, 40);
    assert.ok(vb.width > 200, `Expected width > 200, got ${vb.width}`);
    assert.ok(vb.height > 200, `Expected height > 200, got ${vb.height}`);
  });

  it('renderDiagramSvg outputs accessible SVG with semantic shapes and no edit handles', () => {
    const layout = resolveDiagramLayout(fixtureRep, null, null);
    const svg = renderDiagramSvg(fixtureRep, layout.positions, layout.edgeSides);

    // Root SVG attributes
    assert.ok(svg.startsWith('<svg'), 'Should start with <svg');
    assert.ok(svg.includes('role="img"'), 'Must have role="img"');
    assert.ok(svg.includes('aria-label="Flowchart with 5 boxes and 5 arrows"'), 'Must have accurate aria-label');
    assert.ok(svg.includes('class="review-diagram-svg"'));
    assert.ok(svg.includes('viewBox='));

    // Defs & Marker
    assert.ok(svg.includes('<marker id="review-arrowhead"'));
    assert.ok(svg.includes('marker-end="url(#review-arrowhead)"'));

    // Shape elements
    // start / end pill
    assert.ok(svg.includes('data-kind="start"'));
    assert.ok(svg.includes('data-kind="end"'));
    // io parallelogram
    assert.ok(svg.includes('data-kind="io"'));
    assert.ok(svg.includes('<polygon points='));
    // dec diamond
    assert.ok(svg.includes('data-kind="dec"'));
    // proc rounded rect
    assert.ok(svg.includes('data-kind="proc"'));

    // Badges & Labels
    assert.ok(svg.includes('class="box-id-badge"'));
    assert.ok(svg.includes('class="box-text"'));
    assert.ok(svg.includes('class="edge-label-bg"'));
    assert.ok(svg.includes('class="edge-label-text"'));
    assert.ok(svg.includes('YES'));
    assert.ok(svg.includes('NO'));

    // Read-only constraint: NO interactive editing handles or selection
    assert.ok(!svg.includes('arrow-handle'), 'Read-only review diagram must not include arrow handles');
    assert.ok(!svg.includes('selected'), 'Read-only review diagram must not include selected classes');
  });

  it('handles empty representation gracefully without throwing', () => {
    const svg = renderDiagramSvg({ nodes: [], edges: [] });
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('role="img"'));
  });
});

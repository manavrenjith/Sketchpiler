// Tests for condition text cleanup and extra-exit advisory warning.
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeCondition as normalizeGenerator, generatePseudocode } from '../src/generator.js';
import { normalizeCondition as normalizeComplexity, analyzeComplexity } from '../public/js/complexity-core.js';
import { validateRepresentation } from '../src/validator.js';
import { parseDsl } from '../src/parser.js';
import { FlowchartRepresentation } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

describe('Step 1 & Step 3: normalizeCondition parity and test cases', () => {
  const cases: Array<{ input: string; expected: string; desc: string }> = [
    { input: 'if i <= 5', expected: 'i <= 5', desc: '"if i <= 5" strips leading if' },
    { input: 'If i<5?', expected: 'i<5', desc: '"If i<5?" strips leading If and trailing ?' },
    { input: 'while (i <= n)', expected: 'i <= n', desc: '"while (i <= n)" strips while and outer parens' },
    { input: 'i ≤ n', expected: 'i <= n', desc: '"i ≤ n" maps unicode ≤ to <=' },
    { input: 'iffy > 3', expected: 'iffy > 3', desc: '"iffy > 3" unchanged' },
    { input: 'if', expected: 'if', desc: '"if" alone unchanged' },
    { input: '(a > b) and (c < d)', expected: '(a > b) and (c < d)', desc: '"(a > b) and (c < d)" unchanged, parens do not wrap whole text' },
    { input: 'while', expected: 'while', desc: '"while" alone unchanged' },
    { input: 'while_count > 0', expected: 'while_count > 0', desc: '"while_count > 0" unchanged' },
    { input: 'i ≥ n', expected: 'i >= n', desc: '"i ≥ n" maps unicode ≥ to >=' },
    { input: 'i ≠ n', expected: 'i != n', desc: '"i ≠ n" maps unicode ≠ to !=' },
    { input: 'if (i <= 5)', expected: 'i <= 5', desc: '"if (i <= 5)" strips if and outer parens' },
    { input: 'until i > 5', expected: 'until i > 5', desc: '"until" preserved' },
    { input: 'not (i > 5)', expected: 'not (i > 5)', desc: '"not" preserved' },
    { input: 'x is null', expected: 'x is null', desc: '"is" preserved' },
    { input: '((i <= 5))', expected: '(i <= 5)', desc: 'removes only ONE pair of outer parens' },
    { input: '   if   i   <=   5   ?  ', expected: 'i <= 5', desc: 'collapses spaces, removes leading if and trailing ?' },
    { input: '?', expected: '?', desc: 'empty result returns trimmed original' },
    { input: '', expected: '', desc: 'empty string returns empty string' }
  ];

  for (const c of cases) {
    it(`normalizes: ${c.desc}`, () => {
      const outGen = normalizeGenerator(c.input);
      const outComp = normalizeComplexity(c.input);
      assert.strictEqual(outGen, c.expected, `generator copy failed for: ${c.input}`);
      assert.strictEqual(outComp, c.expected, `complexity copy failed for: ${c.input}`);
      assert.strictEqual(outGen, outComp, `copies disagree for: ${c.input}`);
    });
  }
});

describe('Step 2 & Step 3: Diagram with loop, decision "if i <= 5", extra arrow, and advisory', () => {
  // Nodes: Start, "i = 1", decision "if i <= 5", step "i = i + 1", io "Print i" (inside loop, with second arrow to End), io "Print i" (on No branch), End
  const diagramRep: FlowchartRepresentation = {
    schemaVersion: 1,
    type: 'flowchart',
    nodes: [
      { id: 'N1', type: 'start', text: 'Start', uncertain: false },
      { id: 'N2', type: 'proc', text: 'i = 1', uncertain: false },
      { id: 'N3', type: 'dec', text: 'if i <= 5', uncertain: false },
      { id: 'N4', type: 'proc', text: 'i = i + 1', uncertain: false },
      { id: 'N5', type: 'io', text: 'Print i', uncertain: false },
      { id: 'N6', type: 'io', text: 'Print i', uncertain: false },
      { id: 'N7', type: 'end', text: 'End', uncertain: false }
    ],
    edges: [
      { from: 'N1', to: 'N2', label: null, uncertain: false },
      { from: 'N2', to: 'N3', label: null, uncertain: false },
      { from: 'N3', to: 'N4', label: 'Yes', uncertain: false },
      { from: 'N4', to: 'N5', label: null, uncertain: false },
      { from: 'N5', to: 'N3', label: null, uncertain: false }, // loop-back arrow
      { from: 'N5', to: 'N7', label: null, uncertain: false }, // second arrow to End (extra exit)
      { from: 'N3', to: 'N6', label: 'No', uncertain: false },
      { from: 'N6', to: 'N7', label: null, uncertain: false }
    ]
  };

  it('generator prints WHILE i <= 5 DO', () => {
    const gen = generatePseudocode(diagramRep);
    assert.match(gen.pseudocode, /WHILE i <= 5 DO/);
  });

  it('complexity returns constant time for the literal bound 5 with a reason that names the decision box and the literal', () => {
    const comp = analyzeComplexity(diagramRep);
    assert.strictEqual(comp.time.label, 'O(1)');
    assert.strictEqual(comp.time.status, 'estimated');
    const hasReasonNamingBoxAndLiteral = comp.time.reasons.some(
      r => r.includes('N3') && r.includes('5')
    );
    assert.ok(
      hasReasonNamingBoxAndLiteral,
      `Expected a reason naming decision box N3 and literal 5, got: ${JSON.stringify(comp.time.reasons)}`
    );
  });

  it('extra-exit advisory appears for the extra arrow on N5 and diagram remains valid', () => {
    const val = validateRepresentation(diagramRep);
    // Per Step 0c and Step 2: must NOT make diagram invalid
    assert.strictEqual(val.valid, true);

    const advisory = 'N5 (Print i) has 2 outgoing arrows; only decisions branch.';
    assert.ok(
      val.warnings.includes(advisory),
      `Expected warning "${advisory}", got: ${JSON.stringify(val.warnings)}`
    );
  });

  it('advisory does not appear in sum-of-n or any existing fixture', () => {
    const fixtureFiles = ['01_sum_of_n.txt', '02_odd_or_even.txt', '03_largest.txt', '04_rev.txt'];

    for (const f of fixtureFiles) {
      const dsl = fs.readFileSync(path.join(fixturesDir, f), 'utf-8');
      const parsed = parseDsl(dsl);
      const val = validateRepresentation(parsed.representation, parsed.warnings);
      const hasAdvisory = val.warnings.some(w => w.includes('only decisions branch'));
      assert.strictEqual(hasAdvisory, false, `Advisory should not appear in fixture ${f}`);
    }
  });

  it('all existing golden fixtures and their expected outputs are unchanged', () => {
    const fixtures = [
      { dsl: '01_sum_of_n.txt', exp: '01_sum_of_n.expected.txt' },
      { dsl: '02_odd_or_even.txt', exp: '02_odd_or_even.expected.txt' },
      { dsl: '03_largest.txt', exp: '03_largest.expected.txt' },
      { dsl: '04_rev.txt', exp: '04_rev.expected.txt' }
    ];

    for (const { dsl, exp } of fixtures) {
      const dslContent = fs.readFileSync(path.join(fixturesDir, dsl), 'utf-8');
      const expectedContent = fs.readFileSync(path.join(fixturesDir, exp), 'utf-8').trim();
      const parsed = parseDsl(dslContent);
      const gen = generatePseudocode(parsed.representation);
      assert.strictEqual(gen.pseudocode.trim(), expectedContent, `Pseudocode mismatch for ${dsl}`);
    }
  });
});

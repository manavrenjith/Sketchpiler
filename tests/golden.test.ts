// Golden fixture regression tests comparing parser output against expected texts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDsl } from '../src/parser.js';
import { validateRepresentation } from '../src/validator.js';
import { buildMermaid } from '../src/mermaid.js';
import { generatePseudocode } from '../src/generator.js';
import { AppError } from '../src/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

describe('Golden Tests (SPEC.md Section 11)', () => {
  it('Case 1: straight sequence', () => {
    const dsl = `flowchart
N1 start "Start"
N2 io "Input x"
N3 proc "y = x * 2"
N4 io "Display y"
N5 end "End"
E N1 N2
E N2 N3
E N3 N4
E N4 N5`;

    const parsed = parseDsl(dsl);
    assert.strictEqual(parsed.truncated, false);
    assert.strictEqual(parsed.representation.nodes.length, 5);
    assert.strictEqual(parsed.representation.edges.length, 4);

    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true);
    assert.strictEqual(validated.warnings.length, 0);
    assert.strictEqual(validated.confidence, 1.0);

    const mermaid = buildMermaid(parsed.representation);
    assert.ok(mermaid.includes('flowchart TD'));
    assert.ok(mermaid.includes('N1(["Start"])'));
    assert.ok(mermaid.includes('N2[/"Input x"/]'));

    const gen = generatePseudocode(parsed.representation);
    assert.strictEqual(gen.warnings.length, 0);
    const expected = `INPUT x\ny = x * 2\nOUTPUT y`;
    assert.strictEqual(gen.pseudocode, expected);
  });

  it('Case 2: if/else with a shared end (converging join)', () => {
    const dsl = `flowchart
N1 start "Start"
N2 io "Input x"
N3 dec "x > 0?"
N4 proc "sign = 1"
N5 proc "sign = -1"
N6 io "Display sign"
N7 end "End"
E N1 N2
E N2 N3
E N3 N4 "Yes"
E N3 N5 "No"
E N4 N6
E N5 N6
E N6 N7`;

    const parsed = parseDsl(dsl);
    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true);

    const gen = generatePseudocode(parsed.representation);
    const expected = `INPUT x
IF x > 0 THEN
  sign = 1
ELSE
  sign = -1
END IF
OUTPUT sign`;
    assert.strictEqual(gen.pseudocode, expected);
  });

  it('Case 3: if/else with separate ends', () => {
    const dsl = `flowchart
N1 start "Start"
N2 io "Input x"
N3 dec "x > 0?"
N4 io "Display \\"Positive\\""
N5 io "Display \\"Non-positive\\""
N6 end "End"
N7 end "End"
E N1 N2
E N2 N3
E N3 N4 "Yes"
E N3 N5 "No"
E N4 N6
E N5 N7`;

    const parsed = parseDsl(dsl);
    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true);

    const gen = generatePseudocode(parsed.representation);
    const expected = `INPUT x
IF x > 0 THEN
  OUTPUT "Positive"
ELSE
  OUTPUT "Non-positive"
END IF`;
    assert.strictEqual(gen.pseudocode, expected);
  });

  it('Case 4: while loop with a loop-back edge (Section 8 worked example)', () => {
    const dsl = `flowchart
N1 start "Start"
N2 io "Input n"
N3 proc "sum = 0, i = 1"
N4 dec "i <= n?"
N5 proc "sum = sum + i; i = i + 1"
N6 io "Display sum"
N7 end "End"
E N1 N2
E N2 N3
E N3 N4
E N4 N5 "Yes"
E N5 N4
E N4 N6 "No"
E N6 N7`;

    const parsed = parseDsl(dsl);
    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true);

    const gen = generatePseudocode(parsed.representation);
    const expected = `INPUT n
sum = 0
i = 1
WHILE i <= n DO
  sum = sum + i
  i = i + 1
END WHILE
OUTPUT sum`;
    assert.strictEqual(gen.pseudocode, expected);
  });

  it('Case 5: duplicate End nodes', () => {
    const dsl = `flowchart
N1 start "Start"
N2 dec "a == 0?"
N3 end "End"
N4 end "End"
E N1 N2
E N2 N3 "Yes"
E N2 N4 "No"`;

    const parsed = parseDsl(dsl);
    assert.strictEqual(parsed.representation.nodes.filter(n => n.type === 'end').length, 2);
    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true);
  });

  it('Case 6: unescaped inner quotes', () => {
    const dsl = `flowchart
N1 start "Start"
N2 io "Display "Hello World""
N3 end "End"
E N1 N2
E N2 N3`;

    const parsed = parseDsl(dsl);
    assert.strictEqual(parsed.representation.nodes[1].text, 'Display "Hello World"');
    const gen = generatePseudocode(parsed.representation);
    assert.strictEqual(gen.pseudocode, 'OUTPUT "Hello World"');
  });

  it('Case 7: code-fenced output', () => {
    const dsl = `\`\`\`flowchart
flowchart
N1 start "Start"
N2 end "End"
E N1 N2
\`\`\``;

    const parsed = parseDsl(dsl);
    assert.strictEqual(parsed.representation.nodes.length, 2);
    assert.strictEqual(parsed.representation.edges.length, 1);
  });

  it('Case 8: truncated final line', () => {
    const dsl = `flowchart
N1 start "Start"
N2 io "Input x"
N3 proc "y = x + `;

    const parsed = parseDsl(dsl);
    assert.strictEqual(parsed.truncated, true);
    assert.strictEqual(parsed.representation.nodes.length, 2);
    assert.strictEqual(parsed.representation.nodes[0].id, 'N1');
    assert.strictEqual(parsed.representation.nodes[1].id, 'N2');
  });

  it('Case 9: unknown node in an edge', () => {
    const dsl = `flowchart
N1 start "Start"
N2 end "End"
E N1 N99`;

    const parsed = parseDsl(dsl);
    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, false);
    assert.ok(validated.warnings.some(w => w.includes('unknown target node: "N99"')));
    assert.ok(validated.confidence < 1.0);
  });

  it('Case 10: unknown or reserved header', () => {
    assert.throws(() => parseDsl('er\nN1 start "Start"'), (err: any) => {
      return err instanceof AppError && err.code === 'unparseable_output';
    });

    assert.throws(() => parseDsl('uml\nN1 start "Start"'), (err: any) => {
      return err instanceof AppError && err.code === 'unparseable_output';
    });

    assert.throws(() => parseDsl('unknown_header\nN1 start "Start"'), (err: any) => {
      return err instanceof AppError && err.code === 'unparseable_output';
    });
  });

  it('Case 11: empty output', () => {
    assert.throws(() => parseDsl('   \n\n  '), (err: any) => {
      return err instanceof AppError && err.code === 'empty_diagram';
    });
  });
});

describe('Review Follow-up 1: Structural Loop Selection & Swapped Edges', () => {
  it('04_rev with decision edges swapped produces identical WHILE pseudocode', () => {
    // In original 04_rev: E N4 N5 appears before E N4 N8.
    // In this swapped test: E N4 N8 appears before E N4 N5.
    const swappedDsl = `flowchart
N1 start "Start"
N2 io "Input n"
N3 proc "rev = 0"
N4 dec "n > 0?"
N5 proc "digit = n % 10"
N6 proc "rev = rev * 10 + digit"
N7 proc "n = n / 10 (integer division)"
N8 io "Display rev"
N9 end "End"
E N1 N2
E N2 N3
E N3 N4
E N4 N8
E N4 N5
E N5 N6
E N6 N7
E N7 N4
E N8 N9`;

    const parsed = parseDsl(swappedDsl);
    const gen = generatePseudocode(parsed.representation);
    const expected = fs.readFileSync(path.join(fixturesDir, '04_rev.expected.txt'), 'utf8').trim();

    assert.strictEqual(gen.pseudocode, expected);
    assert.ok(gen.warnings.some(w => w.includes('defaulting loop branch to N5')));
  });
});

describe('Review Follow-up 2: ~ Marker and Confidence Calculation', () => {
  it('flags uncertain node with trailing ~', () => {
    const dsl = `flowchart
N1 start "Start"
N2 io "Input x" ~
N3 end "End"
E N1 N2
E N2 N3`;

    const parsed = parseDsl(dsl);
    assert.strictEqual(parsed.representation.nodes[1].uncertain, true);
    assert.strictEqual(parsed.representation.nodes[0].uncertain, false);

    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true);
    // Base 1.0 - 0.05 for uncertain node = 0.95
    assert.strictEqual(validated.confidence, 0.95);
  });

  it('flags uncertain labelled edge with trailing ~', () => {
    const dsl = `flowchart
N1 start "Start"
N2 dec "x > 0?"
N3 end "End"
N4 end "End"
E N1 N2
E N2 N3 "Yes" ~
E N2 N4 "No"`;

    const parsed = parseDsl(dsl);
    const yesEdge = parsed.representation.edges.find(e => e.label === 'Yes')!;
    assert.strictEqual(yesEdge.uncertain, true);
    assert.strictEqual(yesEdge.label, 'Yes');

    const noEdge = parsed.representation.edges.find(e => e.label === 'No')!;
    assert.strictEqual(noEdge.uncertain, false);

    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true);
    assert.strictEqual(validated.confidence, 0.95);
  });

  it('flags uncertain unlabelled edge with trailing ~', () => {
    const dsl = `flowchart
N1 start "Start"
N2 end "End"
E N1 N2 ~`;

    const parsed = parseDsl(dsl);
    assert.strictEqual(parsed.representation.edges[0].uncertain, true);
    assert.strictEqual(parsed.representation.edges[0].label, null);

    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true);
    assert.strictEqual(validated.confidence, 0.95);
  });

  it('handles node text ending in ? inside quotes (not confused with ~)', () => {
    const dslWithoutTilde = `flowchart
N1 start "Start"
N2 dec "is valid?"
N3 end "End"
N4 end "End"
E N1 N2
E N2 N3 "Yes"
E N2 N4 "No"`;

    const parsed1 = parseDsl(dslWithoutTilde);
    assert.strictEqual(parsed1.representation.nodes[1].text, 'is valid?');
    assert.strictEqual(parsed1.representation.nodes[1].uncertain, false);
    const val1 = validateRepresentation(parsed1.representation, parsed1.warnings);
    assert.strictEqual(val1.confidence, 1.0);

    const dslWithTilde = `flowchart
N1 start "Start"
N2 dec "is valid?" ~
N3 end "End"
N4 end "End"
E N1 N2
E N2 N3 "Yes"
E N2 N4 "No"`;

    const parsed2 = parseDsl(dslWithTilde);
    assert.strictEqual(parsed2.representation.nodes[1].text, 'is valid?');
    assert.strictEqual(parsed2.representation.nodes[1].uncertain, true);
    const val2 = validateRepresentation(parsed2.representation, parsed2.warnings);
    assert.strictEqual(val2.confidence, 0.95);
  });

  it('combines warnings and multiple uncertain markers in confidence calculation', () => {
    // 1 warning (-0.10), 1 uncertain node (-0.05), 1 uncertain edge (-0.05) -> 1.0 - 0.20 = 0.80
    const dsl = `flowchart
N1 start "Start"
N2 dec "x > 0?" ~
N3 end "End"
E N1 N2
E N2 N3 "Yes" ~`; // dec has only 1 edge -> warning!

    const parsed = parseDsl(dsl);
    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, false); // dec has < 2 edges
    assert.strictEqual(validated.warnings.length, 1);
    assert.strictEqual(validated.confidence, 0.8);
  });
});

describe('Review Follow-up 4: Missing Flowchart Header Warning', () => {
  it('warns when flowchart header is missing but still parses diagram', () => {
    const dsl = `N1 start "Start"
N2 end "End"
E N1 N2`;

    const parsed = parseDsl(dsl);
    assert.strictEqual(parsed.representation.nodes.length, 2);
    assert.strictEqual(parsed.representation.edges.length, 1);
    assert.ok(parsed.warnings.some(w => w.includes('Missing required "flowchart" header')));

    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true); // graph is structurally valid
    assert.ok(validated.warnings.some(w => w.includes('Missing required "flowchart" header')));
    // Base 1.0 - 0.10 for the missing header warning = 0.90
    assert.strictEqual(validated.confidence, 0.9);
  });
});

describe('Golden Input Fixtures (tests/fixtures/*.txt vs *.expected.txt)', () => {
  it('Fixture 01: 01_sum_of_n.txt matches 01_sum_of_n.expected.txt', () => {
    const raw = fs.readFileSync(path.join(fixturesDir, '01_sum_of_n.txt'), 'utf8');
    const expected = fs.readFileSync(path.join(fixturesDir, '01_sum_of_n.expected.txt'), 'utf8').trim();

    const parsed = parseDsl(raw);
    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true);
    assert.strictEqual(validated.warnings.length, 0);
    assert.strictEqual(validated.confidence, 1.0);

    const gen = generatePseudocode(parsed.representation);
    assert.strictEqual(gen.pseudocode, expected);
  });

  it('Fixture 02: 02_odd_or_even.txt matches 02_odd_or_even.expected.txt', () => {
    const raw = fs.readFileSync(path.join(fixturesDir, '02_odd_or_even.txt'), 'utf8');
    const expected = fs.readFileSync(path.join(fixturesDir, '02_odd_or_even.expected.txt'), 'utf8').trim();

    const parsed = parseDsl(raw);
    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true);
    assert.strictEqual(validated.warnings.length, 0);
    assert.strictEqual(validated.confidence, 1.0);

    const gen = generatePseudocode(parsed.representation);
    assert.strictEqual(gen.pseudocode, expected);
  });

  it('Fixture 03: 03_largest.txt matches 03_largest.expected.txt', () => {
    const raw = fs.readFileSync(path.join(fixturesDir, '03_largest.txt'), 'utf8');
    const expected = fs.readFileSync(path.join(fixturesDir, '03_largest.expected.txt'), 'utf8').trim();

    const parsed = parseDsl(raw);
    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true);
    assert.strictEqual(validated.warnings.length, 0);
    assert.strictEqual(validated.confidence, 1.0);

    const gen = generatePseudocode(parsed.representation);
    assert.strictEqual(gen.pseudocode, expected);
  });

  it('Fixture 04: 04_rev.txt matches 04_rev.expected.txt', () => {
    const raw = fs.readFileSync(path.join(fixturesDir, '04_rev.txt'), 'utf8');
    const expected = fs.readFileSync(path.join(fixturesDir, '04_rev.expected.txt'), 'utf8').trim();

    const parsed = parseDsl(raw);
    const validated = validateRepresentation(parsed.representation, parsed.warnings);
    assert.strictEqual(validated.valid, true);

    const gen = generatePseudocode(parsed.representation);
    assert.ok(gen.warnings.length > 0, 'Should warn about unlabelled decision edges');
    assert.strictEqual(gen.pseudocode, expected);
  });
});

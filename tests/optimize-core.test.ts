// Unit tests for static loop optimization rules (pure logic, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findOptimizations } from '../public/js/optimize-core.js';
import { analyzeComplexity } from '../public/js/complexity-core.js';
import { parseDsl } from '../src/parser.js';
import { generatePseudocode } from '../src/generator.js';

test('optimize-core: Pattern 1 - Arithmetic Series (positive)', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'io', text: 'Input n' },
            { id: 'N3', type: 'proc', text: 'sum = 0, i = 1' },
            { id: 'N4', type: 'dec', text: 'i <= n?' },
            { id: 'N5', type: 'proc', text: 'sum = sum + i; i = i + 1' },
            { id: 'N6', type: 'io', text: 'Display sum' },
            { id: 'N7', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: null },
            { from: 'N4', to: 'N5', label: 'Yes' },
            { from: 'N5', to: 'N4', label: null },
            { from: 'N4', to: 'N6', label: 'No' },
            { from: 'N6', to: 'N7', label: null }
        ]
    };

    const opt = findOptimizations(rep);
    assert.equal(opt.found, true);
    assert.equal(opt.suggestions.length, 1);
    const s = opt.suggestions[0];
    assert.equal(s.title, 'Arithmetic Series Closed Form');
    assert.equal(s.before.time.label, 'O(n)');
    assert.equal(s.after.time.label, 'O(1)');
    assert.ok(s.reason.includes('N4'));
    assert.ok(s.assumptions.length >= 1);
});

test('optimize-core: Pattern 1 - Negative cases (step +2, bound modified, extra stmts, non-literal start, ambiguous exit)', () => {
    // 1. Step +2
    const repStep2 = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'sum = 0; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'sum = sum + i; i = i + 2' },
            { id: 'N5', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N3', label: null },
            { from: 'N3', to: 'N5', label: 'No' }
        ]
    };
    assert.equal(findOptimizations(repStep2).found, false);

    // 2. Bound modified in loop
    const repBoundMod = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'sum = 0; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'sum = sum + i; n = n - 1; i = i + 1' },
            { id: 'N5', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N3', label: null },
            { from: 'N3', to: 'N5', label: 'No' }
        ]
    };
    assert.equal(findOptimizations(repBoundMod).found, false);

    // 3. Extra statements in body
    const repExtraStmts = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'sum = 0; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'sum = sum + i; print(i); i = i + 1' },
            { id: 'N5', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N3', label: null },
            { from: 'N3', to: 'N5', label: 'No' }
        ]
    };
    assert.equal(findOptimizations(repExtraStmts).found, false);

    // 4. Non-literal start (i = k where k is not literal)
    const repNonLitStart = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'sum = 0; i = k' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'sum = sum + i; i = i + 1' },
            { id: 'N5', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N3', label: null },
            { from: 'N3', to: 'N5', label: 'No' }
        ]
    };
    assert.equal(findOptimizations(repNonLitStart).found, false);

    // 5. Ambiguous two-exit body
    const repTwoExits = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'sum = 0; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'dec', text: 'sum > 100' },
            { id: 'N5', type: 'proc', text: 'sum = sum + i; i = i + 1' },
            { id: 'N6', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N6', label: 'Yes' }, // Early exit!
            { from: 'N4', to: 'N5', label: 'No' },
            { from: 'N5', to: 'N3', label: null },
            { from: 'N3', to: 'N6', label: 'No' }
        ]
    };
    assert.equal(findOptimizations(repTwoExits).found, false);
});

test('optimize-core: Pattern 2 - Constant Addition (positive and negative cases)', () => {
    // Positive
    const repPos = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'acc = 0; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'acc = acc + 5; i = i + 1' },
            { id: 'N5', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N3', label: null },
            { from: 'N3', to: 'N5', label: 'No' }
        ]
    };
    const opt = findOptimizations(repPos);
    assert.equal(opt.found, true);
    assert.equal(opt.suggestions[0].title, 'Constant Addition Closed Form');
    assert.equal(opt.suggestions[0].before.time.label, 'O(n)');
    assert.equal(opt.suggestions[0].after.time.label, 'O(1)');

    // Negative: step is +2
    const repNegStep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'acc = 0; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'acc = acc + 5; i = i + 2' },
            { id: 'N5', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N3', label: null },
            { from: 'N3', to: 'N5', label: 'No' }
        ]
    };
    assert.equal(findOptimizations(repNegStep).found, false);

    // Negative: constant modified in loop
    const repNegMod = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'acc = 0; c = 5; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'acc = acc + c; c = c + 1; i = i + 1' },
            { id: 'N5', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N3', label: null },
            { from: 'N3', to: 'N5', label: 'No' }
        ]
    };
    assert.equal(findOptimizations(repNegMod).found, false);
});

test('optimize-core: Pattern 3 - Pure Counting (positive and negative cases)', () => {
    // Positive
    const repPos = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'count = 0; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'count = count + 1; i = i + 1' },
            { id: 'N5', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N3', label: null },
            { from: 'N3', to: 'N5', label: 'No' }
        ]
    };
    const opt = findOptimizations(repPos);
    assert.equal(opt.found, true);
    assert.equal(opt.suggestions[0].title, 'Pure Counting Closed Form');
    assert.equal(opt.suggestions[0].before.time.label, 'O(n)');
    assert.equal(opt.suggestions[0].after.time.label, 'O(1)');

    // Negative: extra non-step statement
    const repNegExtra = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'count = 0; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'count = count + 1; z = z + 1; i = i + 1' },
            { id: 'N5', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N3', label: null },
            { from: 'N3', to: 'N5', label: 'No' }
        ]
    };
    assert.equal(findOptimizations(repNegExtra).found, false);
});

test('optimize-core: Pattern 4 - Nested Loops (j-loop 1..i inside i-loop 1..n: O(n^2) -> O(n))', () => {
    const repNested = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'total = 0; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'j = 1' },
            { id: 'N5', type: 'dec', text: 'j <= i' },
            { id: 'N6', type: 'proc', text: 'total = total + j; j = j + 1' },
            { id: 'N7', type: 'proc', text: 'i = i + 1' },
            { id: 'N8', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N5', label: null },
            { from: 'N5', to: 'N6', label: 'Yes' },
            { from: 'N6', to: 'N5', label: null },
            { from: 'N5', to: 'N7', label: 'No' },
            { from: 'N7', to: 'N3', label: null },
            { from: 'N3', to: 'N8', label: 'No' }
        ]
    };

    const opt = findOptimizations(repNested);
    assert.equal(opt.found, true);
    assert.equal(opt.suggestions.length, 1);
    const s = opt.suggestions[0];
    assert.equal(s.before.time.label, 'O(n^2)');
    assert.equal(s.after.time.label, 'O(n)');
    assert.ok(s.reason.includes('N5'));
});

test('optimize-core: Pattern 4 - Triple Counting Loop: O(n^3) -> O(1)', () => {
    const repTriple = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'c = 0; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'j = 1' },
            { id: 'N5', type: 'dec', text: 'j <= n' },
            { id: 'N6', type: 'proc', text: 'k = 1' },
            { id: 'N7', type: 'dec', text: 'k <= n' },
            { id: 'N8', type: 'proc', text: 'c = c + 1; k = k + 1' },
            { id: 'N9', type: 'proc', text: 'j = j + 1' },
            { id: 'N10', type: 'proc', text: 'i = i + 1' },
            { id: 'N11', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N5', label: null },
            { from: 'N5', to: 'N6', label: 'Yes' },
            { from: 'N6', to: 'N7', label: null },
            { from: 'N7', to: 'N8', label: 'Yes' },
            { from: 'N8', to: 'N7', label: null },
            { from: 'N7', to: 'N9', label: 'No' },
            { from: 'N9', to: 'N5', label: null },
            { from: 'N5', to: 'N10', label: 'No' },
            { from: 'N10', to: 'N3', label: null },
            { from: 'N3', to: 'N11', label: 'No' }
        ]
    };

    const opt = findOptimizations(repTriple);
    assert.equal(opt.found, true);
    assert.equal(opt.suggestions[0].before.time.label, 'O(n^3)');
    assert.equal(opt.suggestions[0].after.time.label, 'O(1)');
});

test('optimize-core: Pattern 5 - Divisor Bound (positive and negative cases)', () => {
    // Positive
    const repDivisor = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'io', text: 'Input n' },
            { id: 'N3', type: 'proc', text: 'i = 2' },
            { id: 'N4', type: 'dec', text: 'i <= n' },
            { id: 'N5', type: 'dec', text: 'n mod i == 0' },
            { id: 'N6', type: 'io', text: 'Display "Not prime"' },
            { id: 'N7', type: 'proc', text: 'i = i + 1' },
            { id: 'N8', type: 'io', text: 'Display "Prime"' },
            { id: 'N9', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: null },
            { from: 'N4', to: 'N5', label: 'Yes' },
            { from: 'N5', to: 'N6', label: 'Yes' }, // Exits loop
            { from: 'N6', to: 'N9', label: null },
            { from: 'N5', to: 'N7', label: 'No' },
            { from: 'N7', to: 'N4', label: null },
            { from: 'N4', to: 'N8', label: 'No' },
            { from: 'N8', to: 'N9', label: null }
        ]
    };

    const opt = findOptimizations(repDivisor);
    assert.equal(opt.found, true);
    assert.equal(opt.suggestions.length, 1);
    const s = opt.suggestions[0];
    assert.equal(s.title, 'Square Root Divisor Bound');
    const rewrittenHeader = s.rewritten.nodes.find((n: any) => n.id === 'N4');
    assert.ok(rewrittenHeader);
    assert.equal(rewrittenHeader.text, 'i * i <= n');

    // Negative: other statements in body reference i
    const repDivisorNeg = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'i = 2' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'dec', text: 'n % i == 0' },
            { id: 'N5', type: 'proc', text: 'last = i; i = i + 1' }, // references i
            { id: 'N6', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N6', label: 'Yes' },
            { from: 'N4', to: 'N5', label: 'No' },
            { from: 'N5', to: 'N3', label: null },
            { from: 'N3', to: 'N6', label: 'No' }
        ]
    };
    assert.equal(findOptimizations(repDivisorNeg).found, false);
});

test('optimize-core: Mathematical equivalence simulation for n from -3 to 25 (Patterns 1-3)', () => {
    for (let n = -3; n <= 25; n++) {
        // Pattern 1: Arithmetic Series
        // Original loop
        let sumOrig = 0;
        let i1 = 1;
        while (i1 <= n) {
            sumOrig = sumOrig + i1;
            i1 = i1 + 1;
        }
        // Rewritten closed form
        let sumOpt = 0;
        if (n >= 1) {
            sumOpt = sumOpt + (n * (n + 1)) / 2;
        }
        assert.equal(sumOpt, sumOrig, `Pattern 1 mismatch at n=${n}`);

        // Pattern 2: Constant Addition (c = 7)
        const c = 7;
        let accOrig = 0;
        let i2 = 1;
        while (i2 <= n) {
            accOrig = accOrig + c;
            i2 = i2 + 1;
        }
        let accOpt = 0;
        if (n >= 1) {
            accOpt = accOpt + c * n;
        }
        assert.equal(accOpt, accOrig, `Pattern 2 mismatch at n=${n}`);

        // Pattern 3: Pure Counting
        let cntOrig = 0;
        let i3 = 1;
        while (i3 <= n) {
            cntOrig = cntOrig + 1;
            i3 = i3 + 1;
        }
        let cntOpt = 0;
        if (n >= 1) {
            cntOpt = cntOpt + n;
        }
        assert.equal(cntOpt, cntOrig, `Pattern 3 mismatch at n=${n}`);
    }
});

test('optimize-core: Pattern 5 divisor equivalence for n from 2 to 200', () => {
    for (let n = 2; n <= 200; n++) {
        // Original loop: checks all i from 2 to n - 1
        let origHasDivisor = false;
        let i = 2;
        while (i < n) {
            if (n % i === 0) {
                origHasDivisor = true;
                break;
            }
            i = i + 1;
        }

        // Rewritten loop: checks i * i <= n
        let optHasDivisor = false;
        let j = 2;
        while (j * j <= n) {
            if (n % j === 0) {
                optHasDivisor = true;
                break;
            }
            j = j + 1;
        }

        assert.equal(optHasDivisor, origHasDivisor, `Pattern 5 divisor mismatch at n=${n}`);
    }
});

test('optimize-core: Input immutability', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'sum = 0; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'sum = sum + i; i = i + 1' },
            { id: 'N5', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'Yes' },
            { from: 'N4', to: 'N3', label: null },
            { from: 'N3', to: 'N5', label: 'No' }
        ]
    };

    const beforeJson = JSON.stringify(rep);
    findOptimizations(rep);
    const afterJson = JSON.stringify(rep);
    assert.equal(afterJson, beforeJson);
});

test('optimize-core: Golden Fixtures (01_sum_of_n .. 04_rev)', () => {
    const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures');
    const f01 = fs.readFileSync(path.join(fixturesDir, '01_sum_of_n.txt'), 'utf8');
    const f02 = fs.readFileSync(path.join(fixturesDir, '02_odd_or_even.txt'), 'utf8');
    const f03 = fs.readFileSync(path.join(fixturesDir, '03_largest.txt'), 'utf8');
    const f04 = fs.readFileSync(path.join(fixturesDir, '04_rev.txt'), 'utf8');

    const rep01 = parseDsl(f01).representation;
    const rep02 = parseDsl(f02).representation;
    const rep03 = parseDsl(f03).representation;
    const rep04 = parseDsl(f04).representation;

    // Existing pseudocode and complexity output must be completely unchanged
    const exp01 = fs.readFileSync(path.join(fixturesDir, '01_sum_of_n.expected.txt'), 'utf8');
    const exp02 = fs.readFileSync(path.join(fixturesDir, '02_odd_or_even.expected.txt'), 'utf8');
    const exp03 = fs.readFileSync(path.join(fixturesDir, '03_largest.expected.txt'), 'utf8');
    const exp04 = fs.readFileSync(path.join(fixturesDir, '04_rev.expected.txt'), 'utf8');

    assert.equal(generatePseudocode(rep01).pseudocode.trim(), exp01.trim());
    assert.equal(generatePseudocode(rep02).pseudocode.trim(), exp02.trim());
    assert.equal(generatePseudocode(rep03).pseudocode.trim(), exp03.trim());
    assert.equal(generatePseudocode(rep04).pseudocode.trim(), exp04.trim());

    assert.equal(analyzeComplexity(rep01).time.label, 'O(n)');
    assert.equal(analyzeComplexity(rep02).time.label, 'O(1)');
    assert.equal(analyzeComplexity(rep03).time.label, 'O(1)');
    assert.equal(analyzeComplexity(rep04).time.label, "Couldn't determine");

    // 01_sum_of_n is expected to produce an optimization suggestion
    const opt01 = findOptimizations(rep01);
    assert.equal(opt01.found, true);
    assert.equal(opt01.suggestions.length, 1);
    assert.equal(opt01.suggestions[0].title, 'Arithmetic Series Closed Form');
    assert.equal(opt01.suggestions[0].before.time.label, 'O(n)');
    assert.equal(opt01.suggestions[0].after.time.label, 'O(1)');

    // 02_odd_or_even and 03_largest: found is false
    assert.equal(findOptimizations(rep02).found, false);
    assert.equal(findOptimizations(rep03).found, false);

    // 04_rev does not match known patterns: found is false
    assert.equal(findOptimizations(rep04).found, false);
});

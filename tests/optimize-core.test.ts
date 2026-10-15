// Unit tests for static loop optimization rules (pure logic, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    findOptimizations,
    applyOptimization,
    restoreOriginal,
    isApplicable
} from '../public/js/optimize-core.js';
import { analyzeComplexity } from '../public/js/complexity-core.js';
import { parseDsl } from '../src/parser.js';
import { generatePseudocode } from '../src/generator.js';
import { validateRepresentation } from '../src/validator.js';

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

test('optimize-core: applyOptimization and restoreOriginal roundtrip & immutability', () => {
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

    const originalState = {
        representation: rep,
        positions: { N1: { x: 500, y: 60 }, N2: { x: 500, y: 200 } },
        edgeSides: { 'N3->N4': 'bottom' },
        sourceId: 'src-original-123'
    };

    const originalStateSnapshot = JSON.stringify(originalState);
    const optResult = findOptimizations(rep);
    assert.equal(optResult.found, true);
    const suggestion = optResult.suggestions[0];

    // 1. applyOptimization
    const appliedState = applyOptimization(originalState, suggestion);

    // Input state must never be mutated
    assert.equal(JSON.stringify(originalState), originalStateSnapshot);

    // New state holds rewritten rep, fresh autoLayout positions, fresh sourceId, and previous slot
    assert.deepEqual(appliedState.representation, suggestion.rewritten);
    assert.ok(appliedState.positions);
    assert.ok(appliedState.positions.N1);
    assert.notEqual(appliedState.sourceId, originalState.sourceId);
    assert.equal(typeof appliedState.sourceId, 'string');
    assert.ok(appliedState.sourceId.length > 0);
    assert.equal(appliedState.isEditor, true);
    assert.deepEqual(appliedState.previous.representation, originalState.representation);
    assert.equal(appliedState.previous.sourceId, originalState.sourceId);

    // 2. restoreOriginal
    const restoredState = restoreOriginal(appliedState);

    // Restored state brings back original diagram and sourceId
    assert.deepEqual(restoredState.representation, originalState.representation);
    assert.deepEqual(restoredState.positions, originalState.positions);
    assert.equal(restoredState.sourceId, originalState.sourceId);
    assert.equal(restoredState.previous, null);

    // Running findOptimizations on restored diagram must again offer the same suggestion
    const reOpt = findOptimizations(restoredState.representation);
    assert.equal(reOpt.found, true);
    assert.equal(reOpt.suggestions[0].title, suggestion.title);
});

test('optimize-core: applying twice does not lose diagram (restore returns diagram from before LATEST apply)', () => {
    // Original State
    const state0 = {
        representation: {
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
        },
        sourceId: 'src-0'
    };

    const opt0 = findOptimizations(state0.representation);
    assert.equal(opt0.found, true);

    // First apply: state0 -> state1
    const state1 = applyOptimization(state0, opt0.suggestions[0]);
    assert.equal(state1.previous.sourceId, 'src-0');

    // Synthetic second suggestion (e.g. further edit)
    const suggestion2 = {
        rewritten: {
            nodes: [
                { id: 'N1', type: 'start', text: 'Start' },
                { id: 'N2', type: 'proc', text: 'sum = 55' },
                { id: 'N5', type: 'end', text: 'End' }
            ],
            edges: [
                { from: 'N1', to: 'N2', label: null },
                { from: 'N2', to: 'N5', label: null }
            ]
        }
    };

    // Second apply: state1 -> state2
    // The previous slot is overwritten by state1 (the diagram from before the latest apply)
    const state2 = applyOptimization(state1, suggestion2);
    assert.equal(state2.previous.sourceId, state1.sourceId);
    assert.deepEqual(state2.previous.representation, state1.representation);

    // Restore on state2 returns state1 (the diagram from before the LATEST apply)
    const restoredFrom2 = restoreOriginal(state2);
    assert.equal(restoredFrom2.sourceId, state1.sourceId);
    assert.deepEqual(restoredFrom2.representation, state1.representation);
});

test('optimize-core: isApplicable validation handling', () => {
    const validSuggestion = {
        rewritten: {
            nodes: [
                { id: 'N1', type: 'start', text: 'Start' },
                { id: 'N2', type: 'dec', text: 'n >= 1' },
                { id: 'N3', type: 'proc', text: 'sum = sum + n * (n + 1) / 2' },
                { id: 'N4', type: 'end', text: 'End' }
            ],
            edges: [
                { from: 'N1', to: 'N2', label: null },
                { from: 'N2', to: 'N3', label: 'Yes' },
                { from: 'N2', to: 'N4', label: 'No' },
                { from: 'N3', to: 'N4', label: null }
            ]
        }
    };

    assert.equal(isApplicable(validSuggestion, validateRepresentation), true);
    assert.equal(isApplicable(validSuggestion), true); // default without validate

    // Invalid suggestion: orphan node unreachable from start
    const invalidSuggestion = {
        rewritten: {
            nodes: [
                { id: 'N1', type: 'start', text: 'Start' },
                { id: 'N2', type: 'end', text: 'End' },
                { id: 'N3_orphan', type: 'proc', text: 'x = 1' }
            ],
            edges: [
                { from: 'N1', to: 'N2', label: null }
            ]
        }
    };

    assert.equal(isApplicable(invalidSuggestion, validateRepresentation), false);
    assert.equal(isApplicable(null), false);
    assert.equal(isApplicable({ rewritten: null }), false);
});

test('optimize-core: findOptimizations on an already optimized diagram returns found: false (Patterns 1-4)', () => {
    // 1. Pattern 1: Arithmetic Series
    const repP1 = {
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
    const optP1 = findOptimizations(repP1);
    assert.equal(optP1.found, true);
    const rewrittenP1 = optP1.suggestions[0].rewritten;
    // Analyzing rewritten copy has no more loops to optimize
    assert.equal(findOptimizations(rewrittenP1).found, false);

    // 2. Pattern 2: Constant Addition
    const repP2 = {
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
    const optP2 = findOptimizations(repP2);
    assert.equal(optP2.found, true);
    assert.equal(findOptimizations(optP2.suggestions[0].rewritten).found, false);

    // 3. Pattern 3: Pure Counting
    const repP3 = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'cnt = 0; i = 1' },
            { id: 'N3', type: 'dec', text: 'i <= n' },
            { id: 'N4', type: 'proc', text: 'cnt = cnt + 1; i = i + 1' },
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
    const optP3 = findOptimizations(repP3);
    assert.equal(optP3.found, true);
    assert.equal(findOptimizations(optP3.suggestions[0].rewritten).found, false);

    // 4. Pattern 4: Triple Counting Loop (all reduced to closed form)
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
    const optP4 = findOptimizations(repTriple);
    assert.equal(optP4.found, true);
    assert.equal(findOptimizations(optP4.suggestions[0].rewritten).found, false);
});


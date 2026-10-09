// Unit tests for static time and auxiliary space complexity analysis of flowcharts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeComplexity, splitStatements, isAssignment, detectLoops } from '../public/js/complexity-core.js';

test('complexity-core: statement splitting parity', () => {
    assert.deepEqual(splitStatements('sum = 0; i = 1'), ['sum = 0', 'i = 1']);
    assert.deepEqual(splitStatements('Sum = Sum + i, i = i + 1'), ['Sum = Sum + i', 'i = i + 1']);
    assert.deepEqual(splitStatements('a = 1, b = 2; c = 3'), ['a = 1', 'b = 2', 'c = 3']);
    assert.deepEqual(splitStatements('print("a, b")'), ['print("a, b")']);
    assert.equal(isAssignment('i = i + 1'), true);
    assert.equal(isAssignment('i == 1'), false);
    assert.equal(isAssignment('i <= 10'), false);
});

test('complexity-core: Fixture 1 - sum of 1..n (Linear O(n))', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'io', text: 'Input n' },
            { id: 'N3', type: 'proc', text: 'Sum = 0, i = 1' },
            { id: 'N4', type: 'dec', text: 'i <= n ?' },
            { id: 'N5', type: 'proc', text: 'Sum = Sum + i; i = i + 1' },
            { id: 'N6', type: 'io', text: 'Display Sum' },
            { id: 'N7', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: null },
            { from: 'N4', to: 'N5', label: 'YES' },
            { from: 'N4', to: 'N6', label: 'NO' },
            { from: 'N5', to: 'N4', label: null },
            { from: 'N6', to: 'N7', label: null }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.time.label, 'O(n)');
    assert.equal(res.time.status, 'estimated');
    assert.ok(res.time.reasons[0].includes('N4'));
    assert.ok(res.time.reasons[0].includes('N2'));

    assert.equal(res.space.label, 'O(1)');
    assert.equal(res.space.status, 'estimated');
    assert.equal(res.loops.length, 1);
    assert.equal(res.loops[0].headerId, 'N4');
    assert.equal(res.loops[0].pattern, 'linear');
    assert.equal(res.loops[0].variable, 'i');
});

test('complexity-core: Fixture 2 - Fibonacci-style diagram (decision, loop, End branch)', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'io', text: 'Input n' },
            { id: 'N3', type: 'proc', text: 'a = 0; b = 1; count = 0' },
            { id: 'N4', type: 'dec', text: 'count < n' },
            { id: 'N5', type: 'proc', text: 'temp = a + b; a = b; b = temp; count = count + 1' },
            { id: 'N6', type: 'io', text: 'Display a' },
            { id: 'N7', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: null },
            { from: 'N4', to: 'N5', label: 'YES' },
            { from: 'N4', to: 'N6', label: 'NO' },
            { from: 'N5', to: 'N4', label: null },
            { from: 'N6', to: 'N7', label: null }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.time.label, 'O(n)');
    assert.equal(res.time.status, 'estimated');
    assert.ok(res.time.reasons[0].includes('N4'));
    assert.equal(res.space.label, 'O(1)');
    assert.equal(res.loops[0].headerId, 'N4');
});

test('complexity-core: Fixture 3 - digit loop with num = num / 10 (Logarithmic O(log n))', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'io', text: 'Input num' },
            { id: 'N3', type: 'proc', text: 'digits = 0' },
            { id: 'N4', type: 'dec', text: 'num > 0 ?' },
            { id: 'N5', type: 'proc', text: 'digits = digits + 1; num = Math.floor(num / 10)' },
            { id: 'N6', type: 'io', text: 'Output digits' },
            { id: 'N7', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: null },
            { from: 'N4', to: 'N5', label: 'YES' },
            { from: 'N4', to: 'N6', label: 'NO' },
            { from: 'N5', to: 'N4', label: null },
            { from: 'N6', to: 'N7', label: null }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.time.label, 'O(log n)');
    assert.equal(res.time.status, 'estimated');
    assert.ok(res.time.reasons[0].includes('N4'));
    assert.equal(res.loops[0].pattern, 'logarithmic');
});

test('complexity-core: Fixture 4 - doubling loop i = i * 2 (Logarithmic O(log n))', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'io', text: 'Input limit' },
            { id: 'N3', type: 'proc', text: 'i = 1' },
            { id: 'N4', type: 'dec', text: 'i < limit' },
            { id: 'N5', type: 'proc', text: 'i = i * 2' },
            { id: 'N6', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: null },
            { from: 'N4', to: 'N5', label: 'YES' },
            { from: 'N4', to: 'N6', label: 'NO' },
            { from: 'N5', to: 'N4', label: null }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.time.label, 'O(log n)');
    assert.equal(res.time.status, 'estimated');
    assert.ok(res.time.reasons[0].includes('N4'));
    assert.equal(res.loops[0].pattern, 'logarithmic');
});

test('complexity-core: Fixture 5 - nested loops over i and j (Quadratic O(n^2))', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'io', text: 'Input n' },
            { id: 'N3', type: 'proc', text: 'i = 0' },
            { id: 'N4', type: 'dec', text: 'i < n' },
            { id: 'N5', type: 'proc', text: 'j = 0' },
            { id: 'N6', type: 'dec', text: 'j < n' },
            { id: 'N7', type: 'proc', text: 'j = j + 1' },
            { id: 'N8', type: 'proc', text: 'i = i + 1' },
            { id: 'N9', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: null },
            { from: 'N4', to: 'N5', label: 'YES' },
            { from: 'N5', to: 'N6', label: null },
            { from: 'N6', to: 'N7', label: 'YES' },
            { from: 'N7', to: 'N6', label: null },
            { from: 'N6', to: 'N8', label: 'NO' },
            { from: 'N8', to: 'N4', label: null },
            { from: 'N4', to: 'N9', label: 'NO' }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.time.label, 'O(n^2)');
    assert.equal(res.time.status, 'estimated');
    assert.equal(res.loops.length, 2);
    assert.ok(res.time.reasons[0].includes('N4'));
    assert.ok(res.time.reasons[0].includes('N6'));
});

test('complexity-core: Fixture 6 - two sequential loops (O(n))', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'io', text: 'Input n' },
            { id: 'N3', type: 'proc', text: 'i = 0' },
            { id: 'N4', type: 'dec', text: 'i < n' },
            { id: 'N5', type: 'proc', text: 'i = i + 1' },
            { id: 'N6', type: 'proc', text: 'j = 0' },
            { id: 'N7', type: 'dec', text: 'j < n' },
            { id: 'N8', type: 'proc', text: 'j = j + 1' },
            { id: 'N9', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: null },
            { from: 'N4', to: 'N5', label: 'YES' },
            { from: 'N5', to: 'N4', label: null },
            { from: 'N4', to: 'N6', label: 'NO' },
            { from: 'N6', to: 'N7', label: null },
            { from: 'N7', to: 'N8', label: 'YES' },
            { from: 'N8', to: 'N7', label: null },
            { from: 'N7', to: 'N9', label: 'NO' }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.time.label, 'O(n)');
    assert.equal(res.time.status, 'estimated');
    assert.equal(res.loops.length, 2);
    assert.ok(res.time.reasons[0].includes('Sequential'));
});

test('complexity-core: Fixture 7 - straight-line code (no loop = O(1))', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'x = 5; y = 10' },
            { id: 'N3', type: 'io', text: 'Print x + y' },
            { id: 'N4', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: null }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.time.label, 'O(1)');
    assert.equal(res.time.status, 'estimated');
    assert.equal(res.loops.length, 0);
    assert.equal(res.space.label, 'O(1)');
});

test('complexity-core: Fixture 8 - loop with no update of its variable (unknown)', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'dec', text: 'i < 10' },
            { id: 'N3', type: 'proc', text: 'y = y + 1' },
            { id: 'N4', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: 'YES' },
            { from: 'N3', to: 'N2', label: null },
            { from: 'N2', to: 'N4', label: 'NO' }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.time.label, "Couldn't determine");
    assert.equal(res.time.status, 'unknown');
    assert.ok(res.time.reasons[0].includes('N2'));
    assert.ok(res.time.reasons[0].includes('no update'));
});

test('complexity-core: Fixture 9 - unparsable update text in body (unknown)', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'dec', text: 'i < 10' },
            { id: 'N3', type: 'proc', text: 'i = complex_custom_magic(i)' },
            { id: 'N4', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: 'YES' },
            { from: 'N3', to: 'N2', label: null },
            { from: 'N2', to: 'N4', label: 'NO' }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.time.label, "Couldn't determine");
    assert.equal(res.time.status, 'unknown');
    assert.ok(res.time.reasons[0].includes('N2'));
});

test('complexity-core: Fixture 10 - numeric-literal bound (O(1))', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'k = 0' },
            { id: 'N3', type: 'dec', text: 'k < 100' },
            { id: 'N4', type: 'proc', text: 'k = k + 1' },
            { id: 'N5', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: 'YES' },
            { from: 'N4', to: 'N3', label: null },
            { from: 'N3', to: 'N5', label: 'NO' }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.time.label, 'O(1)');
    assert.equal(res.time.status, 'estimated');
    assert.equal(res.loops[0].pattern, 'constant');
    assert.ok(res.time.reasons[0].includes('N3'));
});

test('complexity-core: Fixture 11 - diagram with orphan box', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'proc', text: 'x = 1' },
            { id: 'N3', type: 'end', text: 'End' },
            { id: 'ORPHAN', type: 'proc', text: 'z = 999' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.time.label, 'O(1)');
    assert.equal(res.time.status, 'estimated');
    assert.equal(res.space.label, 'O(1)');
});

test('complexity-core: Fixture 12 - diagram with no start node', () => {
    const rep = {
        nodes: [
            { id: 'N2', type: 'proc', text: 'x = 1' },
            { id: 'N3', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N2', to: 'N3', label: null }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.time.label, "Couldn't determine");
    assert.equal(res.time.status, 'unknown');
    assert.ok(res.time.reasons[0].includes('No start node'));
    assert.equal(res.space.status, 'unknown');
});

test('complexity-core: Auxiliary space - dynamic array / indexed write', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'io', text: 'Input n' },
            { id: 'N3', type: 'proc', text: 'let list = []' },
            { id: 'N4', type: 'proc', text: 'arr[i] = i * 2' },
            { id: 'N5', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: null },
            { from: 'N4', to: 'N5', label: null }
        ]
    };

    const res = analyzeComplexity(rep);
    assert.equal(res.space.label, 'O(n)');
    assert.equal(res.space.status, 'estimated');
    assert.ok(res.space.reasons[0].includes('Auxiliary space only'));
});

test('complexity-core: Determinism - repeated runs yield identical results', () => {
    const rep = {
        nodes: [
            { id: 'N1', type: 'start', text: 'Start' },
            { id: 'N2', type: 'io', text: 'Input n' },
            { id: 'N3', type: 'proc', text: 'i = 0; s = 0' },
            { id: 'N4', type: 'dec', text: 'i < n ?' },
            { id: 'N5', type: 'proc', text: 's = s + i; i = i + 1' },
            { id: 'N6', type: 'end', text: 'End' }
        ],
        edges: [
            { from: 'N1', to: 'N2', label: null },
            { from: 'N2', to: 'N3', label: null },
            { from: 'N3', to: 'N4', label: null },
            { from: 'N4', to: 'N5', label: 'YES' },
            { from: 'N5', to: 'N4', label: null },
            { from: 'N4', to: 'N6', label: 'NO' }
        ]
    };

    const run1 = analyzeComplexity(rep);
    const run2 = analyzeComplexity(rep);
    const run3 = analyzeComplexity(rep);

    assert.deepEqual(run1, run2);
    assert.deepEqual(run2, run3);
});

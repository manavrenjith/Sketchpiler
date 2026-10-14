/**
 * Pure, deterministic static optimization analyzer for flowcharts.
 * Detects algebraic and structural loop patterns and produces safe closed-form rewrites.
 * No DOM, no network dependencies.
 */

import {
    analyzeComplexity,
    detectLoops,
    normalizeCondition,
    splitStatements,
    isAssignment
} from './complexity-core.js';

/**
 * Deep-clones a flowchart representation.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function clone(obj) {
    if (!obj) return obj;
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Compares complexity labels to determine ranking (lower is better).
 * @param {string} label
 * @returns {number}
 */
function getComplexityRank(label) {
    if (!label) return 999;
    if (label === 'O(1)') return 0;
    if (label === 'O(log n)') return 1;
    if (label === 'O(n)') return 2;
    if (label === 'O(n log n)') return 3;
    if (label === 'O(n^2)') return 4;
    if (label === 'O(n^3)') return 5;
    const match = label.match(/^O\(n\^(\d+)\)$/);
    if (match) return 2 * Number(match[1]);
    return 999;
}

/**
 * Checks whether after complexity is strictly better than before complexity.
 * @param {{ time: { label: string, status: string } }} before
 * @param {{ time: { label: string, status: string } }} after
 * @returns {boolean}
 */
function isStrictlyBetter(before, after) {
    if (before.time.status !== 'estimated' || after.time.status !== 'estimated') {
        return false;
    }
    return getComplexityRank(after.time.label) < getComplexityRank(before.time.label);
}

/**
 * Finds literal integer initialization of variable `varName` prior to loop header.
 * @param {string} preNodeId
 * @param {string} varName
 * @param {Map<string, any>} nodeMap
 * @param {Map<string, any[]>} incoming
 * @returns {number | null} null if not found or non-literal
 */
function findLiteralInit(preNodeId, varName, nodeMap, incoming) {
    let curr = preNodeId;
    const visited = new Set();

    while (curr && !visited.has(curr)) {
        visited.add(curr);
        const node = nodeMap.get(curr);
        if (!node) break;

        if (node.type === 'proc') {
            const stmts = splitStatements(node.text);
            // Scan statements in reverse order to find the latest assignment to varName
            for (let i = stmts.length - 1; i >= 0; i--) {
                const s = stmts[i].trim();
                const match = s.match(new RegExp(`^${varName}\\s*=(?!=)\\s*(.+)$`));
                if (match) {
                    const rhs = match[1].trim();
                    if (/^-?\d+$/.test(rhs)) {
                        return parseInt(rhs, 10);
                    }
                    return null; // Assigned a non-literal expression or variable
                }
            }
        }

        // Trace upwards if straight line
        const inEdges = incoming.get(curr) || [];
        if (inEdges.length === 1) {
            curr = inEdges[0].from;
        } else {
            break;
        }
    }

    return null;
}

/**
 * Parses a simple condition into variable, bound, and direction.
 * @param {string} text
 * @returns {{ variable: string, bound: string, op: '<='|'<'|'>='|'>' } | null}
 */
function parseComparison(text) {
    const cond = normalizeCondition(text);
    if (!cond) return null;

    // Pattern 1: var op bound
    const m1 = cond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(<=|<|>=|>)\s*(.+)$/);
    if (m1) {
        return {
            variable: m1[1].trim(),
            op: /** @type {'<='|'<'|'>='|'>'} */ (m1[2].trim()),
            bound: m1[3].trim()
        };
    }

    // Pattern 2: bound op var
    const m2 = cond.match(/^(.+?)\s*(<=|<|>=|>)\s*([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (m2) {
        const rawOp = m2[2].trim();
        let flipped = '<=';
        if (rawOp === '<=') flipped = '>=';
        else if (rawOp === '<') flipped = '>';
        else if (rawOp === '>=') flipped = '<=';
        else if (rawOp === '>') flipped = '<';

        return {
            variable: m2[3].trim(),
            op: /** @type {'<='|'<'|'>='|'>'} */ (flipped),
            bound: m2[1].trim()
        };
    }

    return null;
}

/**
 * Inspects a step statement for varName.
 * @param {string} stmt
 * @param {string} varName
 * @returns {number | null} step amount (e.g. 1) or null
 */
function getStepAmount(stmt, varName) {
    const s = stmt.trim();
    // i++, ++i, i += c, i = i + c, i = c + i
    const inc = new RegExp(`^(?:${varName}\\s*\\+\\+|\\+\\+\\s*${varName}|${varName}\\s*\\+=\\s*(\\d+)|${varName}\\s*=\\s*${varName}\\s*\\+\\s*(\\d+)|${varName}\\s*=\\s*(\\d+)\\s*\\+\\s*${varName})$`);
    const mInc = s.match(inc);
    if (mInc) {
        return parseInt(mInc[1] || mInc[2] || mInc[3] || '1', 10);
    }

    const dec = new RegExp(`^(?:${varName}\\s*--|--\\s*${varName}|${varName}\\s*-=\\s*(\\d+)|${varName}\\s*=\\s*${varName}\\s*-\\s*(\\d+))$`);
    const mDec = s.match(dec);
    if (mDec) {
        return -parseInt(mDec[1] || mDec[2] || '1', 10);
    }

    return null;
}

/**
 * Checks if a string references a variable as an identifier token.
 * @param {string} text
 * @param {string} varName
 * @returns {boolean}
 */
function referencesVar(text, varName) {
    if (!text || !varName) return false;
    return new RegExp(`\\b${varName}\\b`).test(text);
}

/**
 * Analyzes representation for optimization patterns.
 * Pure and deterministic; never mutates the input.
 * @param {{ nodes: Array<{ id: string, type: string, text: string }>, edges: Array<{ from: string, to: string, label?: string|null }> }} representation
 * @returns {{
 *   found: boolean,
 *   suggestions: Array<{
 *     id: string,
 *     title: string,
 *     reason: string,
 *     before: { time: any, space: any },
 *     after: { time: any, space: any },
 *     rewritten: { nodes: any[], edges: any[] },
 *     assumptions: string[]
 *   }>
 * }}
 */
export function findOptimizations(representation) {
    if (!representation || !Array.isArray(representation.nodes) || !Array.isArray(representation.edges)) {
        return { found: false, suggestions: [] };
    }

    // Never mutate input
    const rep = clone(representation);
    const beforeComplexity = analyzeComplexity(rep);
    const rawLoops = detectLoops(rep);

    if (rawLoops.length === 0) {
        return { found: false, suggestions: [] };
    }

    const nodeMap = new Map();
    rep.nodes.forEach(n => nodeMap.set(n.id, n));

    const outgoing = new Map();
    const incoming = new Map();
    rep.nodes.forEach(n => {
        outgoing.set(n.id, []);
        incoming.set(n.id, []);
    });
    rep.edges.forEach(e => {
        if (nodeMap.has(e.from) && nodeMap.has(e.to)) {
            outgoing.get(e.from).push(e);
            incoming.get(e.to).push(e);
        }
    });

    const suggestions = [];

    // Helper: Build nesting tree among detected loops
    // Loop B is strictly nested inside A if B.bodyIds is strict subset of A.bodyIds
    const parentIndex = new Array(rawLoops.length).fill(-1);
    for (let i = 0; i < rawLoops.length; i++) {
        let bestParent = -1;
        let bestParentSize = Infinity;
        const bSet = new Set(rawLoops[i].bodyIds);

        for (let j = 0; j < rawLoops.length; j++) {
            if (i === j) continue;
            const aSet = new Set(rawLoops[j].bodyIds);
            if (bSet.size < aSet.size) {
                let isSubset = true;
                for (const id of bSet) {
                    if (!aSet.has(id)) {
                        isSubset = false;
                        break;
                    }
                }
                if (isSubset && aSet.size < bestParentSize) {
                    bestParent = j;
                    bestParentSize = aSet.size;
                }
            }
        }
        parentIndex[i] = bestParent;
    }

    // Pattern 4: Check for nested loop closed form elimination
    const hasNesting = parentIndex.some(p => p !== -1);
    if (hasNesting) {
        const nestedSuggestion = checkNestedLoops(rep, rawLoops, parentIndex, beforeComplexity);
        if (nestedSuggestion) {
            suggestions.push(nestedSuggestion);
        }
    }

    // If no nested optimization was applied, check each loop individually for patterns 1, 2, 3, 5
    if (suggestions.length === 0) {
        for (const loop of rawLoops) {
            const suggestion = checkSingleLoop(rep, loop, nodeMap, outgoing, incoming, beforeComplexity);
            if (suggestion) {
                suggestions.push(suggestion);
            }
        }
    }

    return {
        found: suggestions.length > 0,
        suggestions
    };
}

/**
 * Checks a single loop against patterns 1, 2, 3, 5.
 * @param {any} rep
 * @param {{ headerId: string, bodyIds: string[], backEdge: any }} loop
 * @param {Map<string, any>} nodeMap
 * @param {Map<string, any[]>} outgoing
 * @param {Map<string, any[]>} incoming
 * @param {any} beforeComplexity
 * @returns {any | null}
 */
function checkSingleLoop(rep, loop, nodeMap, outgoing, incoming, beforeComplexity) {
    const headerNode = nodeMap.get(loop.headerId);
    if (!headerNode || headerNode.type !== 'dec') return null;

    const outEdges = outgoing.get(loop.headerId) || [];
    if (outEdges.length !== 2) return null;

    const bodySet = new Set(loop.bodyIds);

    // Identify bodyEdge vs exitEdge from header
    const edgeA = outEdges[0];
    const edgeB = outEdges[1];
    const aInBody = bodySet.has(edgeA.to);
    const bInBody = bodySet.has(edgeB.to);

    if (aInBody === bInBody) {
        // Ambiguous edges
        return null;
    }

    const bodyEdge = aInBody ? edgeA : edgeB;
    const exitEdge = aInBody ? edgeB : edgeA;
    const exitNodeId = exitEdge.to;

    // Incoming entry edges to header from outside body
    const inEdges = incoming.get(loop.headerId) || [];
    const entryEdges = inEdges.filter(e => !bodySet.has(e.from));
    if (entryEdges.length !== 1) {
        // Ambiguous multiple loop entries
        return null;
    }
    const preNodeId = entryEdges[0].from;

    const condParsed = parseComparison(headerNode.text);
    if (!condParsed) return null;

    const loopVar = condParsed.variable;
    const rawBound = condParsed.bound;

    // Check if bound is an identifier or literal integer
    const isBoundIdent = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawBound);
    const isBoundLiteral = /^-?\d+$/.test(rawBound);
    if (!isBoundIdent && !isBoundLiteral) {
        return null;
    }

    const bodyNodeIds = loop.bodyIds.filter(id => id !== loop.headerId);

    // Check if bound is modified inside loop
    for (const bId of bodyNodeIds) {
        const bNode = nodeMap.get(bId);
        if (bNode && bNode.type === 'proc') {
            const stmts = splitStatements(bNode.text);
            for (const s of stmts) {
                if (isAssignment(s)) {
                    const target = s.split('=')[0].trim();
                    if (target === rawBound) {
                        // Bound modified inside loop!
                        return null;
                    }
                }
            }
        }
    }

    // Check Pattern 5: Divisor bound first if there is a decision inside the body
    const decNodesInBody = bodyNodeIds
        .map(id => nodeMap.get(id))
        .filter(n => n && n.type === 'dec');

    if (decNodesInBody.length === 1) {
        const p5 = checkPattern5DivisorBound(
            rep,
            loop,
            headerNode,
            decNodesInBody[0],
            loopVar,
            rawBound,
            preNodeId,
            nodeMap,
            outgoing,
            incoming,
            beforeComplexity
        );
        if (p5) return p5;
    }

    // For Patterns 1, 2, 3:
    // All body nodes must be proc nodes and cannot exit loop
    for (const bId of bodyNodeIds) {
        const bNode = nodeMap.get(bId);
        if (!bNode || bNode.type !== 'proc') return null;

        const bOut = outgoing.get(bId) || [];
        for (const e of bOut) {
            if (!bodySet.has(e.to) && e.to !== loop.headerId) {
                // Ambiguous early exit from body
                return null;
            }
        }
    }

    // Inspect initialization of loopVar
    const initVal = findLiteralInit(preNodeId, loopVar, nodeMap, incoming);
    if (initVal === null) {
        // Non-literal start
        return null;
    }

    // Collect statements in body in execution order
    const allStmts = [];
    for (const bId of bodyNodeIds) {
        const bNode = nodeMap.get(bId);
        allStmts.push(...splitStatements(bNode.text));
    }

    // Check updates to loopVar
    let loopVarUpdates = 0;
    let stepAmount = 0;
    const nonStepStmts = [];

    for (const stmt of allStmts) {
        const step = getStepAmount(stmt, loopVar);
        if (step !== null) {
            loopVarUpdates++;
            stepAmount = step;
        } else if (referencesVar(stmt.split('=')[0] || '', loopVar)) {
            // Unrecognized assignment to loopVar
            return null;
        } else {
            nonStepStmts.push(stmt.trim());
        }
    }

    if (loopVarUpdates !== 1 || stepAmount !== 1) {
        // Step must be exactly +1
        return null;
    }

    // Non-step statements must be exactly 1 assignment
    if (nonStepStmts.length !== 1) {
        // Extra statements in body
        return null;
    }

    const workStmt = nonStepStmts[0];
    if (!isAssignment(workStmt)) return null;

    const eqIdx = workStmt.indexOf('=');
    const target = workStmt.slice(0, eqIdx).trim();
    const rhs = workStmt.slice(eqIdx + 1).trim();

    if (target === loopVar || target === rawBound) {
        return null;
    }

    // Check Pattern 1: Arithmetic Series
    // acc = acc + i or acc = i + acc or acc += i
    // loopVar starts at literal 1, step +1, bound n, condition <= n
    const isAccAddLoopVar =
        rhs === `${target} + ${loopVar}` ||
        rhs === `${loopVar} + ${target}` ||
        workStmt === `${target} += ${loopVar}`;

    if (isAccAddLoopVar && initVal === 1 && condParsed.op === '<=') {
        const acc = target;
        const bound = rawBound;
        const formula = `${acc} = ${acc} + ${bound} * (${bound} + 1) / 2`;
        const guard = `${bound} >= 1`;

        const rewritten = buildRewrittenClosedForm(rep, loop, bodyNodeIds, exitNodeId, guard, formula);
        const afterComplexity = analyzeComplexity(rewritten);

        if (isStrictlyBetter(beforeComplexity, afterComplexity)) {
            return {
                id: `opt-arithmetic-series-${loop.headerId}`,
                title: 'Arithmetic Series Closed Form',
                reason: `Loop at ${loop.headerId} (boxes ${loop.bodyIds.join(', ')}) sums consecutive values of ${loopVar} into ${acc} from 1 to ${bound}. Replaced with closed-form formula ${formula} guarded by ${guard}.`,
                before: beforeComplexity,
                after: afterComplexity,
                rewritten,
                assumptions: [
                    `assumes ${bound} is an integer`,
                    'assumes arithmetic does not overflow'
                ]
            };
        }
    }

    // Check Pattern 3: Pure Counting (c = 1)
    // counter = counter + 1, counter += 1, counter++, ++counter
    const isPureCount =
        rhs === `${target} + 1` ||
        rhs === `1 + ${target}` ||
        workStmt === `${target} += 1` ||
        workStmt === `${target}++` ||
        workStmt === `++${target}`;

    if (isPureCount) {
        const counter = target;
        const bound = rawBound;
        let countExpr = bound;
        let guard = `${bound} >= 1`;

        if (initVal === 1 && condParsed.op === '<=') {
            countExpr = bound;
            guard = `${bound} >= 1`;
        } else if (initVal === 0 && condParsed.op === '<') {
            countExpr = bound;
            guard = `${bound} > 0`;
        } else {
            return null;
        }

        const formula = `${counter} = ${counter} + ${countExpr}`;
        const rewritten = buildRewrittenClosedForm(rep, loop, bodyNodeIds, exitNodeId, guard, formula);
        const afterComplexity = analyzeComplexity(rewritten);

        if (isStrictlyBetter(beforeComplexity, afterComplexity)) {
            return {
                id: `opt-pure-counting-${loop.headerId}`,
                title: 'Pure Counting Closed Form',
                reason: `Loop at ${loop.headerId} (boxes ${loop.bodyIds.join(', ')}) only increments counter ${counter} by 1 each iteration. Replaced with closed-form addition ${formula} guarded by ${guard}.`,
                before: beforeComplexity,
                after: afterComplexity,
                rewritten,
                assumptions: [
                    `assumes ${bound} is an integer`
                ]
            };
        }
    }

    // Check Pattern 2: Constant Addition
    // acc = acc + c or acc += c where c is literal or variable not modified in loop
    const constAddMatch =
        rhs.match(new RegExp(`^${target}\\s*\\+\\s*([a-zA-Z_0-9]+)$`)) ||
        rhs.match(new RegExp(`^([a-zA-Z_0-9]+)\\s*\\+\\s*${target}$`)) ||
        workStmt.match(new RegExp(`^${target}\\s*\\+=\\s*([a-zA-Z_0-9]+)$`));

    if (constAddMatch) {
        const c = constAddMatch[1];
        if (c !== loopVar && c !== target) {
            // Verify c is not modified in loop
            let cModified = false;
            for (const s of allStmts) {
                if (isAssignment(s) && s.split('=')[0].trim() === c) {
                    cModified = true;
                    break;
                }
            }

            if (!cModified) {
                const acc = target;
                const bound = rawBound;
                let countExpr = bound;
                let guard = `${bound} >= 1`;

                if (initVal === 1 && condParsed.op === '<=') {
                    countExpr = bound;
                    guard = `${bound} >= 1`;
                } else if (initVal === 0 && condParsed.op === '<') {
                    countExpr = bound;
                    guard = `${bound} > 0`;
                } else {
                    return null;
                }

                const formula = `${acc} = ${acc} + ${c} * ${countExpr}`;
                const rewritten = buildRewrittenClosedForm(rep, loop, bodyNodeIds, exitNodeId, guard, formula);
                const afterComplexity = analyzeComplexity(rewritten);

                if (isStrictlyBetter(beforeComplexity, afterComplexity)) {
                    return {
                        id: `opt-constant-addition-${loop.headerId}`,
                        title: 'Constant Addition Closed Form',
                        reason: `Loop at ${loop.headerId} (boxes ${loop.bodyIds.join(', ')}) repeatedly adds ${c} to ${acc} across ${countExpr} iterations. Replaced with guarded closed-form multiplication ${formula} guarded by ${guard}.`,
                        before: beforeComplexity,
                        after: afterComplexity,
                        rewritten,
                        assumptions: [
                            `assumes ${bound} is an integer`
                        ]
                    };
                }
            }
        }
    }

    return null;
}

/**
 * Pattern 5: Divisor Bound
 * @param {any} rep
 * @param {any} loop
 * @param {any} headerNode
 * @param {any} testDecNode
 * @param {string} loopVar
 * @param {string} bound
 * @param {string} preNodeId
 * @param {Map<string, any>} nodeMap
 * @param {Map<string, any[]>} outgoing
 * @param {Map<string, any[]>} incoming
 * @param {any} beforeComplexity
 * @returns {any | null}
 */
function checkPattern5DivisorBound(
    rep,
    loop,
    headerNode,
    testDecNode,
    loopVar,
    bound,
    preNodeId,
    nodeMap,
    outgoing,
    incoming,
    beforeComplexity
) {
    const initVal = findLiteralInit(preNodeId, loopVar, nodeMap, incoming);
    if (initVal === null || initVal < 2) {
        return null;
    }

    const testCond = normalizeCondition(testDecNode.text);
    // Decision testing bound mod loopVar == 0
    // Accept "mod", "%", "=", "=="
    const modMatch = testCond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:mod|%)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:==|=)\s*0$/i);
    if (!modMatch) return null;

    const opVar1 = modMatch[1].trim();
    const opVar2 = modMatch[2].trim();
    if (opVar1 !== bound || opVar2 !== loopVar) {
        return null;
    }

    // Check that testDecNode's true branch exits the loop
    const testOut = outgoing.get(testDecNode.id) || [];
    if (testOut.length !== 2) return null;

    const bodySet = new Set(loop.bodyIds);
    let trueEdge = null;
    let falseEdge = null;

    for (const e of testOut) {
        const lbl = (e.label || '').trim().toLowerCase();
        if (lbl === 'yes' || lbl === 'true') {
            trueEdge = e;
        } else if (lbl === 'no' || lbl === 'false') {
            falseEdge = e;
        }
    }

    if (!trueEdge || !falseEdge) {
        // Fallback: check which branch leaves the body
        if (!bodySet.has(testOut[0].to) && bodySet.has(testOut[1].to)) {
            trueEdge = testOut[0];
            falseEdge = testOut[1];
        } else if (!bodySet.has(testOut[1].to) && bodySet.has(testOut[0].to)) {
            trueEdge = testOut[1];
            falseEdge = testOut[0];
        } else {
            return null;
        }
    }

    if (bodySet.has(trueEdge.to)) {
        // True branch must exit the loop
        return null;
    }

    // Check statements in the body: only step and test may use loopVar
    const bodyNodeIds = loop.bodyIds.filter(id => id !== loop.headerId && id !== testDecNode.id);
    let foundStep = false;

    for (const bId of bodyNodeIds) {
        const bNode = nodeMap.get(bId);
        if (!bNode) return null;
        if (bNode.type === 'proc') {
            const stmts = splitStatements(bNode.text);
            for (const s of stmts) {
                const step = getStepAmount(s, loopVar);
                if (step === 1) {
                    foundStep = true;
                } else if (referencesVar(s, loopVar)) {
                    // Other statement uses loopVar!
                    return null;
                }
            }
        } else {
            // No other decisions allowed in body
            return null;
        }
    }

    if (!foundStep) return null;

    // Rewrite: change header condition to loopVar * loopVar <= bound
    const rewritten = clone(rep);
    const rewrittenHeader = rewritten.nodes.find((n) => n.id === loop.headerId);
    if (!rewrittenHeader) return null;

    rewrittenHeader.text = `${loopVar} * ${loopVar} <= ${bound}`;
    const afterComplexity = analyzeComplexity(rewritten);

    return {
        id: `opt-divisor-bound-${loop.headerId}`,
        title: 'Square Root Divisor Bound',
        reason: `Loop at ${loop.headerId} (boxes ${loop.bodyIds.join(', ')}) tests if ${loopVar} divides ${bound}. If ${bound} has a non-trivial factor, at least one factor is <= sqrt(${bound}). Loop condition tightened from "${headerNode.text}" to "${loopVar} * ${loopVar} <= ${bound}".`,
        before: beforeComplexity,
        after: afterComplexity,
        rewritten,
        assumptions: [
            `assumes ${bound} is an integer >= 2`
        ]
    };
}

/**
 * Checks if nested loops form a chain of pure counting loops that multiply.
 * @param {any} rep
 * @param {any[]} rawLoops
 * @param {number[]} parentIndex
 * @param {any} beforeComplexity
 * @returns {any | null}
 */
function checkNestedPureCounting(rep, rawLoops, parentIndex, beforeComplexity) {
    const nodeMap = new Map();
    rep.nodes.forEach(n => nodeMap.set(n.id, n));
    const outgoing = new Map();
    const incoming = new Map();
    rep.nodes.forEach(n => {
        outgoing.set(n.id, []);
        incoming.set(n.id, []);
    });
    rep.edges.forEach(e => {
        if (nodeMap.has(e.from) && nodeMap.has(e.to)) {
            outgoing.get(e.from).push(e);
            incoming.get(e.to).push(e);
        }
    });

    for (let r = 0; r < rawLoops.length; r++) {
        if (parentIndex[r] !== -1) continue; // must be a root loop

        const chain = [rawLoops[r]];
        let currIdx = r;
        while (true) {
            const children = [];
            for (let c = 0; c < rawLoops.length; c++) {
                if (parentIndex[c] === currIdx) {
                    children.push(c);
                }
            }
            if (children.length === 1) {
                chain.push(rawLoops[children[0]]);
                currIdx = children[0];
            } else {
                break;
            }
        }

        if (chain.length < 2) continue;

        const loopVars = [];
        const bounds = [];
        let counterVar = null;
        let chainValid = true;

        for (let lIdx = 0; lIdx < chain.length; lIdx++) {
            const loop = chain[lIdx];
            const header = nodeMap.get(loop.headerId);
            if (!header || header.type !== 'dec') {
                chainValid = false;
                break;
            }

            const cond = parseComparison(header.text);
            if (!cond || cond.op !== '<=') {
                chainValid = false;
                break;
            }

            loopVars.push(cond.variable);
            bounds.push(cond.bound);

            const inEdges = (incoming.get(loop.headerId) || []).filter(e => !loop.bodyIds.includes(e.from));
            if (inEdges.length !== 1) {
                chainValid = false;
                break;
            }
            const init = findLiteralInit(inEdges[0].from, cond.variable, nodeMap, incoming);
            if (init !== 1) {
                chainValid = false;
                break;
            }

            if (lIdx === chain.length - 1) {
                const bodyNodes = loop.bodyIds.filter(id => id !== loop.headerId);
                const stmts = [];
                for (const bId of bodyNodes) {
                    const bNode = nodeMap.get(bId);
                    if (!bNode || bNode.type !== 'proc') { chainValid = false; break; }
                    stmts.push(...splitStatements(bNode.text));
                }
                if (!chainValid) break;

                let hasStep = false;
                let foundCounter = false;
                for (const s of stmts) {
                    if (getStepAmount(s, cond.variable) === 1) {
                        hasStep = true;
                    } else if (isAssignment(s)) {
                        const eqIdx = s.indexOf('=');
                        const tgt = s.slice(0, eqIdx).trim();
                        const rhs = s.slice(eqIdx + 1).trim();
                        if (rhs === `${tgt} + 1` || rhs === `1 + ${tgt}` || s === `${tgt} += 1` || s === `${tgt}++` || s === `++${tgt}`) {
                            counterVar = tgt;
                            foundCounter = true;
                        } else {
                            chainValid = false;
                            break;
                        }
                    } else {
                        chainValid = false;
                        break;
                    }
                }
                if (!hasStep || !foundCounter) {
                    chainValid = false;
                    break;
                }
            }
        }

        if (!chainValid || !counterVar) continue;
        if (loopVars.includes(counterVar)) continue;

        const rootLoop = chain[0];
        const rootOut = outgoing.get(rootLoop.headerId) || [];
        const rootExitEdge = rootOut.find(e => !rootLoop.bodyIds.includes(e.to));
        if (!rootExitEdge) continue;

        const product = bounds.join(' * ');
        const formula = `${counterVar} = ${counterVar} + ${product}`;
        const guard = `${bounds[0]} >= 1`;

        const rootBodyNodes = rootLoop.bodyIds.filter(id => id !== rootLoop.headerId);
        const rewritten = buildRewrittenClosedForm(rep, rootLoop, rootBodyNodes, rootExitEdge.to, guard, formula);
        const afterComplexity = analyzeComplexity(rewritten);

        if (isStrictlyBetter(beforeComplexity, afterComplexity)) {
            return {
                id: `opt-nested-counting-${rootLoop.headerId}`,
                title: 'Nested Pure Counting Closed Form',
                reason: `Nested pure counting loops at ${chain.map(l => l.headerId).join(', ')} (nesting depth ${chain.length}) collapsed to closed-form multiplication ${formula} guarded by ${guard}.`,
                before: beforeComplexity,
                after: afterComplexity,
                rewritten,
                assumptions: [
                    'assumes integer loop variables and bounds'
                ]
            };
        }
    }

    return null;
}

/**
 * Checks and iteratively optimizes nested loops (Pattern 4).
 * @param {any} rep
 * @param {any[]} rawLoops
 * @param {number[]} parentIndex
 * @param {any} beforeComplexity
 * @returns {any | null}
 */
function checkNestedLoops(rep, rawLoops, parentIndex, beforeComplexity) {
    const pureCountingOpt = checkNestedPureCounting(rep, rawLoops, parentIndex, beforeComplexity);
    if (pureCountingOpt) {
        return pureCountingOpt;
    }

    let currentRep = clone(rep);
    const stepsApplied = [];
    let iterationCount = 0;
    const maxIterations = 5;

    while (iterationCount < maxIterations) {
        iterationCount++;
        const currentLoops = detectLoops(currentRep);
        if (currentLoops.length < 2) break;

        // Recompute nesting
        const currentParents = new Array(currentLoops.length).fill(-1);
        for (let i = 0; i < currentLoops.length; i++) {
            let bestParent = -1;
            let bestParentSize = Infinity;
            const bSet = new Set(currentLoops[i].bodyIds);

            for (let j = 0; j < currentLoops.length; j++) {
                if (i === j) continue;
                const aSet = new Set(currentLoops[j].bodyIds);
                if (bSet.size < aSet.size) {
                    let isSubset = true;
                    for (const id of bSet) {
                        if (!aSet.has(id)) {
                            isSubset = false;
                            break;
                        }
                    }
                    if (isSubset && aSet.size < bestParentSize) {
                        bestParent = j;
                        bestParentSize = aSet.size;
                    }
                }
            }
            currentParents[i] = bestParent;
        }

        // Find innermost loop (a loop that is a child but not a parent of any other loop)
        const isParent = new Set(currentParents.filter(p => p !== -1));
        const innermostIndex = currentLoops.findIndex((l, idx) => currentParents[idx] !== -1 && !isParent.has(idx));
        if (innermostIndex === -1) break;

        const innerLoop = currentLoops[innermostIndex];
        const innerNodeMap = new Map();
        currentRep.nodes.forEach((n) => innerNodeMap.set(n.id, n));
        const innerOut = new Map();
        const innerIn = new Map();
        currentRep.nodes.forEach((n) => {
            innerOut.set(n.id, []);
            innerIn.set(n.id, []);
        });
        currentRep.edges.forEach((e) => {
            if (innerNodeMap.has(e.from) && innerNodeMap.has(e.to)) {
                innerOut.get(e.from).push(e);
                innerIn.get(e.to).push(e);
            }
        });

        // Test inner loop against single loop patterns (1, 2, 3)
        const innerComp = analyzeComplexity(currentRep);
        const innerOpt = checkSingleLoop(currentRep, innerLoop, innerNodeMap, innerOut, innerIn, innerComp);

        if (!innerOpt) break;

        stepsApplied.push(innerOpt.reason);
        currentRep = innerOpt.rewritten;
    }

    if (stepsApplied.length === 0) return null;

    // Also check if after eliminating inner loops, outer loop can now be reduced
    const outerComp = analyzeComplexity(currentRep);
    const remainingLoops = detectLoops(currentRep);
    if (remainingLoops.length === 1) {
        const outerNodeMap = new Map();
        currentRep.nodes.forEach((n) => outerNodeMap.set(n.id, n));
        const outerOut = new Map();
        const outerIn = new Map();
        currentRep.nodes.forEach((n) => {
            outerOut.set(n.id, []);
            outerIn.set(n.id, []);
        });
        currentRep.edges.forEach((e) => {
            if (outerNodeMap.has(e.from) && outerNodeMap.has(e.to)) {
                outerOut.get(e.from).push(e);
                outerIn.get(e.to).push(e);
            }
        });

        const outerOpt = checkSingleLoop(currentRep, remainingLoops[0], outerNodeMap, outerOut, outerIn, outerComp);
        if (outerOpt) {
            stepsApplied.push(outerOpt.reason);
            currentRep = outerOpt.rewritten;
        }
    }

    const finalComplexity = analyzeComplexity(currentRep);
    if (!isStrictlyBetter(beforeComplexity, finalComplexity)) {
        return null;
    }

    return {
        id: `opt-nested-closed-form-${rawLoops[0].headerId}`,
        title: 'Nested Loop Closed Form Elimination',
        reason: stepsApplied.join('; '),
        before: beforeComplexity,
        after: finalComplexity,
        rewritten: currentRep,
        assumptions: [
            'assumes integer loop variables and bounds',
            'assumes arithmetic does not overflow'
        ]
    };
}

/**
 * Replaces a loop with a guarded closed-form calculation node.
 * @param {any} rep
 * @param {{ headerId: string, bodyIds: string[] }} loop
 * @param {string[]} bodyNodeIds
 * @param {string} exitNodeId
 * @param {string} guardCondition
 * @param {string} formulaStatement
 * @returns {{ nodes: any[], edges: any[] }}
 */
function buildRewrittenClosedForm(rep, loop, bodyNodeIds, exitNodeId, guardCondition, formulaStatement) {
    const rewritten = clone(rep);
    const bodySet = new Set(bodyNodeIds);

    // Filter out old loop body nodes (keep header as guard dec node)
    const newNodes = rewritten.nodes.filter((n) => !bodySet.has(n.id));

    // Update header to guard dec node
    const headerNode = newNodes.find((n) => n.id === loop.headerId);
    if (headerNode) {
        headerNode.type = 'dec';
        headerNode.text = guardCondition;
    }

    // Add new proc node for closed form formula
    const newProcId = `${loop.headerId}_opt`;
    newNodes.push({
        id: newProcId,
        type: 'proc',
        text: formulaStatement
    });

    // Reconnect edges:
    // Remove edges touching deleted body nodes or outgoing from header
    const newEdges = rewritten.edges.filter(
        (e) => !bodySet.has(e.from) && !bodySet.has(e.to) && e.from !== loop.headerId
    );

    // Add guarded edges from header
    newEdges.push({
        from: loop.headerId,
        to: newProcId,
        label: 'Yes'
    });
    newEdges.push({
        from: loop.headerId,
        to: exitNodeId,
        label: 'No'
    });
    newEdges.push({
        from: newProcId,
        to: exitNodeId,
        label: null
    });

    return {
        nodes: newNodes,
        edges: newEdges
    };
}

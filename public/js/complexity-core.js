/**
 * Pure, deterministic static complexity analyzer for flowcharts.
 * Analyzes time and auxiliary space complexity based on loops, conditions, and variable updates.
 * No DOM, no network dependencies.
 */

/**
 * Checks whether a trimmed statement is an assignment.
 * Matches: <target> = <expression> (where = is not followed by =).
 * @param {string} stmt
 * @returns {boolean}
 */
export function isAssignment(stmt) {
    if (!stmt || typeof stmt !== 'string') return false;
    const trimmed = stmt.trim();
    const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_\.\[\]]*)\s*=(?!=)\s*(.+)$/);
    return Boolean(match);
}

/**
 * Splits text into statements, honoring semicolons first, and commas if all comma parts are assignments.
 * Faithful to the pseudocode generator statement splitting specification.
 * @param {string} text
 * @returns {string[]}
 */
export function splitStatements(text) {
    if (!text || typeof text !== 'string') return [];
    const semiParts = text.split(';').map(s => s.trim()).filter(Boolean);
    const result = [];

    for (const part of semiParts) {
        if (part.includes(',')) {
            const commaParts = part.split(',').map(s => s.trim()).filter(Boolean);
            if (commaParts.length > 1 && commaParts.every(isAssignment)) {
                result.push(...commaParts);
                continue;
            }
        }
        result.push(part);
    }

    return result;
}

/**
 * Strips question marks and trailing whitespace from a condition.
 * @param {string} text
 * @returns {string}
 */
export function cleanCondition(text) {
    if (!text || typeof text !== 'string') return '';
    return text.trim().replace(/\?+\s*$/, '').trim();
}

/**
 * Detects cycles and back edges in the flowchart starting from the start box.
 * @param {{ nodes: Array<{ id: string, type: string, text: string }>, edges: Array<{ from: string, to: string, label?: string|null }> }} representation
 * @returns {Array<{ headerId: string, bodyIds: string[], backEdge: { from: string, to: string } }>}
 */
export function detectLoops(representation) {
    if (!representation || !Array.isArray(representation.nodes) || !Array.isArray(representation.edges)) {
        return [];
    }

    const nodes = representation.nodes;
    const edges = representation.edges;
    const nodeMap = new Map();
    nodes.forEach(n => nodeMap.set(n.id, n));

    const outgoing = new Map();
    const incoming = new Map();
    nodes.forEach(n => {
        outgoing.set(n.id, []);
        incoming.set(n.id, []);
    });

    edges.forEach(e => {
        if (nodeMap.has(e.from) && nodeMap.has(e.to)) {
            outgoing.get(e.from).push(e);
            incoming.get(e.to).push(e);
        }
    });

    const startNode = nodes.find(n => n.type === 'start');
    if (!startNode) return [];

    // DFS with 3-color states to detect back-edges: 0 = unvisited, 1 = visiting (on stack), 2 = visited
    const state = new Map();
    nodes.forEach(n => state.set(n.id, 0));

    const backEdges = [];

    function dfs(u) {
        state.set(u, 1);
        const outList = outgoing.get(u) || [];
        for (const edge of outList) {
            const v = edge.to;
            const vState = state.get(v);
            if (vState === 1) {
                // v is currently in active recursion stack -> edge u -> v is a back edge!
                backEdges.push({ from: u, to: v });
            } else if (vState === 0) {
                dfs(v);
            }
        }
        state.set(u, 2);
    }

    dfs(startNode.id);

    const detected = [];

    for (const be of backEdges) {
        const u = be.from;
        const v = be.to;

        // Loop header is typically the decision node being returned to
        let headerId = v;
        const targetNode = nodeMap.get(v);

        // If target is not dec, check if there is a decision node on the cycle
        if (targetNode && targetNode.type !== 'dec') {
            // Find reachable nodes on cycle
            const cycleDec = nodes.find(n => n.type === 'dec');
            if (cycleDec) headerId = cycleDec.id;
        }

        // Backward traversal from u to headerId to collect all cycle body nodes
        const bodySet = new Set();
        bodySet.add(headerId);
        bodySet.add(u);

        const queue = [u];
        const visitedInBack = new Set([u]);

        while (queue.length > 0) {
            const curr = queue.shift();
            const inList = incoming.get(curr) || [];
            for (const edge of inList) {
                const pred = edge.from;
                if (pred === headerId) continue;
                if (!visitedInBack.has(pred) && nodeMap.has(pred)) {
                    visitedInBack.add(pred);
                    bodySet.add(pred);
                    queue.push(pred);
                }
            }
        }

        const bodyIds = Array.from(bodySet).sort();
        detected.push({
            headerId,
            bodyIds,
            backEdge: be
        });
    }

    // Deduplicate loops with identical headerId and bodyIds
    const unique = [];
    const seen = new Set();
    for (const loop of detected) {
        const key = `${loop.headerId}:${loop.bodyIds.join(',')}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(loop);
        }
    }

    return unique;
}

/**
 * Parses loop header condition and loop body updates to determine time pattern.
 * @param {{ headerId: string, bodyIds: string[] }} loop
 * @param {Map<string, any>} nodeMap
 * @param {any[]} allNodes
 * @returns {{ pattern: 'linear'|'logarithmic'|'constant'|'unknown', variable: string, bound: string, note: string }}
 */
function analyzeLoopPattern(loop, nodeMap, allNodes) {
    const headerNode = nodeMap.get(loop.headerId);
    if (!headerNode || headerNode.type !== 'dec') {
        return {
            pattern: 'unknown',
            variable: '',
            bound: '',
            note: `Loop at ${loop.headerId} header is not a decision node.`
        };
    }

    const rawCond = cleanCondition(headerNode.text);
    if (!rawCond) {
        return {
            pattern: 'unknown',
            variable: '',
            bound: '',
            note: `Decision node ${loop.headerId} has empty condition text.`
        };
    }

    // Check for function calls in condition
    if (/\b[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(rawCond)) {
        return {
            pattern: 'unknown',
            variable: '',
            bound: '',
            note: `Decision ${loop.headerId} condition "${rawCond}" uses function call.`
        };
    }

    // Parse comparison operator: <=, <, >=, >, !=, ==
    let condVar = '';
    let condBound = '';
    let isBoundLiteral = false;

    // Pattern 1: <var> <op> <expr>
    const compMatch1 = rawCond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(<=|<|>=|>|!=|==)\s*(.+)$/);
    // Pattern 2: <expr> <op> <var>
    const compMatch2 = !compMatch1 ? rawCond.match(/^(.+?)\s*(<=|<|>=|>|!=|==)\s*([a-zA-Z_][a-zA-Z0-9_]*)$/) : null;

    if (compMatch1) {
        condVar = compMatch1[1].trim();
        condBound = compMatch1[3].trim();
    } else if (compMatch2) {
        condVar = compMatch2[3].trim();
        condBound = compMatch2[1].trim();
    } else {
        return {
            pattern: 'unknown',
            variable: '',
            bound: '',
            note: `Decision ${loop.headerId} condition "${rawCond}" is not a recognized comparison.`
        };
    }

    if (/^-?\d+(?:\.\d+)?$/.test(condBound)) {
        isBoundLiteral = true;
    }

    // Inspect body nodes for updates to condVar
    const bodyNodes = loop.bodyIds
        .filter(id => id !== loop.headerId)
        .map(id => nodeMap.get(id))
        .filter(Boolean);

    let foundUpdate = false;
    let isLinearStep = false;
    let isLogStep = false;
    let logFactor = 2;
    let stepAmount = 1;
    let unparsableInBody = false;
    let unparsableReason = '';

    for (const bNode of bodyNodes) {
        const statements = splitStatements(bNode.text);
        for (const stmt of statements) {
            const s = stmt.trim();

            // Check if statement updates condVar
            // Forms:
            // 1. i = i + c, i = c + i, i += c, i++, ++i
            // 2. i = i - c, i -= c, i--, --i
            // 3. i = i * c, i = c * i, i *= c
            // 4. i = i / c, i = Math.floor(i / c), i /= c, i = i // c, i = parseInt(i / c)

            // Increment / Decrement shortcuts
            const incPattern = new RegExp(`^(?:${condVar}\\s*\\+\\+|\\+\\+\\s*${condVar}|${condVar}\\s*\\+=\\s*(\\d+(?:\\.\\d+)?)|${condVar}\\s*=\\s*${condVar}\\s*\\+\\s*(\\d+(?:\\.\\d+)?)|${condVar}\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*\\+\\s*${condVar})$`);
            const decPattern = new RegExp(`^(?:${condVar}\\s*--|--\\s*${condVar}|${condVar}\\s*-=\\s*(\\d+(?:\\.\\d+)?)|${condVar}\\s*=\\s*${condVar}\\s*-\\s*(\\d+(?:\\.\\d+)?))$`);

            // Multiplication shortcuts
            const mulPattern = new RegExp(`^(?:${condVar}\\s*\\*=\\s*(\\d+(?:\\.\\d+)?)|${condVar}\\s*=\\s*${condVar}\\s*\\*\\s*(\\d+(?:\\.\\d+)?)|${condVar}\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*\\*\\s*${condVar})$`);

            // Division shortcuts
            const divPattern = new RegExp(`^(?:${condVar}\\s*\\/=\\s*(\\d+(?:\\.\\d+)?)|${condVar}\\s*=\\s*(?:Math\\.floor|parseInt)?\\s*\\(?\\s*${condVar}\\s*(?:\\/|\\/\\/)\\s*(\\d+(?:\\.\\d+)?)\\s*\\)?)$`);

            const incMatch = s.match(incPattern);
            const decMatch = s.match(decPattern);
            const mulMatch = s.match(mulPattern);
            const divMatch = s.match(divPattern);

            if (incMatch || decMatch) {
                foundUpdate = true;
                isLinearStep = true;
                const amt = Number((incMatch && (incMatch[1] || incMatch[2] || incMatch[3])) || (decMatch && (decMatch[1] || decMatch[2])) || 1);
                stepAmount = amt > 0 ? amt : 1;
            } else if (mulMatch || divMatch) {
                foundUpdate = true;
                isLogStep = true;
                const factor = Number((mulMatch && (mulMatch[1] || mulMatch[2] || mulMatch[3])) || (divMatch && (divMatch[1] || divMatch[2])) || 2);
                logFactor = factor > 1 ? factor : 2;
            } else if (s.startsWith(`${condVar} =`) || s.startsWith(`${condVar}=`)) {
                // An assignment to condVar that did not match known linear or log patterns
                foundUpdate = true;
                unparsableInBody = true;
                unparsableReason = `Loop at ${loop.headerId} has unrecognized update formula for "${condVar}" in ${bNode.id}: "${s}".`;
            }
        }
    }

    if (!foundUpdate) {
        return {
            pattern: 'unknown',
            variable: condVar,
            bound: condBound,
            note: `Loop at ${loop.headerId} has no update of variable "${condVar}" in body boxes [${loop.bodyIds.join(', ')}].`
        };
    }

    if (unparsableInBody) {
        return {
            pattern: 'unknown',
            variable: condVar,
            bound: condBound,
            note: unparsableReason || `Unrecognized update to "${condVar}" in loop at ${loop.headerId}.`
        };
    }

    // Determine bound naming
    let boundDescription = '';
    if (isBoundLiteral) {
        boundDescription = condBound;
    } else {
        // Check if condBound was read at an input (io) node
        const inputNode = allNodes.find(n => n.type === 'io' && (new RegExp(`\\b${condBound}\\b`, 'i')).test(n.text));
        if (inputNode) {
            boundDescription = `${condBound}, the value read at ${inputNode.id}`;
        } else {
            boundDescription = `in terms of ${condBound}`;
        }
    }

    if (isLogStep) {
        return {
            pattern: 'logarithmic',
            variable: condVar,
            bound: boundDescription,
            note: `Variable "${condVar}" scaled by ${logFactor} against bound ${boundDescription} at ${loop.headerId}.`
        };
    }

    if (isLinearStep) {
        if (isBoundLiteral) {
            return {
                pattern: 'constant',
                variable: condVar,
                bound: boundDescription,
                note: `Counter "${condVar}" with constant step ${stepAmount} against numeric literal bound ${boundDescription} at ${loop.headerId}.`
            };
        }
        return {
            pattern: 'linear',
            variable: condVar,
            bound: boundDescription,
            note: `Counter "${condVar}" with constant step ${stepAmount} against ${boundDescription} at ${loop.headerId}.`
        };
    }

    return {
        pattern: 'unknown',
        variable: condVar,
        bound: boundDescription,
        note: `Could not determine iteration pattern for "${condVar}" in loop at ${loop.headerId}.`
    };
}

/**
 * Analyzes computational complexity of a flowchart representation.
 * Pure and deterministic; never throws.
 * @param {{ nodes?: any[], edges?: any[] }} representation
 * @returns {{
 *   time: { label: string, status: 'estimated'|'unknown', reasons: string[] },
 *   space: { label: string, status: 'estimated'|'unknown', reasons: string[] },
 *   loops: Array<{ headerId: string, bodyIds: string[], pattern: string, variable: string, bound: string, note: string }>
 * }}
 */
export function analyzeComplexity(representation) {
    try {
        if (!representation || !Array.isArray(representation.nodes) || representation.nodes.length === 0) {
            return {
                time: { label: "Couldn't determine", status: "unknown", reasons: ["Flowchart contains no nodes"] },
                space: { label: "Couldn't determine", status: "unknown", reasons: ["Flowchart contains no nodes"] },
                loops: []
            };
        }

        const nodes = representation.nodes;
        const nodeMap = new Map();
        nodes.forEach(n => nodeMap.set(n.id, n));

        const startNode = nodes.find(n => n.type === 'start');
        if (!startNode) {
            return {
                time: { label: "Couldn't determine", status: "unknown", reasons: ["No start node found in diagram"] },
                space: { label: "Couldn't determine", status: "unknown", reasons: ["No start node found in diagram"] },
                loops: []
            };
        }

        // 1. Detect loops
        const rawLoops = detectLoops(representation);
        const loopDetails = [];

        for (const loop of rawLoops) {
            const pat = analyzeLoopPattern(loop, nodeMap, nodes);
            loopDetails.push({
                headerId: loop.headerId,
                bodyIds: loop.bodyIds,
                pattern: pat.pattern,
                variable: pat.variable,
                bound: pat.bound,
                note: pat.note
            });
        }

        // 2. Combine loop time complexity
        let timeResult;
        if (loopDetails.length === 0) {
            timeResult = {
                label: "O(1)",
                status: "estimated",
                reasons: ["Diagram contains no loops (straight-line control flow)."]
            };
        } else {
            const hasUnknown = loopDetails.some(l => l.pattern === 'unknown');
            if (hasUnknown) {
                const unknownReasons = loopDetails
                    .filter(l => l.pattern === 'unknown')
                    .map(l => l.note);
                timeResult = {
                    label: "Couldn't determine",
                    status: "unknown",
                    reasons: unknownReasons.length > 0 ? unknownReasons : ["Contains unanalyzable loop pattern."]
                };
            } else {
                // Determine loop hierarchy (nesting vs sequential)
                // A loop B is nested inside A if B.bodyIds is a strict subset of A.bodyIds
                const parentIndex = new Array(loopDetails.length).fill(-1);

                for (let i = 0; i < loopDetails.length; i++) {
                    let bestParent = -1;
                    let bestParentSize = Infinity;
                    const bSet = new Set(loopDetails[i].bodyIds);

                    for (let j = 0; j < loopDetails.length; j++) {
                        if (i === j) continue;
                        const aSet = new Set(loopDetails[j].bodyIds);
                        // Check if b is strict subset of a
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

                // Compute product of each tree branch
                // Rank order: constant=0, log=1, linear=2
                // We combine factors: linear * linear = O(n^2), linear * log = O(n log n)
                function getTreeFactor(index) {
                    const currentPat = loopDetails[index].pattern;
                    let currentLinear = currentPat === 'linear' ? 1 : 0;
                    let currentLog = currentPat === 'logarithmic' ? 1 : 0;

                    // Find children
                    for (let c = 0; c < loopDetails.length; c++) {
                        if (parentIndex[c] === index) {
                            const childFactor = getTreeFactor(c);
                            currentLinear += childFactor.linear;
                            currentLog += childFactor.log;
                        }
                    }
                    return { linear: currentLinear, log: currentLog };
                }

                let maxLinear = 0;
                let maxLog = 0;
                const loopNotes = [];

                for (let i = 0; i < loopDetails.length; i++) {
                    if (parentIndex[i] === -1) {
                        const factor = getTreeFactor(i);
                        if (factor.linear > maxLinear || (factor.linear === maxLinear && factor.log > maxLog)) {
                            maxLinear = factor.linear;
                            maxLog = factor.log;
                        }
                    }
                    loopNotes.push(loopDetails[i].note);
                }

                // Format label
                let label = "O(1)";
                if (maxLinear === 0 && maxLog === 0) {
                    label = "O(1)";
                } else if (maxLinear === 0 && maxLog === 1) {
                    label = "O(log n)";
                } else if (maxLinear === 1 && maxLog === 0) {
                    label = "O(n)";
                } else if (maxLinear === 1 && maxLog === 1) {
                    label = "O(n log n)";
                } else if (maxLinear === 2 && maxLog === 0) {
                    label = "O(n^2)";
                } else if (maxLinear === 3 && maxLog === 0) {
                    label = "O(n^3)";
                } else {
                    label = `O(n^${maxLinear})`;
                }

                let reason = "";
                if (loopDetails.length === 1) {
                    reason = loopDetails[0].note;
                } else if (parentIndex.some(p => p !== -1)) {
                    reason = `Nested loops at ${loopDetails.map(l => l.headerId).join(' and ')}; combined complexity is ${label}.`;
                } else {
                    reason = `Sequential loops at ${loopDetails.map(l => l.headerId).join(' and ')}; dominant complexity is ${label}.`;
                }

                timeResult = {
                    label,
                    status: "estimated",
                    reasons: [reason]
                };
            }
        }

        // 3. Space Complexity Analysis
        // Convention: Auxiliary space only (excludes inputs).
        const assignedVars = new Set();
        let hasDynamicOrIndexed = false;
        let indexedReason = '';

        for (const node of nodes) {
            const text = node.text || '';
            // Check for array/list/stack/queue keywords
            if (/\b(?:array|list|stack|queue|vector)\b/i.test(text)) {
                hasDynamicOrIndexed = true;
                indexedReason = `Collection keyword found in ${node.id}: "${text}".`;
            }

            // Check for indexed writes like arr[i] = ...
            if (/[a-zA-Z_][a-zA-Z0-9_]*\s*\[.+?\]\s*=(?!=)/.test(text)) {
                hasDynamicOrIndexed = true;
                indexedReason = `Indexed write found in ${node.id}: "${text}".`;
            }

            // Collect scalar assignments
            const stmts = splitStatements(text);
            for (const stmt of stmts) {
                const match = stmt.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=(?!=)/);
                if (match) {
                    assignedVars.add(match[1]);
                }
            }
        }

        let spaceResult;
        if (hasDynamicOrIndexed) {
            spaceResult = {
                label: "O(n)",
                status: "estimated",
                reasons: [
                    "Auxiliary space only: dynamic collection or indexed write detected; estimated as O(n) (exact size could not be verified)."
                ]
            };
        } else {
            const varList = Array.from(assignedVars).sort();
            const varDesc = varList.length > 0 ? `scalar variables (${varList.join(', ')})` : 'fixed scalar registers';
            spaceResult = {
                label: "O(1)",
                status: "estimated",
                reasons: [
                    `Auxiliary space only: uses only ${varDesc}.`
                ]
            };
        }

        return {
            time: timeResult,
            space: spaceResult,
            loops: loopDetails
        };
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        return {
            time: { label: "Couldn't determine", status: "unknown", reasons: [`Analysis error: ${msg}`] },
            space: { label: "Couldn't determine", status: "unknown", reasons: [`Analysis error: ${msg}`] },
            loops: []
        };
    }
}

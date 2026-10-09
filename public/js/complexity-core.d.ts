/**
 * Type declarations for complexity-core.js
 */

export interface ComplexityResultItem {
    label: string;
    status: 'estimated' | 'unknown';
    reasons: string[];
}

export interface DetectedLoopItem {
    headerId: string;
    bodyIds: string[];
    pattern: 'linear' | 'logarithmic' | 'constant' | 'unknown' | string;
    variable: string;
    bound: string;
    note: string;
}

export interface ComplexityAnalysis {
    time: ComplexityResultItem;
    space: ComplexityResultItem;
    loops: DetectedLoopItem[];
}

export function isAssignment(stmt: string): boolean;
export function splitStatements(text: string): string[];
export function cleanCondition(text: string): string;

export function detectLoops(representation: {
    nodes?: Array<{ id: string; type: string; text?: string }>;
    edges?: Array<{ from: string; to: string; label?: string | null }>;
}): Array<{
    headerId: string;
    bodyIds: string[];
    backEdge: { from: string; to: string };
}>;

export function analyzeComplexity(representation: {
    nodes?: Array<{ id: string; type: string; text?: string }>;
    edges?: Array<{ from: string; to: string; label?: string | null }>;
}): ComplexityAnalysis;

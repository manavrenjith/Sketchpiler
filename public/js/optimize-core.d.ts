/**
 * Type declarations for flowchart static pattern optimization.
 */

export interface ComplexityEstimate {
    label: string;
    status: 'estimated' | 'unknown';
    reasons: string[];
}

export interface ComplexityResult {
    time: ComplexityEstimate;
    space: ComplexityEstimate;
    loops?: any[];
}

export interface OptimizationSuggestion {
    id: string;
    title: string;
    reason: string;
    before: ComplexityResult;
    after: ComplexityResult;
    rewritten: {
        nodes: Array<{ id: string; type: string; text: string; [key: string]: any }>;
        edges: Array<{ from: string; to: string; label?: string | null; [key: string]: any }>;
    };
    assumptions: string[];
}

export interface OptimizationResult {
    found: boolean;
    suggestions: OptimizationSuggestion[];
}

export function findOptimizations(representation: {
    nodes: Array<{ id: string; type: string; text: string; [key: string]: any }>;
    edges: Array<{ from: string; to: string; label?: string | null; [key: string]: any }>;
}): OptimizationResult;

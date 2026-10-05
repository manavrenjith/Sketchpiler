// Orchestrates the flowchart extraction pipeline from raw image intake to parsed IR.
import { processImageIntake } from './image.js';
import { EXTRACTION_PROMPT } from './prompt.js';
import { parseDsl } from './parser.js';
import { validateRepresentation } from './validator.js';
import { buildMermaid } from './mermaid.js';
import { FlowchartRepresentation } from './types.js';
import { ProviderAdapter, UsageMetadata } from './providers/types.js';

export interface ExtractOptions {
  imageBuffer: Buffer;
  provider: ProviderAdapter;
}

export interface ExtractResponse {
  representation: FlowchartRepresentation;
  mermaid: string;
  warnings: string[];
  truncated: boolean;
  confidence: number;
  provider: string;
  finishReason?: string;
  usageMetadata?: UsageMetadata;
}

export async function extractFlowchart(options: ExtractOptions): Promise<ExtractResponse> {
  // 1. Image intake
  const processed = await processImageIntake(options.imageBuffer);

  // 2. Call provider adapter
  const { text, stopReason, finishReason, usageMetadata } = await options.provider.extract({
    image: processed,
    prompt: EXTRACTION_PROMPT,
  });

  // 3. Parse DSL
  const parseResult = parseDsl(text);
  const isTruncated = parseResult.truncated || stopReason === 'length';

  // 4. Validate representation
  const validationResult = validateRepresentation(parseResult.representation, parseResult.warnings);

  // 5. Build Mermaid string
  const mermaid = buildMermaid(parseResult.representation);

  return {
    representation: parseResult.representation,
    mermaid,
    warnings: validationResult.warnings,
    truncated: isTruncated,
    confidence: validationResult.confidence,
    provider: options.provider.name,
    finishReason,
    usageMetadata,
  };
}

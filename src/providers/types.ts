// Interfaces and types for multimodal vision provider adapters.
export type StopReason = 'stop' | 'length' | 'other';

export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

export interface ProviderInput {
  image: {
    mimeType: string;
    data: Buffer;
  };
  prompt: string;
}

export interface ProviderOutput {
  text: string;
  stopReason: StopReason;
  finishReason?: string;
  usageMetadata?: UsageMetadata;
}

export interface ProviderAdapter {
  readonly name: string;
  extract(input: ProviderInput): Promise<ProviderOutput>;
}

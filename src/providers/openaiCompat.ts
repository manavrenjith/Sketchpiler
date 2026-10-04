// AI provider adapter for OpenAI-compatible multimodal vision endpoints.
import { AppError } from '../errors.js';
import { ProviderAdapter, ProviderInput, ProviderOutput, StopReason } from './types.js';

export interface OpenAICompatProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  rateLimitDelayMs?: number;
  serverErrorDelayMs?: number;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

export class OpenAICompatProvider implements ProviderAdapter {
  public readonly name = 'openai_compat';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly rateLimitDelayMs: number;
  private readonly serverErrorDelayMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options: OpenAICompatProviderOptions) {
    if (!options.baseUrl || !options.baseUrl.trim()) {
      throw new Error('Missing required OpenAI-compatible base URL');
    }
    if (!options.apiKey || !options.apiKey.trim()) {
      throw new Error('Missing required OpenAI-compatible API key');
    }
    if (!options.model || !options.model.trim()) {
      throw new Error('Missing required OpenAI-compatible model');
    }

    this.baseUrl = options.baseUrl.trim();
    this.apiKey = options.apiKey.trim();
    this.model = options.model.trim();
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.rateLimitDelayMs = options.rateLimitDelayMs ?? 60_000;
    this.serverErrorDelayMs = options.serverErrorDelayMs ?? 5_000;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.sleepFn = options.sleepFn || ((ms: number) => new Promise(res => setTimeout(res, ms)));
  }

  async extract(input: ProviderInput): Promise<ProviderOutput> {
    const cleanBase = this.baseUrl.replace(/\/+$/, '');
    const url = cleanBase.endsWith('/chat/completions')
      ? cleanBase
      : `${cleanBase}/chat/completions`;

    const dataUrl = `data:${input.image.mimeType};base64,${input.image.data.toString('base64')}`;
    const body = {
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: input.prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
              },
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 2000,
    };

    const maxRetries = 1;
    let attempt = 0;

    while (attempt <= maxRetries) {
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err: any) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
          throw new AppError('provider_error', `Provider request timed out after ${Math.round(this.timeoutMs / 1000)} seconds`);
        }
        throw new AppError('provider_error', `Network error contacting provider: ${err?.message || err}`);
      }

      if (response.ok) {
        let json: any;
        try {
          json = await response.json();
        } catch {
          throw new AppError('provider_error', 'Failed to parse JSON response from provider');
        }

        const choice = json?.choices?.[0];
        const finishReasonRaw = choice?.finish_reason || 'stop';
        const textPart = choice?.message?.content || '';

        let stopReason: StopReason = 'stop';
        if (finishReasonRaw === 'length') {
          stopReason = 'length';
        } else if (finishReasonRaw !== 'stop') {
          stopReason = 'other';
        }

        const rawUsage = json?.usage;
        const usageMetadata = rawUsage
          ? {
              promptTokenCount: typeof rawUsage.prompt_tokens === 'number'
                ? rawUsage.prompt_tokens
                : (typeof rawUsage.promptTokenCount === 'number' ? rawUsage.promptTokenCount : undefined),
              candidatesTokenCount: typeof rawUsage.completion_tokens === 'number'
                ? rawUsage.completion_tokens
                : (typeof rawUsage.candidatesTokenCount === 'number'
                  ? rawUsage.candidatesTokenCount
                  : (typeof rawUsage.output_tokens === 'number' ? rawUsage.output_tokens : undefined)),
              thoughtsTokenCount: typeof rawUsage.completion_tokens_details?.reasoning_tokens === 'number'
                ? rawUsage.completion_tokens_details.reasoning_tokens
                : (typeof rawUsage.output_tokens_details?.reasoning_tokens === 'number'
                  ? rawUsage.output_tokens_details.reasoning_tokens
                  : (typeof rawUsage.reasoning_tokens === 'number'
                    ? rawUsage.reasoning_tokens
                    : (typeof rawUsage.thoughtsTokenCount === 'number' ? rawUsage.thoughtsTokenCount : undefined))),
              totalTokenCount: typeof rawUsage.total_tokens === 'number'
                ? rawUsage.total_tokens
                : (typeof rawUsage.totalTokenCount === 'number' ? rawUsage.totalTokenCount : undefined),
            }
          : undefined;

        return {
          text: textPart,
          stopReason,
          finishReason: finishReasonRaw,
          usageMetadata,
        };
      }

      // Handle 429 rate limit: wait 60s and retry once, honouring retry-after if present
      if (response.status === 429) {
        if (attempt >= maxRetries) {
          throw new AppError('provider_rate_limited', 'Provider rate limit exceeded (HTTP 429)');
        }

        const retryAfterHeader = response.headers.get('retry-after');
        let delayMs = this.rateLimitDelayMs;

        if (retryAfterHeader) {
          const parsedSeconds = parseFloat(retryAfterHeader);
          if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
            delayMs = Math.round(parsedSeconds * 1000);
          } else {
            const parsedDate = Date.parse(retryAfterHeader);
            if (!isNaN(parsedDate)) {
              delayMs = Math.max(100, parsedDate - Date.now());
            }
          }
        }

        await this.sleepFn(delayMs);
        attempt++;
        continue;
      }

      // Handle 500, 502, 503, 504: retry once after 5s (honouring retry-after if present)
      const retryable5xx = [500, 502, 503, 504];
      if (retryable5xx.includes(response.status)) {
        if (attempt >= maxRetries) {
          throw new AppError('provider_error', `Provider is temporarily unavailable (HTTP ${response.status})`);
        }

        const retryAfterHeader = response.headers.get('retry-after');
        let delayMs = this.serverErrorDelayMs;

        if (retryAfterHeader) {
          const parsedSeconds = parseFloat(retryAfterHeader);
          if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
            delayMs = Math.round(parsedSeconds * 1000);
          } else {
            const parsedDate = Date.parse(retryAfterHeader);
            if (!isNaN(parsedDate)) {
              delayMs = Math.max(100, parsedDate - Date.now());
            }
          }
        }

        await this.sleepFn(delayMs);
        attempt++;
        continue;
      }

      // Never retry 400, 401, 403, 404 or other non-retryable status
      let errorDetail = '';
      try {
        const errJson: any = await response.json();
        errorDetail = errJson?.error?.message || response.statusText;
      } catch {
        errorDetail = response.statusText;
      }

      throw new AppError('provider_error', `Provider returned HTTP ${response.status}: ${errorDetail}`);
    }

    throw new AppError('provider_error', 'Provider request failed');
  }
}

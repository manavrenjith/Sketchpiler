// AI provider adapter for Google Gemini multimodal vision extraction.
import { AppError } from '../errors.js';
import { ProviderAdapter, ProviderInput, ProviderOutput, StopReason } from './types.js';

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  baseBackoffMs?: number;
}

export class GeminiProvider implements ProviderAdapter {
  public readonly name = 'gemini';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly baseBackoffMs: number;

  constructor(options: GeminiProviderOptions) {
    if (!options.apiKey || !options.apiKey.trim()) {
      throw new Error('Missing required Gemini API key');
    }
    if (!options.model || !options.model.trim()) {
      throw new Error('Missing required Gemini model');
    }
    this.apiKey = options.apiKey.trim();
    this.model = options.model.trim();
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.sleepFn = options.sleepFn || ((ms: number) => new Promise(res => setTimeout(res, ms)));
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
  }

  async extract(input: ProviderInput): Promise<ProviderOutput> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: input.prompt },
            {
              inlineData: {
                mimeType: input.image.mimeType,
                data: input.image.data.toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2000,
        thinkingConfig: {
          thinkingLevel: 'low',
        },
      },
    };

    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(body),
        });
      } catch (err: any) {
        throw new AppError('provider_error', `Network error contacting provider: ${err?.message || err}`);
      }

      if (response.ok) {
        let json: any;
        try {
          json = await response.json();
        } catch (err: any) {
          throw new AppError('provider_error', 'Failed to parse JSON response from provider');
        }

        const candidate = json?.candidates?.[0];
        const finishReasonRaw = candidate?.finishReason || 'STOP';
        const textPart = candidate?.content?.parts?.[0]?.text || '';

        let stopReason: StopReason = 'stop';
        if (finishReasonRaw === 'MAX_TOKENS') {
          stopReason = 'length';
        } else if (finishReasonRaw !== 'STOP') {
          stopReason = 'other';
        }

        const rawUsage = json?.usageMetadata;
        const usageMetadata = rawUsage
          ? {
              promptTokenCount: rawUsage.promptTokenCount ?? rawUsage.prompt_token_count,
              candidatesTokenCount: rawUsage.candidatesTokenCount ?? rawUsage.candidates_token_count,
              thoughtsTokenCount: rawUsage.thoughtsTokenCount ?? rawUsage.thoughts_token_count,
              totalTokenCount: rawUsage.totalTokenCount ?? rawUsage.total_token_count,
            }
          : undefined;

        return {
          text: textPart,
          stopReason,
          finishReason: finishReasonRaw,
          usageMetadata,
        };
      }

      // Handle retryable status codes: 429 and 500, 502, 503, 504
      const retryable5xx = [500, 502, 503, 504];
      if (response.status === 429 || retryable5xx.includes(response.status)) {
        if (attempt >= maxRetries) {
          if (response.status === 429) {
            throw new AppError('provider_rate_limited', 'Provider rate limit exceeded after 3 retries');
          } else {
            throw new AppError('provider_error', 'Provider is temporarily unavailable');
          }
        }

        // Calculate backoff
        const retryAfterHeader = response.headers.get('retry-after');
        let delayMs = this.baseBackoffMs * Math.pow(2, attempt);

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

      // Non-retryable 4xx (400, 401, 403, 404, etc.) or other errors: Never retry
      let errorDetail = '';
      try {
        const errJson: any = await response.json();
        errorDetail = errJson?.error?.message || response.statusText;
      } catch {
        errorDetail = response.statusText;
      }

      throw new AppError('provider_error', `Provider returned HTTP ${response.status}: ${errorDetail}`);
    }

    throw new AppError('provider_error', 'Provider is temporarily unavailable');
  }
}

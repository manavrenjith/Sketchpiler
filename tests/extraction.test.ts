// Integration tests for image intake, AI provider adapters, retries, and API routes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';
import sharp from 'sharp';

import { EXTRACTION_PROMPT } from '../src/prompt.js';
import { processImageIntake, detectImageFormat } from '../src/image.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import { OpenAICompatProvider } from '../src/providers/openaiCompat.js';
import { ProviderAdapter, ProviderInput, ProviderOutput } from '../src/providers/types.js';
import { extractFlowchart } from '../src/pipeline.js';
import { createApp } from '../src/app.js';
import { AppError } from '../src/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

describe('Milestone M2: Extraction Prompt Parity', () => {
  it('EXTRACTION_PROMPT in src/prompt.ts matches verbatim code block in docs/extraction-prompt.md', () => {
    const promptDocPath = path.join(projectRoot, 'docs', 'extraction-prompt.md');
    const docContent = fs.readFileSync(promptDocPath, 'utf8');

    // Extract the code block under "## Prompt text (copy verbatim)"
    const match = docContent.match(/## Prompt text \(copy verbatim\)\s*\r?\n\r?\n```(?:\w+)?\r?\n([\s\S]*?)\r?\n```/);
    assert.ok(match, 'Code block not found in docs/extraction-prompt.md');

    const expectedPrompt = match[1].replace(/\r\n/g, '\n').trim();
    const actualPrompt = EXTRACTION_PROMPT.replace(/\r\n/g, '\n').trim();

    assert.strictEqual(actualPrompt, expectedPrompt, 'src/prompt.ts differs from docs/extraction-prompt.md');
  });
});

describe('Milestone M2: Image Intake (FR-1)', () => {
  it('detects valid JPEG, PNG, WebP and rejects non-image from magic bytes', async () => {
    const jpegBuf = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg().toBuffer();
    const pngBuf = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 255, b: 0 } } }).png().toBuffer();
    const webpBuf = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 0, b: 255 } } }).webp().toBuffer();
    const textBuf = Buffer.from('This is definitely plain text, not an image format.');

    assert.strictEqual(detectImageFormat(jpegBuf), 'jpeg');
    assert.strictEqual(detectImageFormat(pngBuf), 'png');
    assert.strictEqual(detectImageFormat(webpBuf), 'webp');
    assert.strictEqual(detectImageFormat(textBuf), null);

    // processImageIntake downscales and outputs JPEG
    const processedJpeg = await processImageIntake(jpegBuf);
    assert.strictEqual(processedJpeg.mimeType, 'image/jpeg');
    assert.strictEqual(detectImageFormat(processedJpeg.data), 'jpeg');

    const processedPng = await processImageIntake(pngBuf);
    assert.strictEqual(processedPng.mimeType, 'image/jpeg');
    assert.strictEqual(detectImageFormat(processedPng.data), 'jpeg');

    const processedWebp = await processImageIntake(webpBuf);
    assert.strictEqual(processedWebp.mimeType, 'image/jpeg');
    assert.strictEqual(detectImageFormat(processedWebp.data), 'jpeg');

    // Reject non-image
    await assert.rejects(
      async () => processImageIntake(textBuf),
      (err: any) => err instanceof AppError && err.code === 'invalid_image'
    );
  });

  it('rejects images exceeding 10 MB limit with too_large', async () => {
    const hugeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024);
    await assert.rejects(
      async () => processImageIntake(hugeBuffer),
      (err: any) => err instanceof AppError && err.code === 'too_large'
    );
  });

  it('downscales images exceeding 1600px on the long side', async () => {
    const largeImg = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: { r: 100, g: 100, b: 100 } }
    }).jpeg().toBuffer();

    const processed = await processImageIntake(largeImg);
    const meta = await sharp(processed.data).metadata();
    assert.ok(meta.width! <= 1600);
    assert.ok(meta.height! <= 1600);
  });
});

describe('Milestone M2: Gemini Provider Adapter & Retries (FR-7)', () => {
  it('sends apiKey in x-goog-api-key header, not in URL, and never logs the key', async () => {
    const secretKey = 'my-super-secret-key-12345';
    let requestUrl = '';
    let requestHeaders: Record<string, string> = {};

    const logged: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    const origWarn = console.warn;
    console.log = (...args: any[]) => logged.push(args.map(String).join(' '));
    console.error = (...args: any[]) => logged.push(args.map(String).join(' '));
    console.warn = (...args: any[]) => logged.push(args.map(String).join(' '));

    try {
      const mockFetch: typeof fetch = async (url, init) => {
        requestUrl = url.toString();
        requestHeaders = (init?.headers || {}) as Record<string, string>;
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: 'flowchart\nN1 start "Start"\nN2 end "End"\nE N1 N2' }] },
                finishReason: 'STOP',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const provider = new GeminiProvider({
        apiKey: secretKey,
        model: 'gemini-3.8-flash',
        fetchFn: mockFetch,
      });

      await provider.extract({
        image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
        prompt: 'test prompt',
      });

      assert.strictEqual(requestHeaders['x-goog-api-key'], secretKey);
      assert.strictEqual(requestUrl.includes(secretKey), false, 'URL must not contain the API key');
      for (const logLine of logged) {
        assert.strictEqual(logLine.includes(secretKey), false, 'Logs must not contain the API key');
      }
    } finally {
      console.log = origLog;
      console.error = origErr;
      console.warn = origWarn;
    }
  });

  it('sends maxOutputTokens 2000 and thinkingConfig thinkingLevel low in request body and captures usageMetadata', async () => {
    let capturedBody: any;
    const mockFetch: typeof fetch = async (url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: 'flowchart\nN1 start "Start"\nN2 end "End"\nE N1 N2' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 150,
            candidatesTokenCount: 450,
            thoughtsTokenCount: 120,
            totalTokenCount: 720,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.8-flash',
      fetchFn: mockFetch,
    });

    const result = await provider.extract({
      image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
      prompt: 'test prompt',
    });

    assert.ok(capturedBody);
    assert.strictEqual(capturedBody.generationConfig?.maxOutputTokens, 2000);
    assert.strictEqual(capturedBody.generationConfig?.thinkingConfig?.thinkingLevel, 'low');
    assert.strictEqual(result.finishReason, 'STOP');
    assert.strictEqual(result.stopReason, 'stop');
    assert.deepStrictEqual(result.usageMetadata, {
      promptTokenCount: 150,
      candidatesTokenCount: 450,
      thoughtsTokenCount: 120,
      totalTokenCount: 720,
    });
  });

  it('maps MAX_TOKENS finishReason to stopReason length', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: 'flowchart\nN1 start "Start"\nN2 proc "Partial' }] },
              finishReason: 'MAX_TOKENS',
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 2000,
            thoughtsTokenCount: 1800,
            totalTokenCount: 2100,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.8-flash',
      fetchFn: mockFetch,
    });

    const result = await provider.extract({
      image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
      prompt: 'test prompt',
    });

    assert.strictEqual(result.stopReason, 'length');
    assert.strictEqual(result.finishReason, 'MAX_TOKENS');
    assert.strictEqual(result.usageMetadata?.candidatesTokenCount, 2000);
    assert.strictEqual(result.usageMetadata?.thoughtsTokenCount, 1800);
  });

  it('retries on HTTP 429 then succeeds on next attempt', async () => {
    let attempts = 0;
    const mockSleep = async (ms: number) => {
      // no-op for fast test
    };

    const mockFetch: typeof fetch = async () => {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: 'Resource exhausted' } }), {
          status: 429,
          headers: { 'retry-after': '0.1' },
        });
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: 'flowchart\nN1 start "Start"' }] },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-1.5-flash',
      fetchFn: mockFetch,
      sleepFn: mockSleep,
      baseBackoffMs: 10,
    });

    const result = await provider.extract({
      image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
      prompt: 'test',
    });

    assert.strictEqual(attempts, 2);
    assert.strictEqual(result.stopReason, 'stop');
  });

  it('fails with provider_rate_limited after 429 four times (initial + 3 retries)', async () => {
    let attempts = 0;
    const mockSleep = async () => {};

    const mockFetch: typeof fetch = async () => {
      attempts++;
      return new Response(JSON.stringify({ error: { message: 'Resource exhausted' } }), {
        status: 429,
      });
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-1.5-flash',
      fetchFn: mockFetch,
      sleepFn: mockSleep,
      baseBackoffMs: 10,
    });

    await assert.rejects(
      async () =>
        provider.extract({
          image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
          prompt: 'test',
        }),
      (err: any) => err instanceof AppError && err.code === 'provider_rate_limited'
    );

    assert.strictEqual(attempts, 4);
  });

  it('retries on HTTP 503 then succeeds on next attempt', async () => {
    let attempts = 0;
    const mockSleep = async () => {};

    const mockFetch: typeof fetch = async () => {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: 'High demand' } }), {
          status: 503,
          headers: { 'retry-after': '0.1' },
        });
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: 'flowchart\nN1 start "Start"' }] },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.8-flash',
      fetchFn: mockFetch,
      sleepFn: mockSleep,
      baseBackoffMs: 10,
    });

    const result = await provider.extract({
      image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
      prompt: 'test',
    });

    assert.strictEqual(attempts, 2);
    assert.strictEqual(result.stopReason, 'stop');
  });

  it('fails with provider_error indicating temporarily unavailable after 503 four times', async () => {
    let attempts = 0;
    const mockSleep = async () => {};

    const mockFetch: typeof fetch = async () => {
      attempts++;
      return new Response(JSON.stringify({ error: { message: 'Model overloaded' } }), {
        status: 503,
      });
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.8-flash',
      fetchFn: mockFetch,
      sleepFn: mockSleep,
      baseBackoffMs: 10,
    });

    await assert.rejects(
      async () =>
        provider.extract({
          image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
          prompt: 'test',
        }),
      (err: any) =>
        err instanceof AppError &&
        err.code === 'provider_error' &&
        /temporarily unavailable/i.test(err.message)
    );

    assert.strictEqual(attempts, 4);
  });

  it('never retries HTTP 404', async () => {
    let attempts = 0;
    const mockFetch: typeof fetch = async () => {
      attempts++;
      return new Response(JSON.stringify({ error: { message: 'Model not found' } }), {
        status: 404,
      });
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'non-existent-model',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () =>
        provider.extract({
          image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
          prompt: 'test',
        }),
      (err: any) => err instanceof AppError && err.code === 'provider_error' && /404/.test(err.message)
    );

    assert.strictEqual(attempts, 1);
  });

  it('never retries HTTP 400', async () => {
    let attempts = 0;
    const mockFetch: typeof fetch = async () => {
      attempts++;
      return new Response(JSON.stringify({ error: { message: 'Invalid field' } }), {
        status: 400,
      });
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.8-flash',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () =>
        provider.extract({
          image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
          prompt: 'test',
        }),
      (err: any) => err instanceof AppError && err.code === 'provider_error' && /400/.test(err.message)
    );

    assert.strictEqual(attempts, 1);
  });
});

describe('Milestone M2: API Endpoints (POST /api/extract & GET /api/health)', () => {
  class FakeProvider implements ProviderAdapter {
    public readonly name = 'fake-provider';
    private outputText: string;
    private stopReason: 'stop' | 'length' | 'other';

    constructor(outputText: string, stopReason: 'stop' | 'length' | 'other' = 'stop') {
      this.outputText = outputText;
      this.stopReason = stopReason;
    }

    setOutput(text: string, stopReason: 'stop' | 'length' | 'other' = 'stop') {
      this.outputText = text;
      this.stopReason = stopReason;
    }

    async extract(input: ProviderInput): Promise<ProviderOutput> {
      return {
        text: this.outputText,
        stopReason: this.stopReason,
      };
    }
  }

  it('GET /api/health returns provider name and never leaks keys', async () => {
    const fake = new FakeProvider('flowchart\nN1 start "Start"');
    const app = createApp(fake);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.deepStrictEqual(data, {
        status: 'ok',
        provider: 'fake-provider',
      });
    } finally {
      server.close();
    }
  });

  it('POST /api/extract success: returns spec section 4 shape', async () => {
    const fake = new FakeProvider(`flowchart
N1 start "Start"
N2 io "Input x"
N3 end "End"
E N1 N2
E N2 N3`);
    const app = createApp(fake);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const imgBuf = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg().toBuffer();

      const formData = new FormData();
      formData.append('image', new Blob([imgBuf], { type: 'image/jpeg' }), 'test.jpg');

      const res = await fetch(`http://127.0.0.1:${port}/api/extract`, {
        method: 'POST',
        body: formData,
      });

      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;

      // Check section 4 response shape
      assert.ok(data.representation);
      assert.strictEqual(data.representation.type, 'flowchart');
      assert.strictEqual(data.representation.nodes.length, 3);
      assert.strictEqual(data.representation.edges.length, 2);
      assert.ok(typeof data.mermaid === 'string' && data.mermaid.startsWith('flowchart TD'));
      assert.ok(Array.isArray(data.warnings));
      assert.strictEqual(data.truncated, false);
      assert.strictEqual(data.confidence, 1.0);
      assert.strictEqual(data.provider, 'fake-provider');
    } finally {
      server.close();
    }
  });

  it('POST /api/extract truncation: stopReason length sets truncated: true and preserves parsed lines', async () => {
    const fake = new FakeProvider(
      `flowchart
N1 start "Start"
N2 io "Input x"
N3 proc "partially cut`,
      'length'
    );
    const app = createApp(fake);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const imgBuf = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg().toBuffer();
      const formData = new FormData();
      formData.append('image', new Blob([imgBuf], { type: 'image/jpeg' }), 'test.jpg');

      const res = await fetch(`http://127.0.0.1:${port}/api/extract`, {
        method: 'POST',
        body: formData,
      });

      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;
      assert.strictEqual(data.truncated, true);
      assert.strictEqual(data.representation.nodes.length, 2);
    } finally {
      server.close();
    }
  });

  it('POST /api/extract non-image file returns 400 invalid_image', async () => {
    const fake = new FakeProvider('flowchart\nN1 start "Start"');
    const app = createApp(fake);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const textBuf = Buffer.from('Plain text file content');
      const formData = new FormData();
      formData.append('image', new Blob([textBuf], { type: 'text/plain' }), 'test.txt');

      const res = await fetch(`http://127.0.0.1:${port}/api/extract`, {
        method: 'POST',
        body: formData,
      });

      assert.strictEqual(res.status, 400);
      const data = (await res.json()) as any;
      assert.strictEqual(data.error.code, 'invalid_image');
    } finally {
      server.close();
    }
  });

  it('POST /api/extract oversize file returns 413 too_large', async () => {
    const fake = new FakeProvider('flowchart\nN1 start "Start"');
    const app = createApp(fake);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const hugeBuf = Buffer.alloc(10 * 1024 * 1024 + 1024);
      const formData = new FormData();
      formData.append('image', new Blob([hugeBuf], { type: 'image/jpeg' }), 'huge.jpg');

      const res = await fetch(`http://127.0.0.1:${port}/api/extract`, {
        method: 'POST',
        body: formData,
      });

      assert.strictEqual(res.status, 413);
      const data = (await res.json()) as any;
      assert.strictEqual(data.error.code, 'too_large');
    } finally {
      server.close();
    }
  });

  it('POST /api/extract unparseable output returns 422 unparseable_output', async () => {
    const fake = new FakeProvider('uml\nN1 start "Start"');
    const app = createApp(fake);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const imgBuf = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg().toBuffer();
      const formData = new FormData();
      formData.append('image', new Blob([imgBuf], { type: 'image/jpeg' }), 'test.jpg');

      const res = await fetch(`http://127.0.0.1:${port}/api/extract`, {
        method: 'POST',
        body: formData,
      });

      assert.strictEqual(res.status, 422);
      const data = (await res.json()) as any;
      assert.strictEqual(data.error.code, 'unparseable_output');
    } finally {
      server.close();
    }
  });

  it('POST /api/extract empty diagram returns 422 empty_diagram', async () => {
    const fake = new FakeProvider('   \n\n  ');
    const app = createApp(fake);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const imgBuf = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg().toBuffer();
      const formData = new FormData();
      formData.append('image', new Blob([imgBuf], { type: 'image/jpeg' }), 'test.jpg');

      const res = await fetch(`http://127.0.0.1:${port}/api/extract`, {
        method: 'POST',
        body: formData,
      });

      assert.strictEqual(res.status, 422);
      const data = (await res.json()) as any;
      assert.strictEqual(data.error.code, 'empty_diagram');
    } finally {
      server.close();
    }
  });
});

describe('Milestone M2: OpenAI-Compatible Provider Adapter & Retries', () => {
  it('success: sends image as data URL in messages, uses Authorization header, parses usage and reasoning tokens', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any;

    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = url.toString();
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      capturedBody = JSON.parse(init?.body as string);

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: 'flowchart\nN1 start "Start"\nN2 end "End"\nE N1 N2' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 150,
            completion_tokens: 450,
            total_tokens: 600,
            completion_tokens_details: {
              reasoning_tokens: 120,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new OpenAICompatProvider({
      baseUrl: 'https://agentrouter.org/v1',
      apiKey: 'secret-token-xyz',
      model: 'my-custom-model',
      fetchFn: mockFetch,
    });

    const result = await provider.extract({
      image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
      prompt: 'extract flowchart',
    });

    assert.strictEqual(capturedUrl, 'https://agentrouter.org/v1/chat/completions');
    assert.strictEqual(capturedHeaders['Authorization'], 'Bearer secret-token-xyz');
    assert.strictEqual(capturedBody.model, 'my-custom-model');
    assert.strictEqual(capturedBody.temperature, 0);
    assert.strictEqual(capturedBody.max_tokens, 2000);

    const userMessage = capturedBody.messages[0];
    assert.strictEqual(userMessage.role, 'user');
    assert.strictEqual(userMessage.content[0].type, 'text');
    assert.strictEqual(userMessage.content[0].text, 'extract flowchart');
    assert.strictEqual(userMessage.content[1].type, 'image_url');
    assert.ok(userMessage.content[1].image_url.url.startsWith('data:image/jpeg;base64,'));

    assert.strictEqual(result.text, 'flowchart\nN1 start "Start"\nN2 end "End"\nE N1 N2');
    assert.strictEqual(result.stopReason, 'stop');
    assert.strictEqual(result.finishReason, 'stop');
    assert.deepStrictEqual(result.usageMetadata, {
      promptTokenCount: 150,
      candidatesTokenCount: 450,
      thoughtsTokenCount: 120,
      totalTokenCount: 600,
    });
  });

  it('maps finish_reason length to stopReason length', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: 'flowchart\nN1 start "Start"\nN2 proc "Trun' },
              finish_reason: 'length',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new OpenAICompatProvider({
      baseUrl: 'https://agentrouter.org/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchFn: mockFetch,
    });

    const result = await provider.extract({
      image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
      prompt: 'extract',
    });

    assert.strictEqual(result.stopReason, 'length');
    assert.strictEqual(result.finishReason, 'length');
  });

  it('retries on HTTP 429 then succeeds on next attempt (honouring retry-after)', async () => {
    let attempts = 0;
    let sleptMs = 0;
    const mockSleep = async (ms: number) => {
      sleptMs = ms;
    };

    const mockFetch: typeof fetch = async () => {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: 'Rate limited' } }), {
          status: 429,
          headers: { 'retry-after': '1.5' },
        });
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: 'flowchart\nN1 start "Start"' },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new OpenAICompatProvider({
      baseUrl: 'https://agentrouter.org/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchFn: mockFetch,
      sleepFn: mockSleep,
      rateLimitDelayMs: 60_000,
    });

    const result = await provider.extract({
      image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
      prompt: 'test',
    });

    assert.strictEqual(attempts, 2);
    assert.strictEqual(sleptMs, 1500);
    assert.strictEqual(result.stopReason, 'stop');
  });

  it('retries on HTTP 503 then succeeds on next attempt', async () => {
    let attempts = 0;
    let sleptMs = 0;
    const mockSleep = async (ms: number) => {
      sleptMs = ms;
    };

    const mockFetch: typeof fetch = async () => {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: 'Service unavailable' } }), {
          status: 503,
        });
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: 'flowchart\nN1 start "Start"' },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new OpenAICompatProvider({
      baseUrl: 'https://agentrouter.org/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchFn: mockFetch,
      sleepFn: mockSleep,
      serverErrorDelayMs: 5_000,
    });

    const result = await provider.extract({
      image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
      prompt: 'test',
    });

    assert.strictEqual(attempts, 2);
    assert.strictEqual(sleptMs, 5000);
    assert.strictEqual(result.stopReason, 'stop');
  });

  it('fails with provider_error including status 503 after 503 twice', async () => {
    let attempts = 0;
    const mockSleep = async () => {};

    const mockFetch: typeof fetch = async () => {
      attempts++;
      return new Response(JSON.stringify({ error: { message: 'Gateway timeout' } }), {
        status: 503,
      });
    };

    const provider = new OpenAICompatProvider({
      baseUrl: 'https://agentrouter.org/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchFn: mockFetch,
      sleepFn: mockSleep,
    });

    await assert.rejects(
      async () =>
        provider.extract({
          image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
          prompt: 'test',
        }),
      (err: any) =>
        err instanceof AppError &&
        err.code === 'provider_error' &&
        /503/.test(err.message) &&
        /temporarily unavailable/i.test(err.message)
    );

    assert.strictEqual(attempts, 2);
  });

  it('never retries HTTP 400 and includes status number in error', async () => {
    let attempts = 0;
    const mockFetch: typeof fetch = async () => {
      attempts++;
      return new Response(JSON.stringify({ error: { message: 'Invalid parameter' } }), {
        status: 400,
      });
    };

    const provider = new OpenAICompatProvider({
      baseUrl: 'https://agentrouter.org/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () =>
        provider.extract({
          image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
          prompt: 'test',
        }),
      (err: any) =>
        err instanceof AppError &&
        err.code === 'provider_error' &&
        /400/.test(err.message)
    );

    assert.strictEqual(attempts, 1);
  });

  it('never retries HTTP 404 and includes status number in error', async () => {
    let attempts = 0;
    const mockFetch: typeof fetch = async () => {
      attempts++;
      return new Response(JSON.stringify({ error: { message: 'Route not found' } }), {
        status: 404,
      });
    };

    const provider = new OpenAICompatProvider({
      baseUrl: 'https://agentrouter.org/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () =>
        provider.extract({
          image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
          prompt: 'test',
        }),
      (err: any) =>
        err instanceof AppError &&
        err.code === 'provider_error' &&
        /404/.test(err.message)
    );

    assert.strictEqual(attempts, 1);
  });

  it('handles request timeout by returning provider_error', async () => {
    const mockFetch: typeof fetch = async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };

    const provider = new OpenAICompatProvider({
      baseUrl: 'https://agentrouter.org/v1',
      apiKey: 'test-key',
      model: 'test-model',
      timeoutMs: 100,
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () =>
        provider.extract({
          image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
          prompt: 'test',
        }),
      (err: any) =>
        err instanceof AppError &&
        err.code === 'provider_error' &&
        /timed out/i.test(err.message)
    );
  });

  it('key is sent in Authorization header, never in URL, and never in logs', async () => {
    const secretKey = 'bearer-token-secret-999';
    let requestUrl = '';
    let requestHeaders: Record<string, string> = {};

    const logged: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    const origWarn = console.warn;
    console.log = (...args: any[]) => logged.push(args.map(String).join(' '));
    console.error = (...args: any[]) => logged.push(args.map(String).join(' '));
    console.warn = (...args: any[]) => logged.push(args.map(String).join(' '));

    try {
      const mockFetch: typeof fetch = async (url, init) => {
        requestUrl = url.toString();
        requestHeaders = (init?.headers || {}) as Record<string, string>;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'flowchart\nN1 start "Start"' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const provider = new OpenAICompatProvider({
        baseUrl: 'https://agentrouter.org/v1',
        apiKey: secretKey,
        model: 'test-model',
        fetchFn: mockFetch,
      });

      await provider.extract({
        image: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) },
        prompt: 'test',
      });

      assert.strictEqual(requestHeaders['Authorization'], `Bearer ${secretKey}`);
      assert.strictEqual(requestUrl.includes(secretKey), false);
      for (const line of logged) {
        assert.strictEqual(line.includes(secretKey), false);
      }
    } finally {
      console.log = origLog;
      console.error = origErr;
      console.warn = origWarn;
    }
  });
});

describe('Milestone M2: Startup Config Validation & Provider Selection', () => {
  it('PROVIDER=gemini (default) fails fast if GEMINI_API_KEY is missing', async () => {
    const { loadConfig } = await import('../src/config.js');
    const prevProvider = process.env.PROVIDER;
    const prevKey = process.env.GEMINI_API_KEY;
    const prevModel = process.env.GEMINI_MODEL;
    try {
      process.env.PROVIDER = 'gemini';
      delete process.env.GEMINI_API_KEY;
      process.env.GEMINI_MODEL = 'gemini-3.8-flash';
      assert.throws(() => loadConfig(), /Missing required environment variable: GEMINI_API_KEY/);
    } finally {
      process.env.PROVIDER = prevProvider;
      process.env.GEMINI_API_KEY = prevKey;
      process.env.GEMINI_MODEL = prevModel;
    }
  });

  it('PROVIDER=gemini fails fast if GEMINI_MODEL is missing', async () => {
    const { loadConfig } = await import('../src/config.js');
    const prevProvider = process.env.PROVIDER;
    const prevKey = process.env.GEMINI_API_KEY;
    const prevModel = process.env.GEMINI_MODEL;
    try {
      process.env.PROVIDER = 'gemini';
      process.env.GEMINI_API_KEY = 'test-key';
      delete process.env.GEMINI_MODEL;
      assert.throws(() => loadConfig(), /Missing required environment variable: GEMINI_MODEL/);
    } finally {
      process.env.PROVIDER = prevProvider;
      process.env.GEMINI_API_KEY = prevKey;
      process.env.GEMINI_MODEL = prevModel;
    }
  });

  it('PROVIDER=gemini succeeds even if OPENAI_COMPAT_* variables are missing', async () => {
    const { loadConfig } = await import('../src/config.js');
    const prevProvider = process.env.PROVIDER;
    const prevKey = process.env.GEMINI_API_KEY;
    const prevModel = process.env.GEMINI_MODEL;
    const prevOpenAiUrl = process.env.OPENAI_COMPAT_BASE_URL;
    const prevOpenAiKey = process.env.OPENAI_COMPAT_API_KEY;
    const prevOpenAiModel = process.env.OPENAI_COMPAT_MODEL;
    try {
      process.env.PROVIDER = 'gemini';
      process.env.GEMINI_API_KEY = 'valid-gemini-key';
      process.env.GEMINI_MODEL = 'gemini-3.8-flash';
      delete process.env.OPENAI_COMPAT_BASE_URL;
      delete process.env.OPENAI_COMPAT_API_KEY;
      delete process.env.OPENAI_COMPAT_MODEL;

      const config = loadConfig();
      assert.strictEqual(config.provider, 'gemini');
      assert.strictEqual(config.geminiApiKey, 'valid-gemini-key');
    } finally {
      process.env.PROVIDER = prevProvider;
      process.env.GEMINI_API_KEY = prevKey;
      process.env.GEMINI_MODEL = prevModel;
      process.env.OPENAI_COMPAT_BASE_URL = prevOpenAiUrl;
      process.env.OPENAI_COMPAT_API_KEY = prevOpenAiKey;
      process.env.OPENAI_COMPAT_MODEL = prevOpenAiModel;
    }
  });

  it('PROVIDER=openai_compat fails fast if OPENAI_COMPAT_BASE_URL is missing', async () => {
    const { loadConfig } = await import('../src/config.js');
    const prevProvider = process.env.PROVIDER;
    const prevUrl = process.env.OPENAI_COMPAT_BASE_URL;
    const prevKey = process.env.OPENAI_COMPAT_API_KEY;
    const prevModel = process.env.OPENAI_COMPAT_MODEL;
    try {
      process.env.PROVIDER = 'openai_compat';
      delete process.env.OPENAI_COMPAT_BASE_URL;
      process.env.OPENAI_COMPAT_API_KEY = 'test-key';
      process.env.OPENAI_COMPAT_MODEL = 'test-model';
      assert.throws(() => loadConfig(), /Missing required environment variable: OPENAI_COMPAT_BASE_URL/);
    } finally {
      process.env.PROVIDER = prevProvider;
      process.env.OPENAI_COMPAT_BASE_URL = prevUrl;
      process.env.OPENAI_COMPAT_API_KEY = prevKey;
      process.env.OPENAI_COMPAT_MODEL = prevModel;
    }
  });

  it('PROVIDER=openai_compat fails fast if OPENAI_COMPAT_API_KEY is missing', async () => {
    const { loadConfig } = await import('../src/config.js');
    const prevProvider = process.env.PROVIDER;
    const prevUrl = process.env.OPENAI_COMPAT_BASE_URL;
    const prevKey = process.env.OPENAI_COMPAT_API_KEY;
    const prevModel = process.env.OPENAI_COMPAT_MODEL;
    try {
      process.env.PROVIDER = 'openai_compat';
      process.env.OPENAI_COMPAT_BASE_URL = 'https://agentrouter.org/v1';
      delete process.env.OPENAI_COMPAT_API_KEY;
      process.env.OPENAI_COMPAT_MODEL = 'test-model';
      assert.throws(() => loadConfig(), /Missing required environment variable: OPENAI_COMPAT_API_KEY/);
    } finally {
      process.env.PROVIDER = prevProvider;
      process.env.OPENAI_COMPAT_BASE_URL = prevUrl;
      process.env.OPENAI_COMPAT_API_KEY = prevKey;
      process.env.OPENAI_COMPAT_MODEL = prevModel;
    }
  });

  it('PROVIDER=openai_compat fails fast if OPENAI_COMPAT_MODEL is missing', async () => {
    const { loadConfig } = await import('../src/config.js');
    const prevProvider = process.env.PROVIDER;
    const prevUrl = process.env.OPENAI_COMPAT_BASE_URL;
    const prevKey = process.env.OPENAI_COMPAT_API_KEY;
    const prevModel = process.env.OPENAI_COMPAT_MODEL;
    try {
      process.env.PROVIDER = 'openai_compat';
      process.env.OPENAI_COMPAT_BASE_URL = 'https://agentrouter.org/v1';
      process.env.OPENAI_COMPAT_API_KEY = 'test-key';
      delete process.env.OPENAI_COMPAT_MODEL;
      assert.throws(() => loadConfig(), /Missing required environment variable: OPENAI_COMPAT_MODEL/);
    } finally {
      process.env.PROVIDER = prevProvider;
      process.env.OPENAI_COMPAT_BASE_URL = prevUrl;
      process.env.OPENAI_COMPAT_API_KEY = prevKey;
      process.env.OPENAI_COMPAT_MODEL = prevModel;
    }
  });

  it('PROVIDER=openai_compat succeeds even if GEMINI_* variables are missing', async () => {
    const { loadConfig } = await import('../src/config.js');
    const prevProvider = process.env.PROVIDER;
    const prevKey = process.env.GEMINI_API_KEY;
    const prevModel = process.env.GEMINI_MODEL;
    const prevOpenAiUrl = process.env.OPENAI_COMPAT_BASE_URL;
    const prevOpenAiKey = process.env.OPENAI_COMPAT_API_KEY;
    const prevOpenAiModel = process.env.OPENAI_COMPAT_MODEL;
    try {
      process.env.PROVIDER = 'openai_compat';
      delete process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_MODEL;
      process.env.OPENAI_COMPAT_BASE_URL = 'https://agentrouter.org/v1';
      process.env.OPENAI_COMPAT_API_KEY = 'valid-openai-key';
      process.env.OPENAI_COMPAT_MODEL = 'custom-model';

      const config = loadConfig();
      assert.strictEqual(config.provider, 'openai_compat');
      assert.strictEqual(config.openaiCompatBaseUrl, 'https://agentrouter.org/v1');
      assert.strictEqual(config.openaiCompatApiKey, 'valid-openai-key');
      assert.strictEqual(config.openaiCompatModel, 'custom-model');
    } finally {
      process.env.PROVIDER = prevProvider;
      process.env.GEMINI_API_KEY = prevKey;
      process.env.GEMINI_MODEL = prevModel;
      process.env.OPENAI_COMPAT_BASE_URL = prevOpenAiUrl;
      process.env.OPENAI_COMPAT_API_KEY = prevOpenAiKey;
      process.env.OPENAI_COMPAT_MODEL = prevOpenAiModel;
    }
  });

  it('rejects invalid PROVIDER value with clear message', async () => {
    const { loadConfig } = await import('../src/config.js');
    const prevProvider = process.env.PROVIDER;
    try {
      process.env.PROVIDER = 'unsupported_provider';
      assert.throws(() => loadConfig(), /Invalid PROVIDER: "unsupported_provider"\. Must be "gemini" or "openai_compat"/);
    } finally {
      process.env.PROVIDER = prevProvider;
    }
  });
});



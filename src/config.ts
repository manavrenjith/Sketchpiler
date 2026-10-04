// Loads and validates server configuration and AI provider environment variables.
import dotenv from 'dotenv';

dotenv.config();

export type ProviderType = 'gemini' | 'openai_compat';

export interface Config {
  provider: ProviderType;
  port: number;
  geminiApiKey?: string;
  geminiModel?: string;
  openaiCompatBaseUrl?: string;
  openaiCompatApiKey?: string;
  openaiCompatModel?: string;
}

export function loadConfig(): Config {
  const providerRaw = (process.env.PROVIDER || 'gemini').trim().toLowerCase();
  const port = parseInt(process.env.PORT || '3000', 10);
  const normalizedPort = isNaN(port) ? 3000 : port;

  if (providerRaw !== 'gemini' && providerRaw !== 'openai_compat') {
    throw new Error(`Invalid PROVIDER: "${providerRaw}". Must be "gemini" or "openai_compat"`);
  }

  if (providerRaw === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL;
    if (!apiKey || !apiKey.trim()) {
      throw new Error('Missing required environment variable: GEMINI_API_KEY');
    }
    if (!model || !model.trim()) {
      throw new Error('Missing required environment variable: GEMINI_MODEL');
    }
    return {
      provider: 'gemini',
      port: normalizedPort,
      geminiApiKey: apiKey.trim(),
      geminiModel: model.trim(),
    };
  }

  // providerRaw === 'openai_compat'
  const baseUrl = process.env.OPENAI_COMPAT_BASE_URL;
  const apiKey = process.env.OPENAI_COMPAT_API_KEY;
  const model = process.env.OPENAI_COMPAT_MODEL;

  if (!baseUrl || !baseUrl.trim()) {
    throw new Error('Missing required environment variable: OPENAI_COMPAT_BASE_URL');
  }
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Missing required environment variable: OPENAI_COMPAT_API_KEY');
  }
  if (!model || !model.trim()) {
    throw new Error('Missing required environment variable: OPENAI_COMPAT_MODEL');
  }

  return {
    provider: 'openai_compat',
    port: normalizedPort,
    openaiCompatBaseUrl: baseUrl.trim(),
    openaiCompatApiKey: apiKey.trim(),
    openaiCompatModel: model.trim(),
  };
}

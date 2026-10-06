// HTTP server entrypoint that boots the Express app on the configured port.
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { GeminiProvider } from './providers/gemini.js';
import { OpenAICompatProvider } from './providers/openaiCompat.js';
import { ProviderAdapter } from './providers/types.js';

const config = loadConfig();

let provider: ProviderAdapter;
if (config.provider === 'gemini') {
  provider = new GeminiProvider({
    apiKey: config.geminiApiKey!,
    model: config.geminiModel!,
  });
} else {
  provider = new OpenAICompatProvider({
    baseUrl: config.openaiCompatBaseUrl!,
    apiKey: config.openaiCompatApiKey!,
    model: config.openaiCompatModel!,
  });
}

const app = createApp(provider);

app.listen(config.port, () => {
  // Never log API keys, diagram text, or images (NFR-5)
  console.log(`Server listening on port ${config.port} with provider "${provider.name}"`);
});

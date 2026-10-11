// CLI script to list available Gemini models for the configured API key.
import dotenv from 'dotenv';

dotenv.config();

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.error('Error: GEMINI_API_KEY is not set in environment or .env');
    process.exit(1);
  }

  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  let pageToken: string | undefined = undefined;

  try {
    do {
      const url = pageToken ? `${baseUrl}?pageToken=${encodeURIComponent(pageToken)}` : baseUrl;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey.trim(),
        },
      });

      if (!response.ok) {
        let errorMsg = response.statusText;
        try {
          const errJson: any = await response.json();
          errorMsg = errJson?.error?.message || response.statusText;
        } catch {}
        console.error(`Error HTTP ${response.status}: ${errorMsg}`);
        process.exit(1);
      }

      const data: any = await response.json();
      const models = data?.models || [];

      for (const model of models) {
        const methods: string[] = model.supportedGenerationMethods || [];
        if (methods.includes('generateContent')) {
          const id = (model.name || '').replace(/^models\//, '');
          const displayName = model.displayName || '';
          const inputTokenLimit = model.inputTokenLimit ?? 'unknown';
          console.log(`${id} | ${displayName} | inputTokenLimit: ${inputTokenLimit}`);
        }
      }

      pageToken = data?.nextPageToken;
    } while (pageToken);
  } catch (err: any) {
    console.error(`Network error: ${err?.message || err}`);
    process.exit(1);
  }
}

listModels();

// End-to-end command-line smoke test runner for flowchart extraction and pseudocode.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import { OpenAICompatProvider } from '../src/providers/openaiCompat.js';
import { ProviderAdapter } from '../src/providers/types.js';
import { extractFlowchart } from '../src/pipeline.js';
import { generatePseudocode } from '../src/generator.js';

async function main() {
  const args = process.argv.slice(2);
  let providerArg: string | undefined;
  let imageArg: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider') {
      providerArg = args[i + 1];
      i++;
    } else if (args[i].startsWith('--provider=')) {
      providerArg = args[i].slice('--provider='.length);
    } else if (!imageArg) {
      imageArg = args[i];
    }
  }

  if (providerArg) {
    if (providerArg !== 'gemini' && providerArg !== 'openai_compat') {
      console.error(`Invalid --provider: "${providerArg}". Must be "gemini" or "openai_compat"`);
      process.exitCode = 1;
      return;
    }
    process.env.PROVIDER = providerArg;
  }

  if (!imageArg) {
    console.error('Usage: npm run smoke -- [--provider gemini|openai_compat] <image path>');
    process.exitCode = 1;
    return;
  }

  const resolvedPath = path.resolve(process.cwd(), imageArg);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Image file not found: ${resolvedPath}`);
    process.exitCode = 1;
    return;
  }

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

  const imageBuffer = fs.readFileSync(resolvedPath);
  console.log(`Processing image: ${imageArg} (${imageBuffer.length} bytes) using provider "${provider.name}"...`);

  const extractResult = await extractFlowchart({
    imageBuffer,
    provider,
  });

  console.log('\n=== DIAGNOSTICS ===');
  console.log(`finishReason: ${extractResult.finishReason ?? 'unknown'}`);
  console.log(`promptTokenCount: ${extractResult.usageMetadata?.promptTokenCount ?? 0}`);
  console.log(`candidatesTokenCount: ${extractResult.usageMetadata?.candidatesTokenCount ?? 0}`);
  console.log(`thoughtsTokenCount: ${extractResult.usageMetadata?.thoughtsTokenCount ?? 0}`);
  console.log(`totalTokenCount: ${extractResult.usageMetadata?.totalTokenCount ?? 0}`);

  console.log('\n=== EXTRACTION RESULT ===');
  console.log(`Provider: ${extractResult.provider}`);
  console.log(`Confidence: ${extractResult.confidence}`);
  console.log(`Truncated: ${extractResult.truncated}`);
  console.log(`Warnings: ${JSON.stringify(extractResult.warnings, null, 2)}`);

  console.log('\n=== REPRESENTATION ===');
  console.log(JSON.stringify(extractResult.representation, null, 2));

  console.log('\n=== MERMAID ===');
  console.log(extractResult.mermaid);

  const genResult = await generatePseudocode(extractResult.representation);

  console.log('\n=== GENERATED PSEUDOCODE ===');
  console.log(genResult.pseudocode);

  if (genResult.warnings.length > 0) {
    console.log('\n=== GENERATOR WARNINGS ===');
    console.log(JSON.stringify(genResult.warnings, null, 2));
  }
}

main().catch(err => {
  console.error('Smoke test failed:', err?.message || err);
  process.exitCode = 1;
});

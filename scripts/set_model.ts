// CLI helper script to update GEMINI_MODEL in the local .env configuration file.
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');
const recommendedModel = 'gemini-2.5-flash';

if (!fs.existsSync(envPath)) {
  console.error('.env file not found');
  process.exit(1);
}

const content = fs.readFileSync(envPath, 'utf8');
const lines = content.split(/\r?\n/);
let modelFound = false;

const updatedLines = lines.map(line => {
  if (/^\s*GEMINI_MODEL\s*=/.test(line)) {
    modelFound = true;
    return `GEMINI_MODEL=${recommendedModel}`;
  }
  return line;
});

if (!modelFound) {
  updatedLines.push(`GEMINI_MODEL=${recommendedModel}`);
}

fs.writeFileSync(envPath, updatedLines.join('\n'), 'utf8');

// Extract variable names present without revealing any values
const varNames: string[] = [];
for (const line of updatedLines) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (match) {
    varNames.push(match[1]);
  }
}

console.log(`GEMINI_MODEL=${recommendedModel}`);
console.log(`Variables present: ${varNames.join(', ')}`);

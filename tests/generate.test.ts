// Tests for pseudocode generation from various flowchart graph structures.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';

import { createApp } from '../src/app.js';
import { parseDsl } from '../src/parser.js';
import { ProviderAdapter } from '../src/providers/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

describe('POST /api/generate endpoint (mocked, no network)', () => {
  const dummyProvider: ProviderAdapter = {
    name: 'test-provider',
    extract: async () => ({
      text: '',
      stopReason: 'stop',
    }),
  };

  it('success with the 01_sum_of_n fixture representation', async () => {
    const fixtureDsl = fs.readFileSync(path.join(fixturesDir, '01_sum_of_n.txt'), 'utf8');
    const expectedPseudocode = fs
      .readFileSync(path.join(fixturesDir, '01_sum_of_n.expected.txt'), 'utf8')
      .trim();

    const parsed = parseDsl(fixtureDsl);
    assert.ok(parsed.representation);

    const app = createApp(dummyProvider);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ representation: parsed.representation }),
      });

      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;

      assert.strictEqual(typeof data.pseudocode, 'string');
      assert.strictEqual(data.pseudocode.trim(), expectedPseudocode);
      assert.strictEqual(data.valid, true);
      assert.strictEqual(typeof data.confidence, 'number');
      assert.strictEqual(data.confidence, 1.0);
      assert.ok(Array.isArray(data.warnings));
      assert.strictEqual(data.warnings.length, 0);
      assert.ok(typeof data.mermaid === 'string' && data.mermaid.startsWith('flowchart TD'));
    } finally {
      server.close();
    }
  });

  it('an edited representation (changed box text) gives changed pseudocode', async () => {
    const fixtureDsl = fs.readFileSync(path.join(fixturesDir, '01_sum_of_n.txt'), 'utf8');
    const parsed = parseDsl(fixtureDsl);

    // Deep clone and edit box text: change N2 from "Input n" to "Input max_items"
    const editedRep = JSON.parse(JSON.stringify(parsed.representation));
    const targetNode = editedRep.nodes.find((n: any) => n.id === 'N2');
    assert.ok(targetNode);
    targetNode.text = 'Input max_items';

    const app = createApp(dummyProvider);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ representation: editedRep }),
      });

      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;

      assert.ok(data.pseudocode.includes('INPUT max_items'));
      assert.ok(!data.pseudocode.includes('INPUT n'));
      assert.strictEqual(data.valid, true);
    } finally {
      server.close();
    }
  });

  it('invalid representation returns 400 invalid_representation', async () => {
    const app = createApp(dummyProvider);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      // 1. nodes is not an array
      const res1 = await fetch(`http://127.0.0.1:${port}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ representation: { nodes: 'not_an_array', edges: [] } }),
      });
      assert.strictEqual(res1.status, 400);
      const data1 = (await res1.json()) as any;
      assert.strictEqual(data1?.error?.code, 'invalid_representation');

      // 2. representation is a string
      const res2 = await fetch(`http://127.0.0.1:${port}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ representation: 'invalid_string' }),
      });
      assert.strictEqual(res2.status, 400);
      const data2 = (await res2.json()) as any;
      assert.strictEqual(data2?.error?.code, 'invalid_representation');

      // 3. nodes is empty
      const res3 = await fetch(`http://127.0.0.1:${port}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ representation: { nodes: [], edges: [] } }),
      });
      assert.strictEqual(res3.status, 400);
      const data3 = (await res3.json()) as any;
      assert.strictEqual(data3?.error?.code, 'invalid_representation');
    } finally {
      server.close();
    }
  });

  it('missing body returns 400 invalid_representation', async () => {
    const app = createApp(dummyProvider);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      // Empty object (missing representation)
      const res1 = await fetch(`http://127.0.0.1:${port}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.strictEqual(res1.status, 400);
      const data1 = (await res1.json()) as any;
      assert.strictEqual(data1?.error?.code, 'invalid_representation');

      // representation is null
      const res2 = await fetch(`http://127.0.0.1:${port}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ representation: null }),
      });
      assert.strictEqual(res2.status, 400);
      const data2 = (await res2.json()) as any;
      assert.strictEqual(data2?.error?.code, 'invalid_representation');
    } finally {
      server.close();
    }
  });
});

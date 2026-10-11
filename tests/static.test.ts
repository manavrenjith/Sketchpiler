// Tests verifying static asset serving for HTML, CSS, JavaScript, and vendor files.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { ProviderAdapter } from '../src/providers/types.js';

describe('Static UI serving', () => {
  const dummyProvider: ProviderAdapter = {
    name: 'test-provider',
    extract: async () => ({
      text: 'flowchart\nN1 start "Start"',
      stopReason: 'stop',
    }),
  };

  it('GET / returns the HTML', async () => {
    const app = createApp(dummyProvider);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      assert.strictEqual(res.status, 200);
      assert.ok(
        res.headers.get('content-type')?.includes('text/html'),
        'Content-Type header should be text/html'
      );
      const text = await res.text();
      assert.ok(text.includes('<!DOCTYPE html>'), 'Response should contain <!DOCTYPE html>');
      assert.ok(text.includes('Sketchpiler'), 'Response should contain title/brand');
    } finally {
      server.close();
    }
  });

  it('GET /editor.html returns the editor HTML', async () => {
    const app = createApp(dummyProvider);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/editor.html`);
      assert.strictEqual(res.status, 200);
      assert.ok(
        res.headers.get('content-type')?.includes('text/html'),
        'Content-Type header should be text/html'
      );
      const text = await res.text();
      assert.ok(text.includes('Flowchart Review &amp; Editor') || text.includes('Flowchart Review & Editor'));
      assert.ok(text.includes('nodesTable'));
      assert.ok(text.includes('edgesTable'));
    } finally {
      server.close();
    }
  });

  it('GET /vendor/mermaid.min.js returns 200 with a JavaScript content type', async () => {
    const app = createApp(dummyProvider);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/vendor/mermaid.min.js`);
      assert.strictEqual(res.status, 200);
      const contentType = res.headers.get('content-type') || '';
      assert.ok(
        contentType.includes('javascript'),
        `Expected JavaScript content-type, got: ${contentType}`
      );
      const text = await res.text();
      assert.ok(text.length > 100000);
      assert.ok(text.includes('mermaid'));
    } finally {
      server.close();
    }
  });

  it('GET /styles.css returns 200 with a CSS content type', async () => {
    const app = createApp(dummyProvider);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/styles.css`);
      assert.strictEqual(res.status, 200);
      const contentType = res.headers.get('content-type') || '';
      assert.ok(
        contentType.includes('text/css'),
        `Expected text/css, got: ${contentType}`
      );
      const text = await res.text();
      assert.ok(text.includes('--accent: #4f46e5'));
    } finally {
      server.close();
    }
  });

  it('GET /editor-canvas.html returns 200 with HTML content type', async () => {
    const app = createApp(dummyProvider);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/editor-canvas.html`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type')?.includes('text/html'));
      const text = await res.text();
      assert.ok(text.includes('canvas'));
    } finally {
      server.close();
    }
  });

  it('GET /js/editor-core.js returns 200 with JavaScript content type', async () => {
    const app = createApp(dummyProvider);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/js/editor-core.js`);
      assert.strictEqual(res.status, 200);
      const contentType = res.headers.get('content-type') || '';
      assert.ok(
        contentType.includes('javascript'),
        `Expected javascript, got: ${contentType}`
      );
      const text = await res.text();
      assert.ok(text.includes('autoLayout'));
    } finally {
      server.close();
    }
  });
});

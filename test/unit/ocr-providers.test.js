const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OpenRouterOcrProvider,
  VertexGeminiOcrProvider,
  createOcrProvider,
} = require('../../src/apps/legalserver/documentText/ocrProviders');
const { createSequentialFetch, jsonResponse, textResponse } = require('../support/mockFetch');

test('createOcrProvider returns null when OCR is disabled', () => {
  assert.equal(createOcrProvider(null), null);
  assert.equal(createOcrProvider({ documentOcrProvider: 'none' }), null);
  assert.equal(createOcrProvider({}), null);
});

test('createOcrProvider builds a VertexGeminiOcrProvider for vertex_gemini', () => {
  const provider = createOcrProvider({
    documentOcrProvider: 'vertex_gemini',
    googleCloudProject: 'proj-1',
    googleCloudLocation: 'us-central1',
    documentOcrModel: 'gemini-2.5-flash',
  });

  assert.ok(provider instanceof VertexGeminiOcrProvider);
  assert.equal(provider.project, 'proj-1');
  assert.equal(provider.location, 'us-central1');
  assert.equal(provider.model, 'gemini-2.5-flash');
});

test('createOcrProvider builds an OpenRouterOcrProvider for openrouter', () => {
  const provider = createOcrProvider({
    documentOcrProvider: 'openrouter',
    openRouterApiKey: 'sk-or-test-key',
    documentOcrModel: 'google/gemini-2.5-flash',
  });

  assert.ok(provider instanceof OpenRouterOcrProvider);
  assert.equal(provider.apiKey, 'sk-or-test-key');
  assert.equal(provider.model, 'google/gemini-2.5-flash');
});

test('createOcrProvider rejects unsupported provider values', () => {
  assert.throws(
    () => createOcrProvider({ documentOcrProvider: 'bogus' }),
    /Unsupported OCR provider: bogus/,
  );
});

test('OpenRouterOcrProvider sends the documented vision request shape and extracts text', async () => {
  const calls = [];
  const fetchImpl = createSequentialFetch([
    jsonResponse(200, { choices: [{ message: { content: 'Page one text' } }] }),
    jsonResponse(200, { choices: [{ message: { content: 'Page two text' } }] }),
  ], calls);

  const provider = new OpenRouterOcrProvider({
    apiKey: 'sk-or-test-key',
    model: 'google/gemini-2.5-flash',
    fetchImpl,
  });

  const results = await provider.extractPages([
    { pageNumber: 1, bytes: Buffer.from('page-1-bytes'), mimeType: 'image/png' },
    { pageNumber: 2, bytes: Buffer.from('page-2-bytes'), mimeType: 'image/png' },
  ]);

  assert.deepEqual(results, [
    { pageNumber: 1, text: 'Page one text' },
    { pageNumber: 2, text: 'Page two text' },
  ]);

  assert.equal(calls.length, 2);
  const [firstCall] = calls;
  assert.equal(firstCall.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(firstCall.options.method, 'POST');
  assert.equal(firstCall.options.headers.Authorization, 'Bearer sk-or-test-key');
  assert.equal(firstCall.options.headers['Content-Type'], 'application/json');

  const body = JSON.parse(firstCall.options.body);
  assert.equal(body.model, 'google/gemini-2.5-flash');
  assert.equal(body.temperature, 0);
  assert.equal(body.messages[0].role, 'user');
});

test('OpenRouterOcrProvider encodes page bytes as a base64 data URI image_url part', async () => {
  const calls = [];
  const fetchImpl = createSequentialFetch([
    jsonResponse(200, { choices: [{ message: { content: 'transcribed' } }] }),
  ], calls);

  const provider = new OpenRouterOcrProvider({
    apiKey: 'sk-or-test-key',
    model: 'google/gemini-2.5-flash',
    fetchImpl,
  });

  const bytes = Buffer.from('fake-image-bytes');
  await provider.extractPages([{ pageNumber: 1, bytes, mimeType: 'image/jpeg' }]);

  const body = JSON.parse(calls[0].options.body);
  const [textPart, imagePart] = body.messages[0].content;
  assert.equal(textPart.type, 'text');
  assert.match(textPart.text, /Transcribe this page/i);
  assert.equal(imagePart.type, 'image_url');
  assert.equal(imagePart.image_url.url, `data:image/jpeg;base64,${bytes.toString('base64')}`);
});

test('OpenRouterOcrProvider raises extraction_failed with the page number on a non-ok response', async () => {
  const fetchImpl = createSequentialFetch([
    textResponse(429, 'rate limited'),
  ], []);

  const provider = new OpenRouterOcrProvider({
    apiKey: 'sk-or-test-key',
    model: 'google/gemini-2.5-flash',
    fetchImpl,
  });

  await assert.rejects(
    () => provider.extractPages([{ pageNumber: 3, bytes: Buffer.from('x'), mimeType: 'image/png' }]),
    (error) => {
      assert.equal(error.errorCode, 'extraction_failed');
      assert.equal(error.status, 502);
      assert.match(error.message, /page 3/);
      return true;
    },
  );
});

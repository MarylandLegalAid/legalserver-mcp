const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OpenAiOcrProvider,
  createOcrProvider,
} = require('../../src/apps/legalserver/documentText/ocrProviders');
const { createSequentialFetch, jsonResponse, textResponse } = require('../support/mockFetch');

test('createOcrProvider returns null when OCR is disabled', () => {
  assert.equal(createOcrProvider(null), null);
  assert.equal(createOcrProvider({ documentOcrProvider: 'none' }), null);
  assert.equal(createOcrProvider({}), null);
});

test('createOcrProvider builds an OpenAiOcrProvider for openai', () => {
  const provider = createOcrProvider({
    documentOcrProvider: 'openai',
    openAiApiKey: 'sk-test-key',
    documentOcrModel: 'gpt-5.6-luna',
  });

  assert.ok(provider instanceof OpenAiOcrProvider);
  assert.equal(provider.apiKey, 'sk-test-key');
  assert.equal(provider.model, 'gpt-5.6-luna');
});

test('createOcrProvider rejects the removed third-party providers', () => {
  assert.throws(
    () => createOcrProvider({ documentOcrProvider: 'openrouter' }),
    /Unsupported OCR provider: openrouter/,
  );
  assert.throws(
    () => createOcrProvider({ documentOcrProvider: 'vertex_gemini' }),
    /Unsupported OCR provider: vertex_gemini/,
  );
});

test('createOcrProvider rejects unsupported provider values', () => {
  assert.throws(
    () => createOcrProvider({ documentOcrProvider: 'bogus' }),
    /Unsupported OCR provider: bogus/,
  );
});

test('OpenAiOcrProvider sends page images directly to api.openai.com, not any proxy', async () => {
  const calls = [];
  const fetchImpl = createSequentialFetch([
    jsonResponse(200, { choices: [{ message: { content: 'Transcribed text' } }] }),
  ], calls);

  const provider = new OpenAiOcrProvider({
    apiKey: 'sk-test-key',
    model: 'gpt-5.6-luna',
    fetchImpl,
  });

  const bytes = Buffer.from('fake-scanned-page-bytes');
  const results = await provider.extractPages([{ pageNumber: 1, bytes, mimeType: 'image/png' }]);

  assert.deepEqual(results, [{ pageNumber: 1, text: 'Transcribed text' }]);
  assert.equal(calls.length, 1);

  const [call] = calls;
  assert.equal(call.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(call.options.headers.Authorization, 'Bearer sk-test-key');

  const body = JSON.parse(call.options.body);
  assert.equal(body.model, 'gpt-5.6-luna');
  assert.equal(body.temperature, 0);
  const [textPart, imagePart] = body.messages[0].content;
  assert.equal(textPart.type, 'text');
  assert.equal(imagePart.type, 'image_url');
  assert.equal(imagePart.image_url.url, `data:image/png;base64,${bytes.toString('base64')}`);
});

// The OCR request carries a scanned client document. OpenAI 4xx bodies can echo request
// fragments back, and this message reaches the end user through the MCP client, so the
// response body must never be interpolated into it.
test('OpenAiOcrProvider keeps the OpenAI error body out of the user-facing message', async () => {
  const fetchImpl = createSequentialFetch([
    textResponse(400, 'invalid_request_error: could not process image data:image/png;base64,SECRETPAGEBYTES'),
  ], []);

  const provider = new OpenAiOcrProvider({
    apiKey: 'sk-test-key',
    model: 'gpt-5.6-luna',
    fetchImpl,
  });

  await assert.rejects(
    () => provider.extractPages([{ pageNumber: 2, bytes: Buffer.from('x'), mimeType: 'image/png' }]),
    (error) => {
      assert.equal(error.errorCode, 'extraction_failed');
      assert.doesNotMatch(error.message, /SECRETPAGEBYTES/);
      assert.doesNotMatch(error.message, /base64/);
      assert.match(error.message, /400/);
      return true;
    },
  );
});

test('OpenAiOcrProvider raises extraction_failed with the page number on a non-ok response', async () => {
  const fetchImpl = createSequentialFetch([
    textResponse(401, 'invalid api key'),
  ], []);

  const provider = new OpenAiOcrProvider({
    apiKey: 'sk-bad-key',
    model: 'gpt-5.6-luna',
    fetchImpl,
  });

  await assert.rejects(
    () => provider.extractPages([{ pageNumber: 5, bytes: Buffer.from('x'), mimeType: 'image/png' }]),
    (error) => {
      assert.equal(error.errorCode, 'extraction_failed');
      assert.equal(error.status, 502);
      assert.match(error.message, /page 5/);
      return true;
    },
  );
});

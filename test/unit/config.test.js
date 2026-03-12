const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, normalizeBaseUrl, parseOcrProvider, parseTimeout } = require('../../src/config');

test('normalizeBaseUrl validates and normalizes trailing slash', () => {
  assert.equal(normalizeBaseUrl('https://example.legalserver.org'), 'https://example.legalserver.org/');
  assert.equal(normalizeBaseUrl('https://example.legalserver.org////'), 'https://example.legalserver.org/');
});

test('loadConfig fails fast when required env is missing', () => {
  assert.throws(
    () => loadConfig({ LEGALSERVER_BASE_URL: 'https://example.legalserver.org/' }),
    /LEGALSERVER_BEARER_TOKEN/,
  );
});

test('parseTimeout uses default and rejects invalid values', () => {
  assert.equal(parseTimeout(undefined), 30000);
  assert.equal(parseTimeout('45000'), 45000);
  assert.throws(() => parseTimeout('0'), /positive integer/);
});

test('OCR config defaults and validates provider-specific requirements', () => {
  const config = loadConfig({
    LEGALSERVER_BASE_URL: 'https://example.legalserver.org/',
    LEGALSERVER_BEARER_TOKEN: 'token',
  });

  assert.equal(config.documentOcrProvider, 'none');
  assert.equal(config.documentOcrModel, 'gemini-2.5-flash');
  assert.equal(config.googleCloudLocation, 'global');
  assert.equal(parseOcrProvider('vertex_gemini'), 'vertex_gemini');

  assert.throws(
    () => loadConfig({
      LEGALSERVER_BASE_URL: 'https://example.legalserver.org/',
      LEGALSERVER_BEARER_TOKEN: 'token',
      DOCUMENT_OCR_PROVIDER: 'vertex_gemini',
    }),
    /GOOGLE_CLOUD_PROJECT/,
  );
  assert.throws(() => parseOcrProvider('bad'), /DOCUMENT_OCR_PROVIDER/);
});

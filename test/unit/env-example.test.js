const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('.env.example exposes phase 2 OCR configuration', () => {
  const envExample = fs.readFileSync(path.join(__dirname, '../../.env.example'), 'utf8');

  assert.match(envExample, /^LEGALSERVER_BASE_URL=/m);
  assert.match(envExample, /^LEGALSERVER_BEARER_TOKEN=/m);
  assert.match(envExample, /^LEGALSERVER_TIMEOUT_MS=/m);
  assert.match(envExample, /^DOCUMENT_OCR_PROVIDER=/m);
  assert.match(envExample, /^DOCUMENT_OCR_MODEL=/m);
  assert.match(envExample, /^GOOGLE_CLOUD_PROJECT=/m);
  assert.match(envExample, /^GOOGLE_CLOUD_LOCATION=/m);
  assert.match(envExample, /^GOOGLE_APPLICATION_CREDENTIALS=/m);
});

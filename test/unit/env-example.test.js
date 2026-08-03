const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('.env.example exposes phase 2 OCR configuration', () => {
  const envExample = fs.readFileSync(path.join(__dirname, '../../.env.example'), 'utf8');

  assert.match(envExample, /^LEGALSERVER_BASE_URL=/m);
  assert.match(envExample, /^LEGALSERVER_BEARER_TOKEN=/m);
  assert.match(envExample, /^LEGALSERVER_TIMEOUT_MS=/m);
  assert.match(envExample, /^MCP_HTTP_HOST=/m);
  assert.match(envExample, /^MCP_HTTP_PORT=/m);
  assert.match(envExample, /^MCP_ALLOWED_HOSTS=/m);
  assert.match(envExample, /^MCP_SHARED_SECRET=/m);
  assert.match(envExample, /^MCP_SHARED_SECRET_HEADER=/m);
  assert.match(envExample, /^LEGALSERVER_USER_EMAIL_HEADER=/m);
  assert.match(envExample, /^LEGALSERVER_CURRENT_USER_EVENTS_REPORT_URL=/m);
  assert.match(envExample, /^LEGALSERVER_CURRENT_USER_TASKS_REPORT_URL=/m);
  assert.match(envExample, /^MATTER_CURRENT_USER_CACHE_TTL_MS=/m);
  assert.match(envExample, /^MATTER_CURRENT_USER_FETCH_CONCURRENCY=/m);
  assert.match(envExample, /^DOCUMENT_OCR_PROVIDER=/m);
  assert.match(envExample, /^DOCUMENT_OCR_MODEL=/m);
  assert.match(envExample, /^OPENAI_API_KEY=/m);

  // The removed providers must not reappear as copy-paste-able settings.
  assert.doesNotMatch(envExample, /^OPENROUTER_API_KEY=/m);
  assert.doesNotMatch(envExample, /^GOOGLE_CLOUD_PROJECT=/m);
  assert.doesNotMatch(envExample, /^GOOGLE_CLOUD_LOCATION=/m);
  assert.doesNotMatch(envExample, /^GOOGLE_APPLICATION_CREDENTIALS=/m);
  assert.match(envExample, /^PHASE3_CONTACT_EMAIL=/m);
  assert.match(envExample, /^PHASE3_USER_LOGIN=/m);
  assert.match(envExample, /^PHASE3_ORGANIZATION_NAME=/m);
  assert.match(envExample, /^PHASE3_CURRENT_USER_EMAIL=/m);
  assert.match(envExample, /^PHASE3_TASK_DATE=/m);
  assert.match(envExample, /^PHASE3_EVENT_DATE=/m);
  assert.match(envExample, /^PHASE3_RANGE_START_DATE=/m);
  assert.match(envExample, /^PHASE3_RANGE_END_DATE=/m);
});

// Whoever copies this template into a deployment is the person who has to arrange Zero Data
// Retention on their own OpenAI account. Nothing in the code can do it for them, so the
// template has to say so where they will actually read it.
test('.env.example names Zero Data Retention as an operator responsibility for OCR', () => {
  const envExample = fs.readFileSync(path.join(__dirname, '../../.env.example'), 'utf8');

  assert.match(envExample, /Zero Data Retention/);
  assert.match(envExample, /store: false/);
  assert.match(envExample, /NOT[\s#]+zero retention/);
});

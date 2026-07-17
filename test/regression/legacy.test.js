const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CANONICAL_TOOL_NAMES } = require('../../src/apps/legalserver/constants');

test('canonical tool list excludes legacy prototype names', () => {
  const legacyNames = [
    'search_case_by_number',
    'get_case_info',
    'list_case_documents',
    'get_document',
  ];

  for (const legacyName of legacyNames) {
    assert.equal(CANONICAL_TOOL_NAMES.includes(legacyName), false);
  }
});

test('only the dedicated LegalServer binary download helper references the document download endpoint', () => {
  const root = path.join(__dirname, '..', '..');
  const legalserverRoot = path.join(root, 'src', 'apps', 'legalserver');
  const filesToScan = [
    path.join(root, 'index.js'),
    path.join(legalserverRoot, 'constants.js'),
    path.join(legalserverRoot, 'config.js'),
    path.join(legalserverRoot, 'mcpServer.js'),
    path.join(legalserverRoot, 'toolRegistry.js'),
    path.join(legalserverRoot, 'tools', 'contacts.js'),
    path.join(legalserverRoot, 'tools', 'documents.js'),
    path.join(legalserverRoot, 'tools', 'events.js'),
    path.join(legalserverRoot, 'tools', 'matters.js'),
    path.join(legalserverRoot, 'tools', 'organizations.js'),
    path.join(legalserverRoot, 'tools', 'tasks.js'),
    path.join(legalserverRoot, 'tools', 'users.js'),
  ];

  for (const filePath of filesToScan) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(content.includes('/modules/document/download.php'), false, filePath);
  }

  const clientContent = fs.readFileSync(path.join(legalserverRoot, 'legalserverClient.js'), 'utf8');
  assert.equal(clientContent.includes('/modules/document/download.php'), true);
});

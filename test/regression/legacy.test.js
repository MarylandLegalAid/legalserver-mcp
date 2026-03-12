const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CANONICAL_TOOL_NAMES } = require('../../src/constants');

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
  const filesToScan = [
    path.join(root, 'index.js'),
    path.join(root, 'src', 'constants.js'),
    path.join(root, 'src', 'config.js'),
    path.join(root, 'src', 'mcpServer.js'),
    path.join(root, 'src', 'toolRegistry.js'),
    path.join(root, 'src', 'tools', 'documents.js'),
    path.join(root, 'src', 'tools', 'matters.js'),
  ];

  for (const filePath of filesToScan) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(content.includes('/modules/document/download.php'), false, filePath);
  }

  const clientContent = fs.readFileSync(path.join(root, 'src', 'legalserverClient.js'), 'utf8');
  assert.equal(clientContent.includes('/modules/document/download.php'), true);
});

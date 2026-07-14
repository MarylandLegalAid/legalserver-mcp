#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const { loadConfig } = require('../src/apps/legalserver/config');
const helpers = require('../src/apps/legalserver/helpers');
const { LegalServerClient } = require('../src/apps/legalserver/legalserverClient');
const { createDocumentTextPipeline } = require('../src/apps/legalserver/documentText');
const { createOcrProvider } = require('../src/apps/legalserver/documentText/ocrProviders');
const { createToolRegistry } = require('../src/apps/legalserver/toolRegistry');

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === '--help' || current === '-h') {
      parsed.help = true;
      continue;
    }

    if (!current.startsWith('--')) {
      continue;
    }

    const key = current.slice(2).replace(/-/g, '_');
    parsed[key] = next && !next.startsWith('--') ? next : 'true';
    if (parsed[key] === next) {
      index += 1;
    }
  }

  return parsed;
}

function printUsage() {
  console.log(`
Usage:
  npm run manual:phase2 -- --case_uuid <uuid> (--document_uuid <uuid> | --document_id <id>) [--query <text>]

Environment:
  LEGALSERVER_BASE_URL
  LEGALSERVER_BEARER_TOKEN
  LEGALSERVER_TIMEOUT_MS
  DOCUMENT_OCR_PROVIDER
  DOCUMENT_OCR_MODEL
  GOOGLE_CLOUD_PROJECT
  GOOGLE_CLOUD_LOCATION
  GOOGLE_APPLICATION_CREDENTIALS

Examples:
  npm run manual:phase2 -- --case_uuid matter-uuid --document_uuid doc-uuid --query rent
  npm run manual:phase2 -- --case_uuid matter-uuid --document_id 501 --query signature

Notes:
  Phase 2.5 resolves the document binary from document_uuid/document_id first.
  download_url metadata is advisory and does not need to be present for this validation run.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const caseUuid = args.case_uuid || process.env.PHASE2_CASE_UUID;
  const documentUuid = args.document_uuid || process.env.PHASE2_DOCUMENT_UUID;
  const documentId = args.document_id || process.env.PHASE2_DOCUMENT_ID;
  const query = args.query || process.env.PHASE2_QUERY || null;

  if (!caseUuid || (!documentUuid && !documentId)) {
    printUsage();
    throw new Error('case_uuid and one document identifier are required');
  }

  const config = loadConfig(process.env);
  const client = new LegalServerClient({
    baseUrl: config.baseUrl,
    bearerToken: config.bearerToken,
    timeoutMs: config.timeoutMs,
    fetchImpl: global.fetch,
  });
  const documentTextPipeline = createDocumentTextPipeline({
    client,
    config,
    ocrProvider: createOcrProvider(config),
  });
  const registry = createToolRegistry({
    client,
    helpers,
    documentTextPipeline,
  });
  const documentArgs = {
    case_uuid: caseUuid,
    ...(documentUuid ? { document_uuid: documentUuid } : { document_id: documentId }),
  };

  const metadata = await registry.execute('document_get_metadata', documentArgs);
  const manifest = await registry.execute('document_get_text_manifest', documentArgs);

  console.log('\nDocument metadata');
  console.log(JSON.stringify(metadata.data, null, 2));

  console.log('\nText manifest');
  console.log(JSON.stringify(manifest.data, null, 2));
  if (manifest.warnings.length > 0) {
    console.log('\nWarnings');
    console.log(JSON.stringify(manifest.warnings, null, 2));
  }

  if (manifest.data.chunk_count > 0) {
    const firstChunk = await registry.execute('document_get_text_chunk', {
      ...documentArgs,
      chunk_index: 0,
    });

    console.log('\nFirst chunk preview');
    console.log(JSON.stringify({
      chunk_index: firstChunk.data.chunk_index,
      page_start: firstChunk.data.page_start,
      page_end: firstChunk.data.page_end,
      start_char: firstChunk.data.start_char,
      end_char: firstChunk.data.end_char,
      preview: firstChunk.data.text.slice(0, 300),
    }, null, 2));
  }

  if (query) {
    const documentSearch = await registry.execute('document_search_text', {
      ...documentArgs,
      query,
    });
    const matterSearch = await registry.execute('matter_search_document_text', {
      case_uuid: caseUuid,
      query,
    });

    console.log('\nDocument search');
    console.log(JSON.stringify({
      query,
      hit_count: documentSearch.total_records,
      first_hit: documentSearch.data[0] || null,
    }, null, 2));

    console.log('\nMatter search');
    console.log(JSON.stringify({
      query,
      hit_count: matterSearch.total_records,
      first_hit: matterSearch.data[0] || null,
    }, null, 2));
  } else {
    console.log('\nSearch skipped: provide --query or PHASE2_QUERY to validate search tools.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});

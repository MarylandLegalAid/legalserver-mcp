const SERVER_VERSION = '2.1.0';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 25;
const DEFAULT_MAX_CHARS = 6000;
const MAX_MAX_CHARS = 12000;
const PREVIEW_MAX_CHARS = 300;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const DOCUMENT_CHUNK_TARGET_CHARS = 4000;
const DOCUMENT_CHUNK_OVERLAP_CHARS = 400;
const DOCUMENT_CHUNK_BOUNDARY_LOOKBACK_CHARS = 500;
const DOCUMENT_SEARCH_SNIPPET_MAX_CHARS = 600;
const PDF_EMBEDDED_TEXT_MIN_CHARS = 100;

const READ_ONLY_ENDPOINTS = new Set([
  '/api/v1/matters',
  '/api/v1/matters/{case_UUID}',
  '/api/v1/matters/{case_UUID}/notes',
  '/api/v1/matters/{case_UUID}/notes/{casenote_uuid}',
  '/api/v1/matters/{case_UUID}/documents',
  '/api/v1/matters/{case_UUID}/assignments',
  '/api/v1/matters/{case_UUID}/adverse_parties',
  '/api/v1/matters/{case_UUID}/non_adverse_parties',
  '/api/v1/matters/{case_UUID}/contacts',
  '/api/v1/matters/{case_UUID}/related_matters',
  '/api/v1/matters/{case_UUID}/services',
  '/api/v1/matters/{case_UUID}/incomes',
  '/api/v1/matters/{case_UUID}/litigations',
]);

const CANONICAL_TOOL_NAMES = [
  'matter_lookup_by_case_number',
  'matter_get',
  'matter_list_notes',
  'matter_get_note',
  'matter_list_documents',
  'document_get_metadata',
  'document_get_text_manifest',
  'document_get_text_chunk',
  'document_search_text',
  'matter_search_document_text',
  'matter_list_assignments',
  'matter_list_adverse_parties',
  'matter_list_non_adverse_parties',
  'matter_list_contacts',
  'matter_list_related_matters',
  'matter_list_services',
  'matter_list_incomes',
  'matter_list_litigations',
];

module.exports = {
  CANONICAL_TOOL_NAMES,
  DEFAULT_MAX_CHARS,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_TIMEOUT_MS,
  DOCUMENT_CHUNK_BOUNDARY_LOOKBACK_CHARS,
  DOCUMENT_CHUNK_OVERLAP_CHARS,
  DOCUMENT_CHUNK_TARGET_CHARS,
  DOCUMENT_SEARCH_SNIPPET_MAX_CHARS,
  MAX_MAX_CHARS,
  MAX_DOCUMENT_BYTES,
  MAX_PAGE_SIZE,
  PDF_EMBEDDED_TEXT_MIN_CHARS,
  PREVIEW_MAX_CHARS,
  READ_ONLY_ENDPOINTS,
  SERVER_VERSION,
};

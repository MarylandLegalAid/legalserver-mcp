const SERVER_VERSION = '3.0.0';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 25;
const DEFAULT_MAX_CHARS = 6000;
const MAX_MAX_CHARS = 12000;
const PREVIEW_MAX_CHARS = 300;
const EVENT_DATE_FALLBACK_MAX_PAGES = 20;
const TASK_CURRENT_USER_SCAN_MAX_PAGES = 20;
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
  '/api/v1/tasks',
  '/api/v1/tasks/{task_uuid}',
  '/api/v1/events',
  '/api/v1/events/{event_uuid}',
  '/api/v1/contacts',
  '/api/v1/contacts/{contact_UUID}',
  '/api/v1/users',
  '/api/v1/users/{user_uuid}',
  '/api/v1/organizations',
  '/api/v1/organizations/{organization_uuid}',
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
  'task_search',
  'task_get',
  'task_list_on_date',
  'task_list_current_user_on_date',
  'event_search',
  'event_get',
  'event_list_by_date',
  'contact_search',
  'contact_get',
  'contact_lookup_by_email',
  'user_search',
  'user_get',
  'user_lookup_by_login',
  'organization_search',
  'organization_get',
  'organization_lookup_by_name',
];

module.exports = {
  CANONICAL_TOOL_NAMES,
  DEFAULT_MAX_CHARS,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_TIMEOUT_MS,
  EVENT_DATE_FALLBACK_MAX_PAGES,
  TASK_CURRENT_USER_SCAN_MAX_PAGES,
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

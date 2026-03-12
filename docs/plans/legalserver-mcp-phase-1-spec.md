# Phase 1 Spec: Read-Only Matter Core for LegalServer MCP

## Summary

- Build phase 1 as a breaking, canonical-name-only release on the existing `stdio` MCP transport. Keep CommonJS and Node 20+; do not add HTTP transport, OCR, or document text in this phase.
- Ship bar: automated tests with mocked LegalServer responses, a local MCP `list_tools` smoke test, and updated README/LibreChat config examples. No real-site validation is required before merge.
- Phase 1 must replace the prototype's single-file server with a modular read-only core built around explicit v1 `GET` endpoint allowlists.

## Pre-Phase 1

- Restructure into `src/` modules: config loader, `LegalServerClient`, response normalizers, shared envelope/validation helpers, MCP server factory, tool registry, and domain tool modules. Keep `index.js` as a thin bootstrap that only loads env, creates the server, and starts stdio.
- Keep CommonJS. Add `dotenv` loading at startup, keep `LEGALSERVER_BASE_URL` and `LEGALSERVER_BEARER_TOKEN`, and add optional `LEGALSERVER_TIMEOUT_MS` with a `30000` ms default. Fail fast on missing or invalid env.
- Replace the current ad hoc API helper with a GET-only client that accepts an injected `fetch` implementation, validates the base URL, applies the bearer token, and normalizes LegalServer envelope variations such as `data`, `full_data`, raw arrays, and raw objects.
- Encode the read-only allowlist in code. Phase 1 may call only: `GET /api/v1/matters`, `GET /api/v1/matters/{case_UUID}`, `GET /api/v1/matters/{case_UUID}/notes`, `GET /api/v1/matters/{case_UUID}/notes/{casenote_uuid}`, `GET /api/v1/matters/{case_UUID}/documents`, `GET /api/v1/matters/{case_UUID}/assignments`, `GET /api/v1/matters/{case_UUID}/adverse_parties`, `GET /api/v1/matters/{case_UUID}/non_adverse_parties`, `GET /api/v1/matters/{case_UUID}/contacts`, `GET /api/v1/matters/{case_UUID}/related_matters`, `GET /api/v1/matters/{case_UUID}/services`, `GET /api/v1/matters/{case_UUID}/incomes`, and `GET /api/v1/matters/{case_UUID}/litigations`.
- Remove unused prototype dependencies and code paths from phase 1: `pdf-parse`, `mammoth`, `canvas`, `@thednp/dommatrix`, `express`, DOMMatrix polyfill code, and all calls to `/modules/document/download.php`.
- Add one shared tool response contract: `ok`, `data`, `page`, `page_size`, `total_records`, `total_pages`, `truncated`, `warnings`, and `next`. Error responses also include `error_code`, `message`, `status`, and `retry_after` when present. Do not add automatic retries in phase 1.
- Add shared helpers for `page` and `page_size` validation, local array pagination, identifier normalization, HTML-to-text cleanup, preview truncation, and LegalServer error parsing.
- Add repo scripts: `start` for `node index.js`, `test` using `node --test`, and a smoke script that boots the MCP server and verifies `list_tools` output without hitting LegalServer.

## Phase 1 Build Spec

- Canonical phase 1 tool set: `matter_lookup_by_case_number`, `matter_get`, `matter_list_notes`, `matter_get_note`, `matter_list_documents`, `document_get_metadata`, `matter_list_assignments`, `matter_list_adverse_parties`, `matter_list_non_adverse_parties`, `matter_list_contacts`, `matter_list_related_matters`, `matter_list_services`, `matter_list_incomes`, `matter_list_litigations`.
- This is a breaking release. Do not expose `search_case_by_number`, `get_case_info`, `list_case_documents`, or `get_document`. Update docs with a migration table: old search maps to `matter_lookup_by_case_number`, old case info maps to `matter_get`, old document list maps to `matter_list_documents`, and old document text is deferred to phase 2.
- All list tools use `page=1` and `page_size=10` by default, with `page_size` capped at `25`. For API-paginated endpoints, map `page` to LegalServer `page_number`; for array endpoints such as documents and related matters, fetch once and paginate locally.
- `matter_lookup_by_case_number(case_number)` calls `GET /api/v1/matters` with `case_number`, `results=full`, and `page_size=1`. Return only routing fields: `case_uuid`, `case_id`, `case_number`, `case_title`, `client_name`, `case_status`, `case_disposition`, `legal_problem_code`, `date_opened`, and `case_profile_url`.
- `matter_get(case_uuid)` calls `GET /api/v1/matters/{case_UUID}?results=full` and returns a curated matter core only: identifiers, client name/email/phones, status/disposition/close reason, key dates, intake and prescreen fields, legal problem fields, residence and dispute county, language and interpreter fields, household counts, and eligibility summary. Do not return embedded arrays, raw `custom_fields`, or full free-text notes in this tool.
- `matter_list_notes(case_uuid, page, page_size)` calls `GET /api/v1/matters/{case_UUID}/notes`. Return active notes only by default. Each item returns `note_uuid`, `id`, `subject`, `note_type`, `date_posted`, `date_time_created`, `created_by`, `last_update`, `last_updated_by`, `is_html`, `note_has_document_attached`, `active`, `body_preview`, and `body_truncated`.
- `matter_get_note(case_uuid, note_uuid, max_chars=6000)` calls `GET /api/v1/matters/{case_UUID}/notes/{casenote_uuid}`. Strip HTML to `body_text` when `is_html` is true, preserve the `is_html` flag, cap body output at `12000`, and set `truncated` when the body exceeds `max_chars`.
- `matter_list_documents(case_uuid, page, page_size)` calls `GET /api/v1/matters/{case_UUID}/documents`. Return metadata only: `document_uuid` from `guid`, `document_id` from `internal_id`, `name`, `title`, `mime_type`, `size_bytes`, `estimated_tokens`, `date_created`, `date_updated`, `virus_scanned`, `virus_free`, and `folder_id`.
- `document_get_metadata(case_uuid, document_uuid|document_id)` is implemented by querying the matter documents endpoint and selecting the matching record. It returns the same fields as `matter_list_documents` plus `download_url`. It must not download file contents.
- `matter_list_assignments(case_uuid, page, page_size, current_only?, probono_only?, type?)` exposes the three documented filters and returns `assignment_uuid`, `id`, `type`, `start_date`, `end_date`, `date_requested`, `confirmed`, `program`, `office`, `name`, `user`, `assigned_by`, `notes_preview`, and `created_at`.
- `matter_list_contacts(case_uuid, page, page_size)` returns `matter_contact_uuid`, `contact_uuid`, full name, `case_contact_type`, `contact_types`, `phone_business`, and `email`. Do not add contact-detail or global-contact tools in phase 1.
- `matter_list_adverse_parties(case_uuid, page, page_size)` and `matter_list_non_adverse_parties(case_uuid, page, page_size)` return normalized name or organization, relationship type, contact fields, address summary, active/conflict/family flags, and note previews. Do not return raw `ssn`, government IDs, driver's license, visa number, or other high-risk identifier fields.
- `matter_list_related_matters(case_uuid, page, page_size)` returns `relationship_uuid`, `matter_relationship_type`, and a nested `related_matter` object with `case_uuid`, `case_number`, and `matter_name`.
- `matter_list_services(case_uuid, page, page_size, active?, closed?, type?)` exposes only the high-value documented filters and returns `service_uuid`, `id`, `title`, `type`, `start_date`, `end_date`, `closed_by`, `closed`, `active`, `decision`, `funding_code`, and `note_preview`.
- `matter_list_incomes(case_uuid, page, page_size)` returns `income_uuid`, `id`, `type`, `amount`, `period`, `exclude`, and `notes_preview`.
- `matter_list_litigations(case_uuid, page, page_size)` returns `litigation_uuid`, `id`, `court_number`, `court_text`, `caption`, `docket`, `cause_of_action`, `judge`, `outcome`, key dates, `lsc_disclosure_required`, and `notes_preview`.
- For every list tool, any free-text field longer than `300` characters must be converted to a `*_preview` field plus a `*_truncated` boolean. HTML text must be flattened before preview generation. Output keys should consistently use `case_uuid`, `document_uuid`, `note_uuid`, `assignment_uuid`, `service_uuid`, `income_uuid`, and `litigation_uuid`. Do not expose raw LegalServer query passthroughs or raw mixed identifier names.

## Interfaces and Non-Goals

- `LegalServerClient` public API: `getJson(pathTemplate, { pathParams, query, accept })` and `assertReadOnlyEndpoint(pathTemplate)`. No POST, PATCH, or DELETE helpers exist in phase 1.
- `ToolModule` public shape: `{ name, description, inputSchema, budgetPolicy, handler }`. Tool modules are registered centrally; handlers receive `{ client, helpers, args }`.
- Budget policies are fixed in phase 1: list tools `page_size` default `10`, max `25`; detail-text tools `max_chars` default `6000`, max `12000`; preview text fields `300` chars.
- Out of scope for phase 1: document text extraction/search/OCR, client-cross-matter tools, global search across contacts/users/tasks/events, HTTP MCP transport, site-specific custom-field packs, and any POST-only or mutating LegalServer endpoint.

## Test and Ship Plan

- Add unit tests for env validation, base URL normalization, allowlist enforcement, `page` and `page_size` capping, local array pagination, envelope normalization, identifier renaming, HTML stripping, preview truncation, and LegalServer error mapping.
- Add handler tests for every phase 1 tool with mocked fetch fixtures covering success, empty result, `401`, `403`, `404`, `429`, `503`, and mismatched envelope shapes such as `data`, `full_data`, and raw arrays.
- Add an integration test that creates the MCP server in-process, verifies `list_tools`, and executes representative calls for `matter_lookup_by_case_number`, `matter_get`, `matter_list_notes`, `document_get_metadata`, and one paginated subresource tool.
- Add a regression test that asserts the server does not advertise the four legacy tool names and does not reference `/modules/document/download.php`.
- Ship checklist: `npm test` passes, the smoke script confirms the stdio server boots and lists the canonical tools, README is updated with the new tool list and LibreChat `stdio` config example, and README includes the breaking-change migration table plus a sample case-summary agent configuration that uses only phase 1 tools.
- Acceptance criteria: every advertised tool is read-only and backed by a documented v1 `GET` endpoint; no default tool response exceeds `6000` characters; no list tool returns more than `25` items; `document_get_metadata` never downloads file contents; the server starts with only `LEGALSERVER_BASE_URL` and `LEGALSERVER_BEARER_TOKEN` plus optional timeout.

## Assumptions and Defaults

- Keep CommonJS and Node `20+` for phase 1 even though document-text dependencies are being removed; do not add TypeScript or a build step.
- Use mocked LegalServer fixtures for merge readiness; a real-site smoke test is desirable later but not required for phase 1 acceptance.
- Favor portable outputs over org-specific ones: no `custom_fields`, no site-specific field maps, and no embedded phase-4 expert logic.
- LibreChat integration remains a single `stdio` MCP server, consistent with current docs for [MCP Servers](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers) and [MCP Settings](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_settings).

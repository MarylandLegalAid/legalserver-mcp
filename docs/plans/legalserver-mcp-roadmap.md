# Modular Read-Only LegalServer MCP Roadmap

## Summary

- Keep LibreChat integration as a single read-only MCP server first, but refactor the code into a transport-agnostic core. Ship `stdio` first; add `streamable-http` only if you later need per-user auth, centralized ops, or shared caching.
- Do not copy the `@examples` stateful orchestrator/skill pattern into this project. For LibreChat, keep the server stateless and expose many thin, resource-aligned tools; let agent builders select subsets per agent.
- Standardize tool budgets to control context bloat: list/search tools default `page_size=10`, max `25`; text-returning tools default `max_chars=6000`, max `12000`; detail tools omit heavy related arrays when dedicated subresource tools exist; every response includes `truncated`, pagination, and next-step hints when relevant.
- Phase 1 is now defined as a breaking cleanup release: canonical tool names only, mocked-test-plus-manual smoke-test ship bar, and document metadata only. Document text extraction/search moves fully into phase 2.
- Phase 2 is now specified in detail in [docs/plans/legalserver-mcp-phase-2-spec.md](/home/john/repos/legalserver-mcp/docs/plans/legalserver-mcp-phase-2-spec.md): deterministic chunked text access, same-origin read-only document downloads, embedded-text-first extraction with explicit OCR fallback, and a mocked-plus-manual ship bar.
- Phase 2.5 is a production hardening patch defined in [docs/plans/legalserver-mcp-phase-2.5-spec.md](/home/john/repos/legalserver-mcp/docs/plans/legalserver-mcp-phase-2.5-spec.md): identifier-built document download fallback, resilient binary response reading, and clean structured failures when LegalServer exposes unusable binary URLs.

## Implementation Changes

- Split the current [index.js](/home/john/repos/legalserver-mcp/index.js) into a transport-neutral core plus thin transports: `LegalServerClient`, `ToolRegistry`, resource modules, `DocumentTextPipeline`, and an OCR provider interface. Keep the shared read-only token model for now.
- Define a flat tool naming convention by domain: `matter_*`, `document_*`, `task_*`, `event_*`, `contact_*`, `user_*`, `organization_*`, `lookup_*`. Keep one MCP server entry in LibreChat and rely on agent-side tool selection plus `serverInstructions`.
- Pre-phase 1: create a modular GET-only read core, enforce an explicit v1 endpoint allowlist, add shared pagination/truncation/error helpers, remove document-download/text-extraction code, and add automated tests plus a local MCP smoke script.
- Phase 1: foundation + matter core. Ship `matter_lookup_by_case_number`, `matter_get`, `matter_list_notes`, `matter_get_note`, `matter_list_documents`, `document_get_metadata`, `matter_list_assignments`, `matter_list_adverse_parties`, `matter_list_non_adverse_parties`, `matter_list_contacts`, `matter_list_related_matters`, `matter_list_services`, `matter_list_incomes`, and `matter_list_litigations`. Use documented v1 read endpoints only for the portable core and do not preserve the legacy prototype tool names.
- Phase 2: document intelligence. Add `document_get_text_manifest`, `document_get_text_chunk`, `document_search_text`, and `matter_search_document_text`. Add a read-only same-origin binary download helper, `DocumentTextPipeline`, MIME-aware text extraction, and pluggable OCR with Vertex/Gemini first. Treat scanned docs and digital docs the same at the tool surface: manifest + chunk + search, never unbounded full-document dumps. Cache normalized extracted/OCR text per document for the life of the server process and fail explicitly when OCR is required but unavailable.
- Phase 2.5: document download recovery. Keep the phase 2 tool contracts, but replace URL-only binary fetching with identifier-built same-origin download candidates, restore defensive binary body reading from the working legacy implementation, sanitize HTML upstream failures, and make `download_url` advisory instead of required.
- Phase 3: hybrid global discovery. Add `task_search`, `task_get`, `event_search`, `event_get`, `contact_search`, `contact_get`, `user_search`, `user_get`, `organization_search`, `organization_get`, plus focused lookup tools for common filters. Keep all global search tools paginated and filter-first.
- Phase 4: site-specific expert modules. Add optional org-specific packs such as intake, compliance, grant/reporting, or custom-field bundles in a separate module layer, configured by explicit field maps rather than baked into core. Keep them off by default so the base server stays portable and read-only.
- Phase 5: optional remote transport. Add an HTTP MCP wrapper only if you hit one of these triggers: multiple LibreChat deployments, need for centralized telemetry/caching, or a switch to per-user LegalServer auth. Reuse the same core and LibreChat MCP config features for headers, custom user vars, OAuth, and delayed startup.

## Public Interfaces

- `LegalServerClient`: allowlisted non-mutating operations only; reject any endpoint or method not explicitly marked safe. Phase 2 adds a same-origin binary download helper, and phase 2.5 refines it so document downloads are driven by `guid` / `internal_id` first and only secondarily by metadata `download_url`.
- `ToolModule`: `{ name, description, inputSchema, budgetPolicy, handler }` so new resource groups can be added without editing a giant switch.
- `DocumentTextPipeline`: `getManifest(documentRef)`, `getChunk(documentRef, chunkIndex)`, `searchDocument(documentRef, query)`, and `searchMatter(caseUuid, query)`, backed by shared document lookup helpers, MIME-aware `TextExtractor`s, and an `OcrProvider`. Phase 2.5 keeps this interface stable while hardening the download path and response metadata precedence.
- Response envelope: `{ ok, data, page, page_size, total_records, truncated, warnings, next }` for consistent LibreChat agent behavior.

## Test Plan

- Unit tests for URL/query construction, pagination caps, truncation flags, allowlist enforcement, and tool schema registration.
- Fixture tests for TXT, DOCX, digital PDF, scanned PDF/image, oversized documents, unsupported MIME types, empty OCR, repeated chunk retrieval, missing `download_url`, identifier-based download fallback, and sanitized HTML download failures.
- MCP integration tests for `list_tools` and representative calls in each domain, with mocked LegalServer responses and structured error cases.
- LibreChat smoke tests with three agents: case-summary agent using phase 1 tools, document-review agent using phase 2 tools, and operations agent using phase 3 tools.
- Acceptance criteria: no default tool response exceeds `6000` chars; no list/search tool returns more than `25` records by default; phase 1 never downloads document bodies; phase 2 only downloads document bodies through the same-origin read-only helper; phase 2.5 keeps the phase 2 tool contracts while making document retrieval resilient to missing or unusable `download_url` metadata; phase 2 document chunking is deterministic across repeated calls; no tool invokes a mutating LegalServer endpoint; phase 2 and 2.5 ship with automated mocked coverage plus a documented manual validation run.

## Assumptions

- Shared org-managed read-only LegalServer credential remains acceptable for now.
- LibreChat users will be encouraged to build agents by selecting only the tool subsets they need.
- "Read-only" excludes all mutating endpoints and excludes POST-only endpoints by default, even if they appear logically non-mutating; revisit `conflict_check` only after separately confirming you want it.
- Phase 1 intentionally ships without legacy-name aliases and without document text tools; migrating existing LibreChat agents is part of the phase-1 rollout.
- Phase 2 uses embedded-text extraction first and enables Vertex/Gemini OCR as an optional ADC-backed capability; digital-text documents still work when OCR is not configured, but documents that require OCR fail explicitly instead of silently returning no text.
- Phase 2.5 does not introduce new tool names or env vars; it is a reliability patch that stays on same-origin `/modules/document/download.php` and uses the working legacy `main` branch download behavior as the implementation reference.
- The roadmap is grounded in [docs/CoreAPI.v1.yaml](/home/john/repos/legalserver-mcp/docs/CoreAPI.v1.yaml), the current [index.js](/home/john/repos/legalserver-mcp/index.js), the example modular pattern in [examples/src/toolRegistry.js](/home/john/repos/legalserver-mcp/examples/src/toolRegistry.js), and LibreChat's current docs for [MCP Servers](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers) and [MCP Settings](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_settings).

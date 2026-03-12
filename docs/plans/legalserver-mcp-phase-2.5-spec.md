# Phase 2.5 Spec: Robust Document Download Recovery for LegalServer MCP

## Summary

- Phase 2.5 is a patch follow-up to phase 2. Keep the existing MCP tool surface, envelopes, OCR behavior, chunking, and `stdio` transport, but harden how phase 2 acquires document binaries from LegalServer.
- The current modular phase 2 implementation trusts `download_url` metadata and assumes `response.arrayBuffer()` exists. Real-environment validation showed that matter APIs can succeed while document binary retrieval still fails, and the current error path can surface raw HTML pages.
- The reference behavior to restore lives in `git show main:index.js`: the legacy `get_document` path built `/modules/document/download.php` requests directly from `document_uuid` or `document_id`, and it could read binary responses from `arrayBuffer`, `buffer`, streamed readers, or text fallback.
- Ship goal: phase 2 tools must recover when `download_url` is missing, stale, or unusable, and must return clean structured errors when LegalServer still cannot provide a retrievable binary.

## Implementation Changes

- Update the LegalServer client so phase 2 downloads are document-aware instead of URL-only.
  - Add a public helper such as `downloadDocumentBinary(documentRecord, { expectedSizeBytes, maxBytes })`.
  - Candidate URLs are built in this order:
    1. same-origin `/modules/document/download.php?unique_id=<guid>` when `guid` exists
    2. same-origin `/modules/document/download.php?id=<internal_id>` when `internal_id` exists
    3. validated metadata `download_url` when it is same-origin, path-equal to `/modules/document/download.php`, and not a duplicate
  - `download_url` is advisory metadata only. Do not require it for success.
  - Ignore invalid or cross-origin metadata links instead of failing early when identifier-based candidates still exist.
- Replace the current binary-body read path with a resilient helper modeled on `main`.
  - Read response bytes using `arrayBuffer`, then `buffer`, then streamed `body.getReader()`, then `text()` fallback.
  - Return `buffer`, `contentType`, `contentDisposition`, parsed `filename`, `contentLength`, and the successful `url`.
- Sanitize upstream download failures.
  - If the response body is HTML or starts with `<!DOCTYPE` / `<html`, do not pass raw HTML through tool errors.
  - Use concise status-based messages such as `LegalServer document download failed with 404 Not Found.`
  - Retry candidate URLs only on `400`, `401`, `403`, and `404`.
  - Stop immediately on `429`, `503`, timeout, or network errors.
  - If all candidates return `404`, convert the result to `ToolError({ errorCode: 'extraction_failed', status: 502, message: 'LegalServer returned document metadata, but no retrievable allowlisted download URL was available for this document.' })`.
  - If no candidate succeeds and any attempt returns `401` or `403`, surface a sanitized authorization error with the original status.
  - If failures are mixed and none succeed, surface `extraction_failed` with a concise summary rather than raw upstream bodies.
- Update the document text pipeline to consume the new client behavior.
  - Remove the hard requirement that `documentRecord.download_url` exist.
  - Replace direct `downloadBinary(documentRecord.download_url, ...)` usage with `downloadDocumentBinary(documentRecord, ...)`.
  - Resolve document format using this precedence:
    1. downloaded `content-type` when it maps to a known format
    2. filename parsed from `content-disposition`
    3. record `mime_type`
    4. record `name`
    5. record `title`
  - Keep all existing extraction, OCR fallback, caching, chunking, hashing, and search semantics unchanged.
- Keep the same phase 2 tool contracts.
  - No tool additions or renames.
  - No input-schema changes for `document_get_text_manifest`, `document_get_text_chunk`, `document_search_text`, or `matter_search_document_text`.
  - `document_get_metadata` may continue exposing `download_url`, but phase 2.5 must not depend on it internally.
- Update README and the manual runbook language to describe phase 2.5 as a reliability fix.
  - State that the server resolves binaries from document identifiers and treats `download_url` as metadata.
  - State that broken LegalServer download endpoints now fail with clean extraction errors instead of raw HTML.

## Public Interfaces

- `LegalServerClient`
  - Keep the existing read-only JSON interface unchanged.
  - Add `downloadDocumentBinary(documentRecord, options)` as the phase 2.5 path for document downloads.
  - Keep same-origin enforcement limited to `/modules/document/download.php`.
- `DocumentTextPipeline`
  - Continue exposing `getDocumentState({ caseUuid, documentRecord })`.
  - Internally switch to the new document-aware download helper and response metadata precedence.
- MCP tools
  - Preserve existing tool names, schemas, envelopes, and error codes.
  - Improve only reliability and message hygiene for download-related failures.

## Test Plan

- Add client unit coverage for:
  - candidate URL ordering and de-duplication
  - success when `download_url` is absent
  - ignored invalid/cross-origin `download_url`
  - fallback from `unique_id` to `id`
  - HTML error sanitization
  - `arrayBuffer`, `buffer`, streamed-reader, and text fallback body reads
  - all-`404` candidate failures mapping to clean `extraction_failed`
  - authorization failure behavior when all candidates are blocked
- Add document pipeline unit coverage for:
  - successful extraction with identifiers only
  - format recovery from `content-disposition` when `content-type` is generic
  - unchanged OCR and unsupported-media behavior
  - unchanged single-process caching behavior
- Add handler or integration coverage for:
  - phase 2 tool success without `download_url`
  - clean structured errors from broken download endpoints
  - no raw HTML bodies in tool responses
- Ship checklist:
  - `npm test` passes
  - `npm run smoke` still verifies tool advertisement without contacting LegalServer
  - manual real-environment validation succeeds for at least one digital PDF and one DOCX or TXT using the same environment that previously worked on `main`
  - manual validation confirms OCR-required documents still emit `ocr_unavailable` when OCR is disabled and still succeed when OCR is configured
  - README documents the reliability fix and the cleaner failure mode

## Assumptions And Defaults

- Phase 2.5 is a patch release from `2.1.0` to `2.1.1`.
- Keep CommonJS, Node 20+, and the existing `stdio` server entrypoint.
- Do not adopt undocumented alternate document routes such as `/api/v1/documents/{id}` or `/api/v1/documents/{uuid}` as part of the fix. The implementation remains constrained to same-origin `/modules/document/download.php`.
- Do not add new env vars, new transports, raw file download tools, or full-document text dump tools.
- Use `git show main:index.js` as the behavioral reference for candidate download construction and defensive binary reading, but do not restore legacy tool names or the monolithic server structure.

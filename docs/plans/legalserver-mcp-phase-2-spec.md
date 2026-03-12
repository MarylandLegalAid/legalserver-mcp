# Phase 2 Spec: Document Intelligence for LegalServer MCP

## Summary

- Extend phase 1 with document text extraction, chunk retrieval, and text search while keeping the server stateless, CommonJS, Node 20+, and `stdio`.
- Add `document_get_text_manifest`, `document_get_text_chunk`, `document_search_text`, and `matter_search_document_text`.
- Keep all phase 1 tools, but add a `text_strategy` hint to `matter_list_documents` and `document_get_metadata`.
- Use embedded-text extraction first and OCR only when needed. Cache normalized text and chunk tables per document in memory for the life of the process. Do not add a full-document text dump tool.

## Implementation Changes

- Add a dedicated document tool module and wire the registry/server so handlers receive `{ client, helpers, documentTextPipeline, args }`. Keep [index.js](/home/john/repos/legalserver-mcp/index.js) as a thin bootstrap.
- Extract shared document-record helpers so `matter_list_documents`, `document_get_metadata`, and all phase 2 tools resolve and map documents identically.
- Extend config with optional `DOCUMENT_OCR_PROVIDER` (`none` default, `vertex_gemini`), `DOCUMENT_OCR_MODEL` (`gemini-2.5-flash` default), `GOOGLE_CLOUD_PROJECT` (required when OCR is enabled), and `GOOGLE_CLOUD_LOCATION` (`global` default). Keep existing LegalServer env vars unchanged.
- Add a read-only binary download helper in the LegalServer client. It may only fetch same-origin document URLs that resolve to `/modules/document/download.php`; reject any cross-origin or non-allowlisted binary target.
- Add `DocumentTextPipeline` with a process-lifetime `Map` cache keyed by `case_uuid + document_uuid/document_id`. Cache normalized text, chunk metadata, page offsets, and a text hash. Never cache raw file buffers.
- Add extractors:
  - TXT: UTF-8 decode and normalize.
  - DOCX: `mammoth.extractRawText`.
  - PDF: try embedded text first (`pdf-parse`). If normalized non-whitespace text is under `100` chars, treat it as OCR-needed and split it into single-page PDFs with `pdf-lib`.
  - Images: OCR only for `image/png`, `image/jpeg`, and `image/webp`.
  - Everything else: fail with `unsupported_media_type`.
- Add an OCR provider interface `extractPages(pages)` and implement `vertex_gemini` with [`@google/genai`](https://cloud.google.com/vertex-ai/generative-ai/docs/sdks/overview) in Vertex AI `v1` mode using ADC. Do not use `@google-cloud/vertexai`; Google’s current JS docs position `@google/genai` as the forward path and note the older Vertex SDK is deprecated ([overview](https://cloud.google.com/vertex-ai/generative-ai/docs/sdks/overview), [migration/deprecation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/deprecations/genai-vertexai-sdk)).
- OCR request rules: temperature `0`, transcription-only prompt, sequential page processing, and inline base64 bytes for PDF/image input. If OCR is required but not configured, fail explicitly with `error_code: "ocr_unavailable"`.
- Canonical text normalization: convert line endings to `\n`, strip control chars except newline, trim trailing spaces, collapse repeated spaces/tabs inside lines, and collapse `3+` blank lines to `2`. Preserve page boundaries in a page-offset map.
- Deterministic chunking: `chunk_index` is 0-based, `chunk_target_chars=4000`, `chunk_overlap_chars=400`, prefer the last paragraph/newline boundary within `500` chars before the limit, otherwise hard split. Chunking happens once from cached canonical text.
- Search behavior: case-insensitive exact substring search over canonical text. No fuzzy search, stemming, embeddings, or relevance ranking in phase 2. Merge overlapping hit windows and sort hits by document order then `start_char`.
- `matter_search_document_text` scans all matter documents in deterministic order: `date_updated DESC`, then `date_created DESC`, then `document_id ASC`. If any document in scope requires OCR and OCR is unavailable or fails, the whole call fails explicitly rather than returning partial results.
- Update README and package metadata for phase 2, including env vars, new tools, limitations, and a document-review agent example. Add a manual validation script and npm entry such as `npm run manual:phase2` for real-environment verification.

## Public Interfaces

- `matter_list_documents` and `document_get_metadata` add `text_strategy`:
  - `direct` for TXT/DOCX
  - `direct_or_ocr` for PDF
  - `ocr` for supported images
  - `unsupported` otherwise
- `document_get_text_manifest(case_uuid, document_uuid|document_id)` returns:
  - `case_uuid`, `document_uuid`, `document_id`, `name`, `title`, `mime_type`, `size_bytes`
  - `text_source` in `plain_text | docx_text | pdf_text | pdf_ocr | image_ocr`
  - `ocr_provider`, `ocr_model`, `page_count`, `total_text_chars`, `estimated_tokens`, `chunk_count`
  - `chunk_target_chars`, `chunk_overlap_chars`, `first_chunk_index`, `last_chunk_index`, `text_sha256`
  - If extraction succeeds but yields no text, return success with `chunk_count=0`, null first/last chunk, and a warning.
- `document_get_text_chunk(case_uuid, document_uuid|document_id, chunk_index)` returns:
  - `case_uuid`, `document_uuid`, `document_id`, `chunk_index`, `chunk_count`
  - `page_start`, `page_end`, `start_char`, `end_char`, `text`, `text_sha256`
  - Invalid `chunk_index` returns `chunk_out_of_range` with status `400`.
- `document_search_text(case_uuid, document_uuid|document_id, query, page=1, page_size=10)` returns paginated hits:
  - `chunk_index`, `page_number`, `start_char`, `end_char`, `match_count`, `snippet`, `snippet_truncated_before`, `snippet_truncated_after`
  - `query` must trim to at least 2 chars; `page_size` max stays `25`; snippet max length is `600`.
- `matter_search_document_text(case_uuid, query, page=1, page_size=10)` returns the same hit shape plus:
  - `document_uuid`, `document_id`, `name`, `title`, `mime_type`, `date_updated`
- Add a first-class internal tool error type so phase 2 can emit `unsupported_media_type` (`415`), `ocr_unavailable` (`412`), `document_too_large` (`413`), `chunk_out_of_range` (`400`), and `extraction_failed` (`502`) without collapsing to generic `invalid_request`.
- Search with no matches is a normal success envelope with empty `data`.

## Test Plan

- Unit tests for MIME/extension-to-`text_strategy` mapping, same-origin binary download validation, OCR env validation, canonical text normalization, deterministic chunk building, search hit merging, empty-text manifests, and new internal error envelopes.
- Pipeline tests with local fixtures for TXT, DOCX, digital PDF, scanned PDF that forces OCR fallback, supported image OCR, oversized document rejection, unsupported MIME, and repeated manifest/chunk/search calls proving one download/extraction per document per process.
- Handler tests for every new tool with mocked LegalServer responses and a stub OCR provider. Cover success, empty search, `404` document lookup miss, `ocr_unavailable`, `unsupported_media_type`, `chunk_out_of_range`, `429/503` from LegalServer download, and OCR provider failure.
- Integration tests update `list_tools`, verify phase 1 tools still work, and execute representative phase 2 calls end-to-end in-process with mocked fetch plus a fake pipeline/OCR provider.
- Regression tests replace the phase 1 “no download endpoint anywhere” assertion with a narrower rule: only the dedicated binary download helper may reference `/modules/document/download.php`.
- Ship checklist:
  - `npm test` passes
  - `npm run smoke` still verifies tool advertisement without contacting LegalServer
  - the manual phase 2 runbook/script succeeds once on a digital PDF and once on a scanned PDF or image in an OCR-capable environment
  - README documents phase 2 env vars, tool contracts, `text_strategy`, OCR limitations, and a sample document-review agent tool subset

## Assumptions And Defaults

- Phase 2 is a backward-compatible minor release; default version bump is `2.1.0`.
- The server remains single-process and `stdio`; no HTTP transport, DB cache, background worker, or example-orchestrator pattern is added.
- OCR is optional at startup. Digital-text documents work without OCR. Documents that require OCR fail explicitly until `DOCUMENT_OCR_PROVIDER=vertex_gemini` and ADC-backed Google env vars are available.
- Use Vertex AI through `@google/genai` with ADC and `apiVersion: "v1"`; default model is `gemini-2.5-flash` unless overridden by `DOCUMENT_OCR_MODEL`.
- Maximum document size is `50 MB`. If LegalServer metadata omits size, enforce the cap on the downloaded buffer.
- Phase 2 still does not expose raw file downloads, full-document text dumps, fuzzy search, semantic search, or any mutating LegalServer endpoint.

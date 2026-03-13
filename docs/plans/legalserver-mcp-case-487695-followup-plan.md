# Follow-Up Plan: Adjust Document Handling After Case 487695 Live Validation

## Summary
Keep Phase 2.5 download recovery intact. The live corpus on case `487695` showed that real documents download correctly, and Vertex OCR is now validated end to end for scanned PDFs. The current repo still under-serves the dominant document mix and fails too aggressively at the matter level. The next implementation should:
- fix matter document ordering
- make matter-wide search resilient to broken and unsupported documents
- add first-pass extraction support for `.eml` and `.rtf`
- keep single-document tools strict

This follow-up does not need additional OCR configuration work. The remaining gaps are behavioral and format-support related.

This plan is based on the live findings in [docs/plans/legalserver-mcp-case-487695-findings.md](/home/john/repos/legalserver-mcp/docs/plans/legalserver-mcp-case-487695-findings.md).

## Required Behavior Changes
### 1. Keep Phase 2.5 retrieval logic
- Do not revert `downloadDocumentBinary(...)`.
- Keep identifier-first candidate generation and same-origin `/modules/document/download.php` allowlisting in [src/legalserverClient.js](/home/john/repos/legalserver-mcp/src/legalserverClient.js).
- Keep `download_url` as advisory metadata.
- Rationale:
  - real documents download successfully
  - old artifacts still exist and still fail
  - the patch is still the correct protection against stale metadata

### 2. Fix deterministic matter document ordering
- Update `compareMatterSearchOrder(...)` in [src/tools/shared/documentRecords.js](/home/john/repos/legalserver-mcp/src/tools/shared/documentRecords.js) so null dates never produce `NaN`.
- Normalize the sort precedence to:
  1. `date_update` descending when present
  2. `date_create` descending when present
  3. numeric `internal_id` ascending
  4. string `internal_id` ascending
- Implementation rule:
  - if both timestamps are missing, treat that comparison as `0` and continue
  - never return `NaN` from the comparator

### 3. Change matter-wide search to partial success with warnings
- Update `matter_search_document_text` in [src/tools/documents.js](/home/john/repos/legalserver-mcp/src/tools/documents.js) so one bad document does not fail the whole matter search.
- New matter-wide search policy:
  - attempt documents in deterministic order
  - include hits from documents whose extraction succeeds
  - skip documents that fail with:
    - `unsupported_media_type`
    - `ocr_unavailable`
    - `extraction_failed`
    - `document_too_large`
  - return a normal success envelope with `warnings`
- Warning content must be compact and deterministic:
  - include total skipped count
  - include counts by error code
  - include up to 3 sample document IDs/names per error code
- Keep `document_get_text_manifest`, `document_get_text_chunk`, and `document_search_text` strict. If the user explicitly targets one document, that tool should still return the real error for that document.

### 4. Add first-pass `.rtf` extraction support
- Extend format resolution in [src/tools/shared/documentRecords.js](/home/john/repos/legalserver-mcp/src/tools/shared/documentRecords.js) and [src/documentText/index.js](/home/john/repos/legalserver-mcp/src/documentText/index.js) to recognize:
  - `text/rtf`
  - `.rtf`
- Add a new `rtf` extraction path in the document pipeline.
- Extraction policy:
  - convert RTF to plain text
  - preserve paragraph breaks where possible
  - strip control words and formatting markup
  - return `text_source = rtf_text`
- Use a pure-JS RTF-to-text implementation. Avoid shelling out to external binaries.

### 5. Add first-pass `.eml` extraction support
- Extend format resolution to recognize:
  - `application/mbox`
  - `message/rfc822`
  - `.eml`
- Add a new `eml` extraction path in the document pipeline.
- Extraction policy:
  - parse the message as RFC822-style email
  - include selected headers at the top of canonical text:
    - `From`
    - `To`
    - `Cc`
    - `Date`
    - `Subject`
  - prefer `text/plain` body
  - if only HTML is present, convert HTML to plain text
  - ignore binary attachments for the first pass
  - if multiple text bodies exist, join them in stable order with clear separators
  - return `text_source = email_text`
- Treat zero-byte `.eml` records as unsupported/empty and skip them in matter-wide search with warnings.

### 6. Preserve current OCR semantics for single-document tools
- Do not soften `ocr_unavailable` for `document_get_text_manifest` or `document_search_text`.
- The user explicitly asked for one document in those tools, so they should still fail when OCR is required but not configured.
- Do not change the existing OCR provider interface, OCR fallback rules, or Vertex integration in this pass.
- README and manual validation docs should be updated only as needed to make this explicit:
  - born-digital PDFs may succeed without OCR
  - scanned PDFs succeed when OCR is configured and fail explicitly when it is not
  - matter-wide search skips OCR-blocked documents in non-OCR deployments and reports warnings

## Public Interface Impact
- No new tool names.
- No required new env vars.
- Existing tool input schemas remain unchanged.
- `matter_search_document_text` response shape stays compatible:
  - `data`, paging fields, and hit records remain the same
  - `warnings` becomes materially important and may now report skipped documents
- `text_source` gains two new values:
  - `rtf_text`
  - `email_text`

## Tests
### Unit
- Add sort regression coverage proving null `date_update` values do not break descending `date_create` order.
- Add format-resolution coverage for:
  - `text/rtf`
  - `.rtf`
  - `application/mbox`
  - `message/rfc822`
  - `.eml`
- Add extractor tests for:
  - simple RTF text
  - plain-text email
  - HTML-only email body
  - email headers included in canonical text
  - zero-byte email

### Handler / integration
- Add `matter_search_document_text` coverage where one case includes:
  - one searchable PDF
  - one unsupported document
  - one OCR-blocked document
  - one stale-download artifact
- Assert:
  - hits from the searchable PDF are still returned
  - response is success, not failure
  - warnings summarize skipped docs deterministically
- Preserve existing strict single-document failure tests for unsupported/OCR-blocked docs.

### Manual
- Re-run live validation on case `487695` after implementation.
- Required manual checks:
  - born-digital PDF still succeeds
  - scanned PDF still succeeds as `pdf_ocr` in the OCR-configured environment
  - RTF now extracts usable text
  - EML now extracts usable text
  - full-case `matter_search_document_text` no longer fails on the first artifact
  - if OCR is disabled in a separate validation environment, matter-wide search returns partial success with deterministic warnings for OCR-blocked documents instead of failing the whole call

## Defaults And Constraints
- Treat the March 12, 2026 uploads on case `487695` as the canonical validation corpus.
- Do not attempt attachment extraction for email in this pass.
- Do not add OCR auto-fallback or new OCR providers in this pass.
- Do not add new OCR env vars or change the current Vertex credential model in this pass.
- Do not change the single-document tool contract from fail-fast to partial success.

# LegalServer MCP Server

`legalserver-mcp` is a read-only Model Context Protocol server for documented LegalServer v1 matter endpoints. Phase 2.5 keeps the existing `stdio` transport, CommonJS, and Node 20+, and hardens phase 2 document retrieval with identifier-based download recovery, text extraction, chunk retrieval, and deterministic substring search.

Version: `2.1.1`

## Requirements

- Node `20+`
- `LEGALSERVER_BASE_URL`
- `LEGALSERVER_BEARER_TOKEN`
- Optional: `LEGALSERVER_TIMEOUT_MS` (default `30000`)
- Optional OCR:
  - `DOCUMENT_OCR_PROVIDER=vertex_gemini`
  - `DOCUMENT_OCR_MODEL` (default `gemini-2.5-flash`)
  - `GOOGLE_CLOUD_PROJECT` required when OCR is enabled
  - `GOOGLE_CLOUD_LOCATION` (default `global`)

Digital-text TXT, DOCX, and many PDFs work without OCR. Scanned PDFs and supported images fail explicitly with `error_code: "ocr_unavailable"` until OCR is configured.

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Example environment:

```bash
LEGALSERVER_BASE_URL=https://your-site.legalserver.org/
LEGALSERVER_BEARER_TOKEN=xxxxxxxx
LEGALSERVER_TIMEOUT_MS=30000
DOCUMENT_OCR_PROVIDER=none
DOCUMENT_OCR_MODEL=gemini-2.5-flash
GOOGLE_CLOUD_LOCATION=global
```

## Tool Set

Phase 1 matter tools remain available:

- `matter_lookup_by_case_number`
- `matter_get`
- `matter_list_notes`
- `matter_get_note`
- `matter_list_documents`
- `document_get_metadata`
- `matter_list_assignments`
- `matter_list_adverse_parties`
- `matter_list_non_adverse_parties`
- `matter_list_contacts`
- `matter_list_related_matters`
- `matter_list_services`
- `matter_list_incomes`
- `matter_list_litigations`

Phase 2 document intelligence tools:

- `document_get_text_manifest`
- `document_get_text_chunk`
- `document_search_text`
- `matter_search_document_text`

All list/search tools default to `page=1` and `page_size=10`. `page_size` is capped at `25`.

## Document Text Behavior

`matter_list_documents` and `document_get_metadata` now include `text_strategy`:

- `direct` for TXT and DOCX
- `direct_or_ocr` for PDF
- `ocr` for `image/png`, `image/jpeg`, and `image/webp`
- `unsupported` for everything else

Extraction rules:

- TXT: UTF-8 decode and normalize
- DOCX: `mammoth.extractRawText`
- PDF: embedded text first, OCR fallback when normalized embedded text is under `100` non-whitespace chars
- Images: OCR only for PNG, JPEG, and WebP
- Max document size: `50 MB`

The server caches canonical text, chunk metadata, page offsets, and a SHA-256 text hash in memory for the lifetime of the process. It never caches raw document bytes.

Phase 2.5 resolves document binaries from LegalServer document identifiers first:

- same-origin `/modules/document/download.php?unique_id=<guid>`
- same-origin `/modules/document/download.php?id=<internal_id>`
- same-origin allowlisted `download_url` metadata only when present and valid

`download_url` remains visible in `document_get_metadata`, but it is advisory metadata rather than a required internal dependency.

Phase 2 intentionally does not expose:

- raw file downloads
- full-document text dumps
- fuzzy search
- semantic search
- embeddings
- any mutating LegalServer endpoint

## Response Contract

Success responses use one shared envelope:

```json
{
  "ok": true,
  "data": {},
  "page": 1,
  "page_size": 10,
  "total_records": 1,
  "total_pages": 1,
  "truncated": false,
  "warnings": [],
  "next": null
}
```

Errors keep the same shape and add:

```json
{
  "ok": false,
  "error_code": "unsupported_media_type",
  "message": "This document type is not supported for phase 2 text extraction.",
  "status": 415,
  "retry_after": null
}
```

Phase 2 adds first-class internal error codes:

- `unsupported_media_type` (`415`)
- `ocr_unavailable` (`412`)
- `document_too_large` (`413`)
- `chunk_out_of_range` (`400`)
- `extraction_failed` (`502`)

When LegalServer returns a broken document endpoint, phase 2.5 now surfaces clean structured extraction errors instead of passing raw HTML error pages through tool responses.

## Search Semantics

- Case-insensitive exact substring search over canonical text
- No stemming, fuzzy matching, embeddings, or ranking
- Deterministic chunking: `4000` target chars with `400` chars overlap
- Search snippets are capped at `600` chars
- `matter_search_document_text` scans documents in this order:
  - `date_updated DESC`
  - `date_created DESC`
  - `document_id ASC`

If any document in scope requires OCR and OCR is unavailable or fails, the whole matter-wide search fails explicitly instead of returning partial results.

## LibreChat `stdio` Example

```yaml
mcpServers:
  LegalServer:
    command: node
    args:
      - ./custom-tools/legalserver-mcp/index.js
    env:
      LEGALSERVER_BASE_URL: ${LEGALSERVER_BASE_URL}
      LEGALSERVER_BEARER_TOKEN: ${LEGALSERVER_BEARER_TOKEN}
      LEGALSERVER_TIMEOUT_MS: ${LEGALSERVER_TIMEOUT_MS}
      DOCUMENT_OCR_PROVIDER: ${DOCUMENT_OCR_PROVIDER}
      DOCUMENT_OCR_MODEL: ${DOCUMENT_OCR_MODEL}
      GOOGLE_CLOUD_PROJECT: ${GOOGLE_CLOUD_PROJECT}
      GOOGLE_CLOUD_LOCATION: ${GOOGLE_CLOUD_LOCATION}
    description: "Read-only LegalServer matter and document intelligence tools"
    chatMenu: true
```

## Sample Document Review Agent

Use only these tools:

- `matter_lookup_by_case_number`
- `matter_list_documents`
- `document_get_metadata`
- `document_get_text_manifest`
- `document_get_text_chunk`
- `document_search_text`

Example server instructions:

> When the user gives a LegalServer case number, resolve it first. Review only the documents needed for the request. Use `document_get_text_manifest` to understand size and extraction source, retrieve only the required chunks with `document_get_text_chunk`, and prefer `document_search_text` for pinpointed quotes or clause lookup. Do not ask for or expect full-document text dumps.

## Validation

Automated validation:

```bash
npm test
npm run smoke
```

Manual phase 2.5 validation against a real LegalServer environment:

```bash
npm run manual:phase2 -- --case_uuid <matter-uuid> --document_uuid <doc-uuid> --query rent
```

You can also use `--document_id` instead of `--document_uuid`. Run the manual script once on a digital PDF and once on a scanned PDF or supported image in an OCR-capable environment.
The manual script exercises the identifier-first download path, so it remains valid even when `download_url` metadata is absent or stale.

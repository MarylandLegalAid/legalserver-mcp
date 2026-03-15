# LegalServer MCP Server

`legalserver-mcp` is a read-only Model Context Protocol server for documented LegalServer v1 matter, document, and discovery endpoints. This branch is `v3`, which replaces the old `stdio` runtime with a Streamable HTTP server and adds one request-scoped prototype tool for "my tasks" style workflows.

Version: `3.0.0`

## Requirements

- Node `20+`
- `LEGALSERVER_BASE_URL`
- `LEGALSERVER_BEARER_TOKEN`
- Optional: `LEGALSERVER_TIMEOUT_MS` (default `30000`)
- Optional HTTP runtime:
  - `MCP_HTTP_HOST` (default `127.0.0.1`)
  - `MCP_HTTP_PORT` (default `3001`)
  - `MCP_ALLOWED_HOSTS` (comma-separated hostnames for DNS rebinding protection)
  - `MCP_SHARED_SECRET` (recommended for production)
  - `MCP_SHARED_SECRET_HEADER` (default `x-legalserver-mcp-secret`)
  - `LEGALSERVER_USER_EMAIL_HEADER` (default `x-legalserver-user-email`)
- Optional OCR:
  - `DOCUMENT_OCR_PROVIDER=vertex_gemini`
  - `DOCUMENT_OCR_MODEL` (default `gemini-2.5-flash`)
  - `GOOGLE_CLOUD_PROJECT` required when OCR is enabled
  - `GOOGLE_CLOUD_LOCATION` (default `global`)
  - ADC credentials via runtime identity, `gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS`

Digital-text TXT, DOCX, and many PDFs work without OCR. Scanned PDFs and supported images fail explicitly with `error_code: "ocr_unavailable"` until OCR is configured.

## Install

```bash
npm install
```

## Run

```bash
npm start
```

The server starts a Streamable HTTP endpoint at `http://<host>:<port>/mcp` and exposes an unauthenticated health endpoint at `http://<host>:<port>/healthz`.

Example environment:

```bash
LEGALSERVER_BASE_URL=https://your-site.legalserver.org/
LEGALSERVER_BEARER_TOKEN=xxxxxxxx
LEGALSERVER_TIMEOUT_MS=30000
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3001
MCP_ALLOWED_HOSTS=legalserver-mcp,localhost,127.0.0.1
MCP_SHARED_SECRET=replace-me
MCP_SHARED_SECRET_HEADER=x-legalserver-mcp-secret
LEGALSERVER_USER_EMAIL_HEADER=x-legalserver-user-email
DOCUMENT_OCR_PROVIDER=none
DOCUMENT_OCR_MODEL=gemini-2.5-flash
GOOGLE_CLOUD_PROJECT=
GOOGLE_CLOUD_LOCATION=global
GOOGLE_APPLICATION_CREDENTIALS=
```

Use `LEGALSERVER_BEARER_TOKEN`, not `LEGALSERVER_API_TOKEN`.

When `DOCUMENT_OCR_PROVIDER=vertex_gemini`, set `GOOGLE_CLOUD_PROJECT` and ensure ADC is available either from the runtime environment, `gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS`.

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

Phase 3 global discovery tools:

- `task_search`
- `task_get`
- `task_list_on_date`
- `task_list_current_user_on_date`
- `event_search`
- `event_get`
- `event_list_by_date`
- `contact_search`
- `contact_get`
- `contact_lookup_by_email`
- `user_search`
- `user_get`
- `user_lookup_by_login`
- `organization_search`
- `organization_get`
- `organization_lookup_by_name`

All list/search tools default to `page=1` and `page_size=10`. `page_size` is capped at `25`.
Exact-match convenience lookups return `404 not_found` when no exact match exists and `409 multiple_matches` when more than one exact match is found.
Some LegalServer tenants reject the documented `/api/v1/events?date=...` filter. When that happens, `event_search` and `event_list_by_date` fall back to a bounded local date filter over descending event pages and emit warnings describing the scanned window.

## Document Text Behavior

`matter_list_documents` and `document_get_metadata` now include `text_strategy`:

- `direct` for TXT, DOCX, RTF, and EML
- `direct_or_ocr` for PDF
- `ocr` for `image/png`, `image/jpeg`, and `image/webp`
- `unsupported` for everything else

Extraction rules:

- TXT: UTF-8 decode and normalize
- DOCX: `mammoth.extractRawText`
- RTF: in-process plain-text conversion with paragraph preservation where possible
- EML: RFC822-style header/body extraction, `text/plain` preferred, HTML converted to plain text
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

Phase 3 also intentionally does not expose:

- raw `custom_fields`
- raw sort passthroughs

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

First-class internal error codes:

- `unsupported_media_type` (`415`)
- `ocr_unavailable` (`412`)
- `document_too_large` (`413`)
- `chunk_out_of_range` (`400`)
- `extraction_failed` (`502`)
- `multiple_matches` (`409`)
- `missing_user_context` (`400`)
- `user_context_unresolved` (`404`)

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

`matter_search_document_text` now returns partial success when some documents cannot be searched. Unsupported, OCR-blocked, oversized, and broken-download documents are skipped and summarized in `warnings`.
`event_search` and `event_list_by_date` prefer LegalServer's native `date` filter when the tenant supports it. If the API returns `invalid_search_keys=date`, the server retries without that key, scans descending event pages, filters by the event's local start/end date, and marks the response with warnings. When the scan hits its `20`-page safety cap, `truncated=true` and pagination counts reflect the scanned window only.

## Docker Compose Deployment

For the production path, run the MCP as a private Docker Compose service on the same network as LibreChat instead of as a host process reached through `host.docker.internal`.

For a full step-by-step walkthrough, see [`docs/librechat-docker-compose-deployment.md`](./docs/librechat-docker-compose-deployment.md).

Example service block:

```yaml
services:
  legalserver-mcp:
    build:
      context: ./custom-tools/legalserver-v2
    env_file:
      - ./custom-tools/legalserver-v2/.env
    expose:
      - "3001"
    restart: unless-stopped

  api:
    depends_on:
      legalserver-mcp:
        condition: service_healthy
```

Recommended MCP env file for that service:

```dotenv
LEGALSERVER_BASE_URL=https://your-site.legalserver.org/
LEGALSERVER_BEARER_TOKEN=xxxxxxxx
LEGALSERVER_TIMEOUT_MS=30000
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3001
MCP_ALLOWED_HOSTS=legalserver-mcp,localhost,127.0.0.1
MCP_SHARED_SECRET=replace-me
MCP_SHARED_SECRET_HEADER=x-legalserver-mcp-secret
LEGALSERVER_USER_EMAIL_HEADER=x-legalserver-user-email
```

The MCP service should not publish a host port in the production Compose deployment.

## LibreChat Streamable HTTP Example

```yaml
mcpSettings:
  allowedDomains:
    - "http://legalserver-mcp:3001"

mcpServers:
  LegalServer:
    type: streamable-http
    url: "http://legalserver-mcp:3001/mcp"
    headers:
      X-LegalServer-Mcp-Secret: "${LEGALSERVER_MCP_SHARED_SECRET}"
      X-LegalServer-User-Email: "{{LIBRECHAT_USER_EMAIL}}"
    description: "Read-only LegalServer matter, document, discovery, and current-user task tools"
    chatMenu: true
```

Use a YAML-defined LibreChat MCP server for this setup. LibreChat documents built-in user placeholders such as `{{LIBRECHAT_USER_EMAIL}}` for YAML-configured remote MCP servers; UI-created servers intentionally do not support those built-in user fields.

The forwarded email header is trusted request context, not standalone authentication. This branch adds an optional shared secret header for service-to-service authentication; keep the HTTP endpoint private to LibreChat even when that shared secret is enabled.

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

## Sample Operations Agent

Use only these tools:

- `task_list_on_date`
- `task_list_current_user_on_date`
- `event_list_by_date`
- `contact_lookup_by_email`
- `user_lookup_by_login`
- `organization_lookup_by_name`

Example server instructions:

> Use `task_list_current_user_on_date` for "my tasks" questions. Use the exact-match lookup tools first when the user provides a contact email, user login, or organization name. For broader workload and calendar questions, prefer `task_list_on_date` and `event_list_by_date` before broader search tools.

## Validation

Automated validation:

```bash
npm test
npm run smoke
docker build -t legalserver-mcp .
```

Manual HTTP validation against a real LegalServer environment:

```bash
npm start
```

Then verify the endpoint and a scoped task call through LibreChat or any MCP client that can set HTTP headers:

```bash
curl -i http://127.0.0.1:3001/healthz
curl -i http://127.0.0.1:3001/mcp
```

The `healthz` check should return `200`, and the `/mcp` check should return `405 Method Not Allowed`. For a real MCP call, use a Streamable HTTP MCP client and set both `X-LegalServer-Mcp-Secret` and `X-LegalServer-User-Email`.
The manual script exercises the identifier-first download path, so it remains valid even when `download_url` metadata is absent or stale.

Manual phase 3 validation against a real LegalServer environment:

```bash
npm run manual:phase3 -- --contact_email <email> --user_login <login> --organization_name "<org>" --task_date <yyyy-mm-dd> --event_date <yyyy-mm-dd>
```

If the target tenant rejects the documented event `date` search key, the manual script will still succeed via the bounded fallback path and will print the emitted warnings.

Recommended LibreChat cutover checks:

- keep only one LegalServer MCP server enabled in `librechat.yaml`
- confirm a non-user-scoped tool such as `contact_lookup_by_email` works over HTTP
- confirm `task_list_current_user_on_date` works for a signed-in LibreChat user
- confirm the MCP container is healthy and no host port is published

# LegalServer MCP

`legalserver-mcp` is a Streamable HTTP MCP server exposing read-only [LegalServer](https://www.legalserver.org/) matter, document, discovery, and current-user tools to any MCP client (LibreChat, Claude, etc.). It's generic across LegalServer tenants — point it at your own `LEGALSERVER_BASE_URL` and bearer token, no org-specific code required.

This is developed and run in production by [Maryland Legal Aid](https://www.mdlab.org/); it's open sourced because other legal aid organizations and LegalServer customers may find it useful too. Org-specific customizations (branding, document generation on your own letterhead, etc.) are expected to live in your own private deployment, layered on top as separate MCP services — not in this repo.

Version: `3.0.0`

## Requirements

- Node `20+`
- `poppler-utils` (provides `pdftoppm`) — only needed for OCR, which is not supported yet; the container image installs it
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
  - `LEGALSERVER_CURRENT_USER_EVENTS_REPORT_URL` (optional Reports API URL for current-user event tools)
  - `LEGALSERVER_CURRENT_USER_TASKS_REPORT_URL` (optional Reports API URL for current-user task tools)
  - `LEGALSERVER_CURRENT_USER_MATTERS_REPORT_URL` (optional Reports API URL for `matter_list_current_user` / `matter_list_current_user_active`)
  - `MATTER_CURRENT_USER_CACHE_TTL_MS` (default `60000`, `0` disables current-user matter caching)
  - `MATTER_CURRENT_USER_FETCH_CONCURRENCY` (default `4`, max `8`)
- OCR: **not supported in this release.** Leave `DOCUMENT_OCR_PROVIDER=none` — see [OCR Is Not Supported Yet](#ocr-is-not-supported-yet).

TXT, DOCX, RTF, EML, and PDFs that carry an embedded text layer all extract without OCR. Scanned PDFs and image documents fail explicitly with `error_code: "ocr_unavailable"` (`412`).

## Install

```bash
npm install
```

## Run

```bash
npm start
```

The service exposes:

- `http://<host>:<port>/legalserver/mcp`
- `http://<host>:<port>/healthz`

The original `/mcp` LegalServer endpoint remains as a compatibility alias during migration.

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
LEGALSERVER_CURRENT_USER_EVENTS_REPORT_URL=
LEGALSERVER_CURRENT_USER_TASKS_REPORT_URL=
LEGALSERVER_CURRENT_USER_MATTERS_REPORT_URL=
MATTER_CURRENT_USER_CACHE_TTL_MS=60000
MATTER_CURRENT_USER_FETCH_CONCURRENCY=4
# Reserved for a future release. OCR is not supported yet — leave these as-is.
DOCUMENT_OCR_PROVIDER=none
DOCUMENT_OCR_MODEL=gpt-5.6-luna
OPENAI_API_KEY=
```

Use `LEGALSERVER_BEARER_TOKEN`, not `LEGALSERVER_API_TOKEN`.

## OCR Is Not Supported Yet

OCR is a planned future feature. It is **not supported in this release**, and `DOCUMENT_OCR_PROVIDER` should be left at `none`.

Documents that would require OCR fail cleanly rather than silently returning empty text:

- scanned PDFs with no embedded text layer (under `100` non-whitespace chars) → `error_code: "ocr_unavailable"` (`412`)
- `image/png`, `image/jpeg`, and `image/webp` documents → `error_code: "ocr_unavailable"` (`412`)

One consequence worth knowing: `matter_search_document_text` treats `ocr_unavailable` as a skippable per-document error, so a matter-wide search across scanned documents succeeds while quietly omitting them. The skipped documents are listed in `warnings` — read that field before treating a matter-wide search as exhaustive.

The repo carries unreleased OpenAI provider scaffolding behind `DOCUMENT_OCR_PROVIDER=openai`. That code is not run in production and is not covered end to end by tests, so the server **refuses to start** if `DOCUMENT_OCR_PROVIDER` is set to anything other than `none` — a misconfiguration fails loudly at boot rather than half-working at request time. Treat `DOCUMENT_OCR_MODEL` and `OPENAI_API_KEY` as reserved.

### When OCR ships, Zero Data Retention is your responsibility

Enabling OCR will not be purely a configuration change, so it is worth understanding the data-handling model **before** you plan for it.

OCR works by sending page images of scanned client documents to a cloud vision model. For legal aid work those pages routinely contain client names, addresses, immigration status, medical details, and financial information. Three separate controls govern what happens to them, and **this server can only enforce two**:

| What it protects against | Mechanism | Enforced by |
| --- | --- | --- |
| The page becoming a retrievable stored object (dashboard logs, API-side conversation state, evals) | `store: false` on every request | this server, unconditionally |
| A third party seeing the page en route | Requests go directly to `api.openai.com`, never through a proxy or router | this server |
| The page being retained in abuse-monitoring logs | A **Zero Data Retention (ZDR)** agreement on your own OpenAI account — with one carve-out, below | **you, the operator** |

The third row is the one that actually keeps scanned client documents out of a vendor's retention window, and **no setting in this repository can provide it**. `store: false` is not zero retention: it stops the request being kept as something anyone can pull back up, but on a standard account the payload is still retained for OpenAI's abuse-monitoring window. Only a ZDR agreement negotiated on your account changes that.

If you are handling privileged or otherwise confidential client material, arrange ZDR (and, where applicable, a BAA) with OpenAI **before** you enable OCR — not after. If you cannot, leave `DOCUMENT_OCR_PROVIDER=none`; failing on scanned documents is the safer outcome.

#### The carve-out ZDR does not close

Image and file inputs are treated differently from text. Per OpenAI's [data controls documentation](https://developers.openai.com/api/docs/guides/your-data), every image submitted to the API is scanned for CSAM on submission, and if the classifier flags one, **that image is retained for manual human review even when Zero Data Retention, Modified Abuse Monitoring, or Eyes Off is enabled**. No agreement closes this path.

For legal aid this deserves more than a footnote, because the false-positive surface is not hypothetical. Custody and guardianship filings, abuse and neglect records, CPS paperwork, pediatric medical records, and immigration files with photographs of children are ordinary legal aid documents. A scanned page from any of them is an image input like any other. If a classifier flags one, a privileged client document reaches a human reviewer outside your organization.

There is no configuration that prevents this, and this repository cannot mitigate it. It is a reason to scope which documents get OCR'd rather than enabling it matter-wide by default, and it is worth raising with your own counsel before turning OCR on. Separately, if you operate outside the US, image input may additionally require approval for enhanced ZDR or enhanced Modified Abuse Monitoring — check before assuming your existing agreement covers it.

This is also why OpenAI is the only OCR vendor this server will support. Earlier revisions carried `openrouter` and `vertex_gemini` providers; both have been removed. A router proxies page images to whichever model you name, which puts them outside an agreement scoped to a single vendor — and a one-word change in an `.env` file is too small a gap between a compliant deployment and a non-compliant one. Setting either value now fails at boot with a message saying so.

One more thing to weigh: OCR text is transcribed verbatim and handed to the calling agent. A scanned page containing text that reads as instructions will be transcribed and enter the agent's context as content. This is already true of DOCX and PDF text today, but OCR extends it to documents nobody has ever read as text.

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
- `task_list_current_user_between_dates`
- `event_get`
- `event_list_current_user_on_date`
- `event_list_current_user_between_dates`
- `contact_search`
- `contact_get`
- `contact_lookup_by_email`
- `user_search`
- `user_get`
- `user_get_current`
- `user_list_current_user_supervisors`
- `user_lookup_by_login`
- `organization_search`
- `organization_get`
- `organization_lookup_by_name`
- `matter_list_current_user`
- `matter_list_current_user_active`

**Disabled for this release**: `event_search` and `event_list_by_date`. Both fall back to a
tenant date-filter workaround that scans event pages when the documented `/api/v1/events?date=...`
filter is rejected, and both were measured too slow to be useful (median ~2.0s and ~21.9s, worst
case ~22.2s — see `docs/tool-latency.md`). No LegalServer Reports API replacement exists for
either yet. The implementations are commented out (not deleted) in
`src/apps/legalserver/tools/events.js`; re-enable there once a report-backed alternative exists
(remove them from `CANONICAL_TOOL_NAMES` in `constants.js` too, or the tool-count tests will fail).

All list/search tools default to `page=1` and `page_size=10`. `page_size` is capped at `25`.
Exact-match convenience lookups return `404 not_found` when no exact match exists and `409 multiple_matches` when more than one exact match is found.
When `LEGALSERVER_CURRENT_USER_EVENTS_REPORT_URL` is set, `event_list_current_user_on_date` and `event_list_current_user_between_dates` use that LegalServer Reports API URL with `filter[person_email]` set from the forwarded current-user email header, then apply the requested date window locally. The URL should be tenant-specific and kept in `.env` because it contains a report API key.
When `LEGALSERVER_CURRENT_USER_TASKS_REPORT_URL` is set, `task_list_current_user_on_date` and `task_list_current_user_between_dates` use that report with `filter[todo_users_email]` set from the forwarded email. Due Date, completion, and optional deadline filters are applied locally; only user scoping is sent to the Reports API. Report-backed ranges are limited only by the report's configured window. The legacy API fallback retains its seven-day cap and uses LegalServer's native `list_date` filter.
When `LEGALSERVER_CURRENT_USER_MATTERS_REPORT_URL` is set, `matter_list_current_user` and `matter_list_current_user_active` use that report with `filter[person_email]` set from the forwarded email; only user scoping is sent to the Reports API, and `assignment_type`/`case_disposition`/`current_only`/`legal_problem_code` are all applied locally against the returned rows. The report is expected to return one row per (matter, assignment) pair for the user, so `matching_assignments` is built by grouping rows on `unique_id`; because the report doesn't carry assignment IDs, confirmation status, or notes, report-backed `matching_assignments` entries only include `type`/`start_date`/`end_date` (use `matter_get`/`matter_list_assignments` for full assignment detail on a specific matter). Without this report configured, both tools fall back to the paginated `/api/v1/matters` scan (see Benchmarking below for why that fallback can be slow).

## Benchmarking

The repo includes a production-safe benchmark harness for measuring MCP tool latency and identifying workflows that may be better served by the LegalServer Reports API.

Commands:

```bash
npm run benchmark:discover
npm run benchmark:tools
```

`benchmark:discover` uses the configured LegalServer API credentials to auto-discover representative production fixtures and writes them to `.bench/fixtures.local.json`.
`benchmark:tools` reuses that fixture manifest, runs each tool through the local Streamable HTTP MCP server, records both end-to-end MCP latency and underlying LegalServer request timing, writes raw results under `.bench/results/`, and updates [`docs/tool-latency.md`](./docs/tool-latency.md) with a sanitized summary.

The benchmark harness is intentionally sequential, inserts a pause between samples, and aborts after repeated `429` or `503` responses. `.bench/` is gitignored because raw fixture manifests and request traces may contain production identifiers.

Custom report recommendations in the benchmark output are intentionally conservative:

- strong candidates are row-oriented tools that fan out across many LegalServer requests or rely on bounded local filtering
- unlikely candidates are direct detail endpoints and document-text workflows that depend on binaries, OCR, or full-text search

When evaluating report replacements, keep the reports narrow and filtered. LegalServer documents the Reports API as suitable for filtered report retrieval, while large or long-running exports should move to Data Export instead.

## Document Text Behavior

`matter_list_documents` and `document_get_metadata` now include `text_strategy`:

- `direct` for TXT, DOCX, RTF, and EML
- `direct_or_ocr` for PDF
- `ocr` for `image/png`, `image/jpeg`, and `image/webp`
- `unsupported` for everything else

`text_strategy` describes what a document *would* need, not what this release can do. Because [OCR is not supported yet](#ocr-is-not-supported-yet), a `text_strategy` of `ocr` always fails with `ocr_unavailable`, and `direct_or_ocr` succeeds only when the PDF has an embedded text layer.

Extraction rules:

- TXT: UTF-8 decode and normalize
- DOCX: `mammoth.extractRawText`
- RTF: in-process plain-text conversion with paragraph preservation where possible
- EML: RFC822-style header/body extraction, `text/plain` preferred, HTML converted to plain text
- PDF: embedded text only; a PDF whose normalized embedded text is under `100` non-whitespace chars is treated as scanned and fails with `ocr_unavailable`
- Images: PNG, JPEG, and WebP are recognized but always fail with `ocr_unavailable`
- Max document size: `50 MB`

The server caches canonical text, chunk metadata, page offsets, and a SHA-256 text hash in memory for the lifetime of the process. It never caches raw document bytes.

When OCR ships, scanned PDF pages will be rendered to PNG with `pdftoppm` at 300 DPI, one image per page, so that page numbers on search hits stay accurate. The PDF is piped to `pdftoppm` on stdin and the image read back from stdout, so no part of a client document is written to disk.

Phase 2.5 resolves document binaries from LegalServer document identifiers first:

- same-origin `/modules/document/download.php?unique_id=<guid>`
- same-origin `/modules/document/download.php?id=<internal_id>`
- same-origin allowlisted `download_url` metadata only when present and valid

`download_url` remains visible in `document_get_metadata`, but it is advisory metadata rather than a required internal dependency.

Phase 2 intentionally does not expose:

- OCR for scanned PDFs and image documents (planned future feature — see [OCR Is Not Supported Yet](#ocr-is-not-supported-yet))
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
- `ocr_unavailable` (`412`) — returned for every scanned PDF and image document, since OCR is not supported in this release
- `document_too_large` (`413`)
- `chunk_out_of_range` (`400`)
- `extraction_failed` (`502`)
- `multiple_matches` (`409`)
- `missing_user_context` (`400`)
- `user_context_unresolved` (`404`)
- `assignment_visibility_unavailable` (`412`)

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
`event_search` and `event_list_by_date` (both disabled for this release — see above) prefer LegalServer's native `date` filter when the tenant supports it. If the API returns `invalid_search_keys=date`, the server retries without that key, scans descending event pages, filters by the event's local start/end date, and marks the response with warnings. When the scan hits its `20`-page safety cap, `truncated=true` and pagination counts reflect the scanned window only.

## Deployment

The root package and Dockerfile deploy this service as a single process. On Render, run it as a private service with health check path `/healthz`; the server accepts Render's injected `PORT` variable. It should not be publicly reachable — put it on the same private network as your LibreChat (or other MCP client) deployment and, if you need defense in depth beyond network isolation, set `MCP_SHARED_SECRET`.

For the older private Docker Compose deployment model, see [`docs/librechat-docker-compose-deployment.md`](./docs/librechat-docker-compose-deployment.md).

Example service block:

```yaml
services:
  legalserver-mcp:
    build: .
    env_file: .env
    expose:
      - "3001"
    restart: unless-stopped
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
MATTER_CURRENT_USER_CACHE_TTL_MS=60000
MATTER_CURRENT_USER_FETCH_CONCURRENCY=4
```

When using Compose, the MCP service should not publish a host port unless external access is intentional.

## LibreChat Streamable HTTP Example

```yaml
mcpSettings:
  allowedDomains:
    - "http://legalserver-mcp:3001"

mcpServers:
  LegalServer:
    type: streamable-http
    url: "http://legalserver-mcp:3001/legalserver/mcp"
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

- `task_list_current_user_on_date`
- `task_list_current_user_between_dates`
- `event_list_current_user_on_date`
- `event_list_current_user_between_dates`
- `matter_list_current_user`
- `matter_list_current_user_active`
- `user_get_current`
- `contact_lookup_by_email`
- `user_lookup_by_login`
- `organization_lookup_by_name`

Example server instructions:

> When the user says "my", prefer the current-user tools that rely on the forwarded LegalServer email header. Use `task_list_current_user_on_date` and `task_list_current_user_between_dates` for workload questions, `event_list_current_user_on_date` and `event_list_current_user_between_dates` for schedule questions, `matter_list_current_user_active` for active assigned-matter questions, `matter_list_current_user` when the user explicitly wants all or historical assigned matters, and `user_get_current` for profile questions. Use the exact-match lookup tools first when the user provides a contact email, user login, or organization name.

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
curl -i http://127.0.0.1:3001/legalserver/mcp
```

The `healthz` check should return `200`, and the MCP endpoint should return `405 Method Not Allowed` for a plain GET. For a real MCP call, use a Streamable HTTP MCP client with the endpoint's configured secret header. LegalServer current-user calls also require `X-LegalServer-User-Email`.
The manual script exercises the identifier-first download path, so it remains valid even when `download_url` metadata is absent or stale.

Manual phase 3 validation against a real LegalServer environment:

```bash
npm run manual:phase3 -- --contact_email <email> --user_login <login> --organization_name "<org>" --current_user_email <email> --task_date <yyyy-mm-dd> --event_date <yyyy-mm-dd> --range_start_date <yyyy-mm-dd> --range_end_date <yyyy-mm-dd>
```

If the target tenant rejects the documented event `date` search key, the manual script will still succeed via the bounded fallback path and will print the emitted warnings.

Recommended LibreChat cutover checks:

- keep only one LegalServer MCP server enabled in `librechat.yaml`
- confirm a non-user-scoped tool such as `contact_lookup_by_email` works over HTTP
- confirm current-user workload/calendar tools work for a signed-in LibreChat user
- confirm the MCP container is healthy and no host port is published

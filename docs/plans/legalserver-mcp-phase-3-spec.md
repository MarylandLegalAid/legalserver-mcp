# Phase 3 Spec: Hybrid Global Discovery for LegalServer MCP

## Summary

- Extend `v2.1.1` to `v2.2.0` as a backward-compatible minor release.
- Keep CommonJS, Node 20+, `stdio`, the current response envelope, and the shared org-managed read-only bearer token.
- Add cross-matter read-only discovery for tasks, events, contacts, users, and organizations.
- Ship the generic search/get pairs plus a lean convenience layer: `task_list_on_date`, `event_list_by_date`, `contact_lookup_by_email`, `user_lookup_by_login`, and `organization_lookup_by_name`.
- Do not add any implicit "current user" tools in phase 3. The shared-token model makes that misleading; auth-aware shortcuts stay out of scope until a later phase.

## Implementation Changes

- Extend the read-only allowlist with:
  - `GET /api/v1/tasks`, `GET /api/v1/tasks/{task_uuid}`
  - `GET /api/v1/events`, `GET /api/v1/events/{event_uuid}`
  - `GET /api/v1/contacts`, `GET /api/v1/contacts/{contact_UUID}`
  - `GET /api/v1/users`, `GET /api/v1/users/{user_uuid}`
  - `GET /api/v1/organizations`, `GET /api/v1/organizations/{organization_uuid}`
- Add one tool module per domain and register them alongside the existing matter/document modules. Extract a shared API-paginated search helper first instead of duplicating the matter-only list pattern across five files.
- Keep API-backed searches paginated by LegalServer. Do not fetch all pages for normal search tools; only the exact-match lookup tools may walk multiple pages to prove `0`, `1`, or `2+` exact matches, except for the bounded event-date fallback scan documented below.
- Add shared normalizers for nested refs used across tasks, events, users, and organizations:
  - user ref: `user_uuid`, `id`, `name`
  - organization ref: `organization_uuid`, `id`, `name`
  - matter ref: `case_uuid`, `case_id`, `case_number`, `case_title`
  - task/event module ref: `module_type`, `id`, `uuid`, `label`
- Do not expose raw `custom_fields` passthroughs or raw `sort` passthroughs in phase 3.
- Add one shared exact-match lookup helper:
  - trim all input
  - compare email and login case-insensitively
  - compare organization name case-insensitively with internal whitespace collapsed
  - return `404 not_found` when no exact match exists
  - return `409 multiple_matches` when more than one exact match exists
- Treat the bundled LegalServer OpenAPI YAML as advisory for event-date search. If `/api/v1/events` rejects the documented `date` key with `invalid_search_keys=["date"]`, the server must:
  - surface that upstream detail cleanly in structured errors
  - fall back for `event_search(date=...)` and `event_list_by_date(...)` to a bounded local-date scan over `/api/v1/events?sort=desc`
  - keep any remaining supported event filters server-side during that fallback
  - scan at most `20` upstream pages (`500` events max at the phase 3 page cap)
  - set `truncated=true` and warning text when the scan window is incomplete, with counts and next-page hints understood to reflect the scanned window only
- Update README, package metadata, the smoke script, and MCP integration coverage to advertise the expanded tool list and a phase 3 operations-agent subset.
- Add a manual validation script such as `npm run manual:phase3` for live checks against one known contact email, one user login, one organization name, one task date, and one event date.

## Public Interfaces

- New tools:
  - `task_search`, `task_get`, `task_list_on_date`
  - `event_search`, `event_get`, `event_list_by_date`
  - `contact_search`, `contact_get`, `contact_lookup_by_email`
  - `user_search`, `user_get`, `user_lookup_by_login`
  - `organization_search`, `organization_get`, `organization_lookup_by_name`
- `task_search`
  - Inputs: `page`, `page_size`, `id`, `title`, `active`, `completed`, `deadline`, `task_type`, `deadline_type`, `list_date`, `users`, `module`, `module_id`
  - Tasks and deadlines stay in the same tool family; `deadline` is an explicit filter, not a separate tool.
  - Output summary: identifiers, title, active/completed flags, list/due/completed dates, task/deadline type fields, assigned user refs, module ref, office, program, created/completed by
  - Exclusions: `custom_fields`
- `task_get(task_uuid)`
  - UUID only
  - Returns the task summary shape plus `private`, `statute_of_limitations`, full normalized `users`, and the full normalized `module` object
- `task_list_on_date(date, page, page_size, completed=false, deadline?)`
  - Exact wrapper over `task_search(list_date=...)`
  - `date` must be ISO `YYYY-MM-DD`
  - Returns the same shape as `task_search`
- `event_search`
  - Inputs: `page`, `page_size`, `title`, `location`, `court`, `date`, `matter`, `external_id`
  - Map `matter` to LegalServer's `matters` query parameter.
  - Prefer LegalServer's native `date` filter when accepted. If the tenant rejects `date`, retry without that key and locally filter by the event's local start/end date over a bounded descending scan, preserving the other supported filters server-side.
  - Output summary: identifiers, title, start/end, all-day/privacy/front-desk flags, location, courtroom, court ref, judge, event type, office, program, attendee count, matter count
- `event_get(event_uuid)`
  - Returns the event summary shape plus normalized `attendees`, `matters`, and `outreaches`
- `event_list_by_date(date, page, page_size)`
  - Wrapper over `event_search(date=...)`
  - `date` must be ISO `YYYY-MM-DD`
  - If the tenant rejects the documented `date` key, use the same bounded fallback scan as `event_search(date=...)` and emit warnings describing that fallback
- `contact_search`
  - Inputs: `page`, `page_size`, `first`, `middle`, `last`, `organization_name`, `type`, `email`, `phone_business`, `contact_uuid`
  - Always call LegalServer with `results=full`; do not surface the API `results` switch because it changes response shape.
  - Output summary: `contact_uuid`, `id`, `full_name`, `active`, `types`, `email`, business/mobile/home phones, work address summary, office, `user_profile_exists`, `user_uuid`
- `contact_get(contact_uuid)`
  - UUID only
  - Returns the summary shape plus salutation, bar number, language, email/mail allow flags, gender, full normalized work address, and `date_created`
  - Exclusions: `custom_fields`
- `contact_lookup_by_email(email)`
  - Exact email lookup returning a routing payload, not a full detail payload: `contact_uuid`, `id`, `full_name`, `email`, `phone_business`, `user_profile_exists`, `user_uuid`
- `user_search`
  - Inputs: `page`, `page_size`, `user_uuid`, `id`, `first`, `middle`, `last`, `email`, `login`, `active`, `current`, `role`, `office`, `program`, `bar_number`, `external_unique_id`
  - Output summary: `user_uuid`, `id`, `full_name`, `login`, `email`, active/current/contact flags, types, role, office, program, additional offices/programs, bar number, languages, preferred/business/mobile phones, `contact_uuid`, `external_unique_id`
- `user_get(user_uuid)`
  - UUID only
  - Returns the summary shape plus `organization_affiliations`, `supervisors`, and `supervisees` when LegalServer includes them
  - Exclusions: home/work/mailing address objects, hourly rate, vendor/adp/snum, contractor-only fields, `custom_fields`
- `user_lookup_by_login(login)`
  - Exact login lookup returning routing fields: `user_uuid`, `id`, `full_name`, `login`, `email`, `active`, `current`, `role`, `office`, `program`
- `organization_search`
  - Inputs: `page`, `page_size`, `name`, `types`, `active`, `external_unique_id`
  - Output summary: `organization_uuid`, `id`, `name`, `abbreviation`, `types`, `active`, `is_master`, `phone`, `referral_contact_phone`, `referral_contact_email`, `website`, `city`, `state`, `address_summary`, `description_preview`, `description_truncated`, `external_unique_id`
- `organization_get(organization_uuid)`
  - UUID only
  - Returns the summary shape plus full `description` and normalized `parent_organization`
  - Exclusions: raw `external_site_uuids`
- `organization_lookup_by_name(name)`
  - Exact name lookup returning routing fields: `organization_uuid`, `id`, `name`, `active`, `types`, `phone`, `city`, `state`

## Output And Safety Rules

- Search tools keep the global budget policy: `page=1`, `page_size=10`, max `25`.
- Any free-text field included in search results uses preview policy: `300` chars max plus `*_truncated`.
- Detail tools may include full text fields only when the field is naturally small; cap any unexpectedly large free-text field at `6000` chars and set the envelope `truncated` flag.
- Do not expose raw LegalServer nested blobs when a normalized object or flat scalar is enough.
- Do not add current-user inference, session state, HTTP transport, custom-field maps, or any mutating endpoint.
- Preserve the existing error envelope and add one new internal error code: `multiple_matches` with HTTP `409`.
- Parse LegalServer `error_message`, `invalid_search_keys`, and similar structured 400 details into the upstream error message so tenant-specific API mismatches are diagnosable without packet capture.

## Test Plan

- Unit coverage:
  - allowlist expansion for all phase 3 endpoints
  - shared paginated search helper query construction and page-size caps
  - exact-match lookup helper with `0`, `1`, and `2+` exact matches across multiple pages
  - contact `results=full` enforcement
  - mapping/normalization helpers for users, organizations, matters, and module refs
  - preview/truncation behavior and field exclusion rules
- Handler coverage:
  - success and empty-result cases for every new tool
  - `401`, `403`, `404`, `429`, and `503` propagation for representative tools in each new domain
  - `multiple_matches` for email/login/name lookup tools
  - task deadline behavior through `task_search(deadline=true|false)` and `task_get`
  - event-date fallback behavior when LegalServer rejects `date` with `invalid_search_keys=["date"]`
- Integration coverage:
  - `list_tools` includes all existing tools plus the 15 phase 3 tools
  - representative in-process MCP calls for one tool per new domain and one convenience lookup
  - smoke test remains network-free and validates the updated canonical tool list
- Manual validation and docs:
  - add `npm run manual:phase3` for targeted live checks against one known contact email, one user login, one organization name, one task date, and one event date
  - release checklist requires `npm test`, `npm run smoke`, README/tool list updates, and one documented live validation pass before tagging the release
  - README must add a phase 3 operations-agent example using only the new discovery tools

## Assumptions And Defaults

- Phase 3 is a backward-compatible minor release; default version bump is `2.2.0`.
- The shared read-only bearer token remains the deployment model; anything that depends on caller identity stays out of scope.
- Generic search tools intentionally omit `custom_fields`, raw sort passthroughs, and auth-sensitive or high-risk personal fields so the base server stays portable and low-risk.
- Task date convenience stays as an exact API-backed wrapper. Event date convenience is exact by tool contract, but may be fulfilled through a bounded local fallback scan because some live tenants reject the documented `/api/v1/events?date=...` filter.
- Phase 3 does not add date ranges, overdue calculations, or current-user task queues.

# Tool Latency Benchmark

Generated: 2026-03-15T20:28:56.164Z
Base URL origin: https://mdlab.legalserver.org
Raw results: `.bench/results/2026-03-15T20-28-56-164Z.json`

This document is sanitized for commit safety. Benchmark fixtures and raw request traces remain in `.bench/` and must not be committed.

## Release Status (manually maintained — reconcile on regeneration)

`event_search` and `event_list_by_date` are commented out of the tool registry for the `v2`
release based on the numbers below (median ~2.0s / ~21.9s, worst case ~22.2s) — no report-backed
alternative exists for either. `matter_list_current_user` and `matter_list_current_user_active`
also show as strong report candidates below (worst case ~11.9s/~21.5s) but were fixed this
release with a report-backed path (`LEGALSERVER_CURRENT_USER_MATTERS_REPORT_URL`); see
`AGENTS.md`. `event_list_current_user_on_date`/`_between_dates` and
`task_list_current_user_on_date`/`_between_dates` also have report-backed paths already
(`LEGALSERVER_CURRENT_USER_EVENTS_REPORT_URL` / `LEGALSERVER_CURRENT_USER_TASKS_REPORT_URL`) —
their slow numbers below reflect the unconfigured REST-scan fallback, not the report path.

OCR now ships as an opt-in OpenAI provider (see "OCR" in `README.md`), but the
`document_get_text_manifest` OCR/scanned scenarios below predate it and measure neither the
old behavior nor the new one — their `extraction_failed` errors were recorded against a
provider configuration that no longer exists, and the PDF rasterization those scenarios now
depend on did not exist either. Re-run them against a deployment with
`DOCUMENT_OCR_PROVIDER=openai` on the next regeneration.

## Summary
- Strong report candidates:
- `event_list_by_date` (events on date)
- `event_list_current_user_between_dates` (current user events in range)
- `event_list_current_user_on_date` (current user events on date)
- `event_search` (event search)
- `matter_list_current_user` (current user assigned matters)
- `matter_list_current_user_active` (current user active matters)
- `task_list_current_user_between_dates` (current user tasks in range)
- Secondary report candidates:
- `task_list_current_user_on_date` (current user tasks on date)
- Discovery warnings:
- No user with supervisors was discovered; current-user supervisor benchmarks may return empty results.
- Matter child-list fixtures use a stable fallback matter for production benchmarking; some list tools may return empty results if that matter has no rows for the child endpoint.

## Scenario Table

| Tool | Scenario | Samples | Median ms | Max ms | LS req median | Pages max | Docs max | Rows median | Recommendation |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
`contact_get` | contact detail | 5 | 388.62 | 426.858 | 1 | 0 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`contact_lookup_by_email` | contact exact lookup | 5 | 450.84 | 528.29 | 1 | 1 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`contact_search` | contact search by email | 5 | 422.248 | 1390.235 | 1 | 1 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`document_get_metadata` | document metadata | 5 | 1446.73 | 1455.766 | 1 | 0 | 0 | 1 | not_report_friendly: Requires document binaries, OCR, chunk retrieval, or full-text search.
`document_get_text_chunk` | document text chunk (cold cache) | 3 | 1968.156 | 2057.39 | 2 | 0 | 1 | 1 | not_report_friendly: Requires document binaries, OCR, chunk retrieval, or full-text search.
`document_get_text_chunk` | document text chunk (warm cache) | 3 | 1396.679 | 1439.114 | 1 | 0 | 0 | 1 | not_report_friendly: Requires document binaries, OCR, chunk retrieval, or full-text search.
`document_get_text_manifest` | document text manifest (cold cache) | 3 | 2025.15 | 2112.771 | 2 | 0 | 1 | 1 | not_report_friendly: Requires document binaries, OCR, chunk retrieval, or full-text search.
`document_get_text_manifest` | document text manifest (OCR/scanned cold cache) | 3 | 2096.84 | 2210.374 | 2 | 0 | 1 | 0 | not_report_friendly: Requires document binaries, OCR, chunk retrieval, or full-text search.
`document_get_text_manifest` | document text manifest (OCR/scanned warm cache) | 3 | 1946.369 | 2038.293 | 2 | 0 | 1 | 0 | not_report_friendly: Requires document binaries, OCR, chunk retrieval, or full-text search.
`document_get_text_manifest` | document text manifest (warm cache) | 3 | 1429.814 | 1474.044 | 1 | 0 | 0 | 1 | not_report_friendly: Requires document binaries, OCR, chunk retrieval, or full-text search.
`document_search_text` | document text search (cold cache) | 3 | 1847.315 | 1929.334 | 2 | 0 | 1 | 4 | not_report_friendly: Requires document binaries, OCR, chunk retrieval, or full-text search.
`document_search_text` | document text search (warm cache) | 3 | 1403.887 | 1404.644 | 1 | 0 | 0 | 4 | not_report_friendly: Requires document binaries, OCR, chunk retrieval, or full-text search.
`event_get` | event detail | 5 | 425.387 | 428.254 | 1 | 0 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`event_list_by_date` | events on date | 3 | 21853.874 | 22198.724 | 21 | 21 | 0 | 0 | strong_report_candidate: Row-oriented workflow currently requires multiple upstream requests or local scanning.
`event_list_current_user_between_dates` | current user events in range | 3 | 21727.506 | 22026.644 | 22 | 22 | 0 | 0 | strong_report_candidate: Row-oriented workflow currently requires multiple upstream requests or local scanning.
`event_list_current_user_on_date` | current user events on date | 3 | 21595.89 | 21630.252 | 22 | 22 | 0 | 0 | strong_report_candidate: Row-oriented workflow currently requires multiple upstream requests or local scanning.
`event_search` | event search | 3 | 2045.101 | 2149.529 | 3 | 3 | 0 | 1 | strong_report_candidate: Row-oriented workflow currently requires multiple upstream requests or local scanning.
`matter_get` | matter detail | 5 | 525.055 | 617.976 | 1 | 0 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`matter_get_note` | matter note detail | 5 | 380.717 | 422.68 | 1 | 0 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`matter_list_adverse_parties` | matter adverse parties | 5 | 408.698 | 450.675 | 1 | 1 | 0 | 0 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`matter_list_assignments` | matter assignments | 5 | 405.037 | 441.965 | 1 | 1 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`matter_list_contacts` | matter contacts | 5 | 421.212 | 428.137 | 1 | 1 | 0 | 0 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`matter_list_current_user` | current user assigned matters | 3 | 4.037 | 11911.391 | 0 | 11 | 0 | 0 | strong_report_candidate: Row-oriented workflow currently requires multiple upstream requests or local scanning.
`matter_list_current_user_active` | current user active matters | 3 | 5.394 | 21533.537 | 0 | 11 | 0 | 1 | strong_report_candidate: Row-oriented workflow currently requires multiple upstream requests or local scanning.
`matter_list_documents` | matter documents | 5 | 1382.204 | 1456.287 | 1 | 0 | 0 | 21 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`matter_list_incomes` | matter incomes | 5 | 425.157 | 427.727 | 1 | 1 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`matter_list_litigations` | matter litigations | 5 | 423.27 | 432.828 | 1 | 1 | 0 | 0 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`matter_list_non_adverse_parties` | matter non-adverse parties | 5 | 422.899 | 424.886 | 1 | 1 | 0 | 0 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`matter_list_notes` | matter notes | 5 | 564.993 | 1019.374 | 1 | 1 | 0 | 2 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`matter_list_related_matters` | related matters | 5 | 320.836 | 325.651 | 1 | 0 | 0 | 0 | error: All benchmark runs failed (not_found).
`matter_list_services` | matter services | 5 | 416.566 | 426.801 | 1 | 1 | 0 | 0 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`matter_lookup_by_case_number` | lookup by case number | 5 | 563.09 | 613.692 | 1 | 0 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`matter_search_document_text` | matter-wide document search (cold cache) | 3 | 2409.831 | 2996.691 | 3 | 0 | 2 | 0 | not_report_friendly: Requires document binaries, OCR, chunk retrieval, or full-text search.
`matter_search_document_text` | matter-wide document search (warm cache) | 3 | 1842.721 | 1961.937 | 2 | 0 | 1 | 0 | not_report_friendly: Requires document binaries, OCR, chunk retrieval, or full-text search.
`organization_get` | organization detail | 5 | 322.702 | 425.306 | 1 | 0 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`organization_lookup_by_name` | organization exact lookup | 5 | 424.139 | 424.331 | 1 | 1 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`organization_search` | organization search by name | 5 | 325.192 | 381.456 | 1 | 1 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`task_get` | task detail | 5 | 407.236 | 426.653 | 1 | 0 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`task_list_current_user_between_dates` | current user tasks in range | 3 | 3673.366 | 3801.435 | 8 | 8 | 0 | 1 | strong_report_candidate: Row-oriented workflow currently requires multiple upstream requests or local scanning.
`task_list_current_user_on_date` | current user tasks on date | 3 | 641.254 | 718.835 | 2 | 2 | 0 | 1 | secondary_report_candidate: Row-oriented workflow shows moderate latency or multi-page lookup behavior.
`task_list_on_date` | tasks on date | 5 | 410.8 | 428.166 | 1 | 1 | 0 | 3 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`task_search` | task search by id | 5 | 413.288 | 425.321 | 1 | 1 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`user_get` | user detail | 5 | 341.474 | 425.808 | 1 | 0 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`user_get_current` | current user profile | 5 | 712.474 | 833.872 | 2 | 1 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`user_list_current_user_supervisors` | current user supervisors | 5 | 674.713 | 766.16 | 2 | 2 | 0 | 0 | error: All benchmark runs failed (unauthorized).
`user_lookup_by_login` | user exact lookup | 5 | 364.677 | 425.983 | 1 | 1 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.
`user_search` | user search by login | 5 | 422.935 | 427.512 | 1 | 1 | 0 | 1 | unlikely_report_candidate: Observed behavior is already close to a direct single-endpoint fetch.

## Notes

- `document_get_text_manifest` (document text manifest (OCR/scanned cold cache)): errors: extraction_failed
- `document_get_text_manifest` (document text manifest (OCR/scanned warm cache)): errors: extraction_failed
- `event_list_by_date` (events on date): warnings: LegalServer rejected the documented event date search key, so results were filtered locally from the newest 500 events that matched the remaining server-side filters. / The scan stopped after 20 upstream pages, so counts and next-page hints reflect the scanned window only.
- `event_list_current_user_between_dates` (current user events in range): warnings: LegalServer rejected the documented event date search key, so results were filtered locally from the newest 500 events in the requested range. / The scan stopped after 20 upstream pages, so counts and next-page hints reflect the scanned window only.
- `event_list_current_user_on_date` (current user events on date): warnings: LegalServer rejected the documented event date search key, so results were filtered locally from the newest 500 events. / The scan stopped after 20 upstream pages, so counts and next-page hints reflect the scanned window only.
- `event_search` (event search): warnings: LegalServer rejected the documented event date search key, so results were filtered locally from the newest 500 events that matched the remaining server-side filters.
- `matter_list_current_user` (current user assigned matters): warnings: The scan stopped after 10 upstream matter pages, so counts and next-page hints reflect the scanned window only.
- `matter_list_current_user_active` (current user active matters): warnings: The scan stopped after 10 upstream matter pages, so counts and next-page hints reflect the scanned window only.
- `matter_list_related_matters` (related matters): errors: not_found
- `matter_search_document_text` (matter-wide document search (cold cache)): errors: invalid_request
- `matter_search_document_text` (matter-wide document search (warm cache)): errors: invalid_request
- `user_list_current_user_supervisors` (current user supervisors): errors: unauthorized

## Reports API References

- LegalServer Reports API: https://help.legalserver.org/article/1751-reports-api
- LegalServer Data Export: https://help.legalserver.org/article/3031-data-export

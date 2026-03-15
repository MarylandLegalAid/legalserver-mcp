# Benchmark Recommendations

This note summarizes the live production benchmark run from March 15, 2026 in plain language.

The detailed timing table is in [tool-latency.md](/home/john/repos/legalserver-mcp/docs/tool-latency.md). The raw benchmark artifact is stored locally under `.bench/results/` and is intentionally not committed.

## What Stood Out

The slowest part of the MCP server is the event tooling when a date is involved.

In this LegalServer tenant, the documented `events?date=` filter does not work. The MCP falls back to pulling many pages of events and filtering them locally. That makes these tools very expensive:

- `event_list_by_date`
- `event_list_current_user_on_date`
- `event_list_current_user_between_dates`
- `event_search`

The first three were consistently around 21 to 22 seconds in production. That is too slow for normal interactive use and is the clearest place to replace the current API pattern with custom reports.

The next major issue is current-user task and matter discovery.

- `task_list_current_user_between_dates` took about 3.7 seconds and required repeated upstream calls across the date range.
- `matter_list_current_user` and `matter_list_current_user_active` had misleading medians because later samples were served from the in-process cache. Their first uncached runs were the real signal: about 11.9 seconds and 21.5 seconds respectively, each scanning 11 matter pages.

That means the matter tools feel fast only after this process has already done the expensive scan. If the MCP is restarted, scaled horizontally, or called from a cold container, the user pays the full cost again.

## Where Custom Reports Are Worth It

These are the strongest candidates for report-backed replacements:

1. `event_list_by_date`
2. `event_list_current_user_on_date`
3. `event_list_current_user_between_dates`
4. `event_search`
5. `task_list_current_user_between_dates`
6. `matter_list_current_user`
7. `matter_list_current_user_active`

Why these tools are good report candidates:

- they are row-oriented
- they spend time scanning many pages rather than fetching one record
- they rely on local filtering because the upstream API does not support the needed query efficiently
- the MCP is doing orchestration work that a well-designed LegalServer report can precompute much more cheaply

For the matter tools, I would strongly consider a report even though the cache helps. Caching improves repeated calls, but it does not fix the cold-start experience or the total amount of LegalServer work needed.

## Where Custom Reports Are Probably Not Worth It

These tools already perform well enough through the normal API:

- `contact_lookup_by_email`
- `user_lookup_by_login`
- `organization_lookup_by_name`
- `user_get_current`
- most direct `*_get` tools
- most single-endpoint list tools such as assignments, notes, contacts, incomes, and similar matter subresources

These calls were generally one or two upstream requests and usually completed in well under one second.

Custom reports would add maintenance overhead here without much payoff.

## Document Tools

The document tools are slower than the simple record lookups, but I would not try to replace them with reports.

They depend on:

- document downloads
- PDF parsing
- OCR
- text chunking
- substring search over extracted text

That is not what the Reports API is for. Reports can replace row retrieval, not document extraction workflows.

The benchmark also showed that scanned-document OCR is not healthy right now in this environment. The scanned manifest scenarios failed because the configured OCR path could not complete successfully.

## Practical Recommendation

If the goal is to improve user-perceived responsiveness quickly, I would implement report-backed tools in this order:

1. report for events by date
2. report for current-user events over a date or date range
3. report for current-user tasks over a date range
4. report for current-user matters

That order targets the worst interactive latency first.

For the events work specifically, the benchmark shows that the problem is structural, not incidental. As long as this tenant rejects the native date filter, the current MCP implementation will keep paying for large page scans. A report is the correct fix.

## Suggested Report Design Principles

When building the reports, keep them narrow and purpose-built.

- Prefer one report per workflow instead of one giant all-purpose report.
- Include only the fields the MCP tool actually returns.
- Make the reports filterable by date, user, and status where appropriate.
- Avoid broad unfiltered reports; if a workflow needs a large export, use LegalServer Data Export instead of the Reports API.

## Follow-Up Items

The benchmark also surfaced a few environment issues that should be fixed separately:

- scanned-document OCR failed in this environment
- `user_list_current_user_supervisors` returned `unauthorized`
- `matter_search_document_text` returned `invalid_request` for the chosen fixture/query combination
- `matter_list_related_matters` returned `not_found` for the benchmark fixture matter

Those are not reasons to avoid the benchmark conclusions above, but they should be addressed before treating every tool as fully production-ready.

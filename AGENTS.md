# Repository Guidelines

## Project Structure & Module Organization

Application code lives in [`src/`](/home/john/repos/legalserver-mcp/src). The HTTP entrypoint is [`index.js`](/home/john/repos/legalserver-mcp/index.js), with shared routing in [`src/httpServer.js`](/home/john/repos/legalserver-mcp/src/httpServer.js). LegalServer code is isolated under [`src/apps/legalserver/`](/home/john/repos/legalserver-mcp/src/apps/legalserver), including its tools, helpers, benchmark harness, and document extraction pipeline. LetterWriter code and templates live under [`src/apps/letterWriter/`](/home/john/repos/legalserver-mcp/src/apps/letterWriter). Transport and authentication helpers shared by both applications live under [`src/shared/`](/home/john/repos/legalserver-mcp/src/shared). Tests are split into [`test/unit/`](/home/john/repos/legalserver-mcp/test/unit), [`test/handlers/`](/home/john/repos/legalserver-mcp/test/handlers), [`test/integration/`](/home/john/repos/legalserver-mcp/test/integration), and [`test/regression/`](/home/john/repos/legalserver-mcp/test/regression). Operational docs and bundled LegalServer OpenAPI files live in [`docs/`](/home/john/repos/legalserver-mcp/docs).

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm start`: run the Streamable HTTP MCP server locally.
- `npm test`: run the full Node test suite with `node --test`.
- `npm run smoke`: run an HTTP smoke test against a live local server instance.
- `npm run manual:phase2` and `npm run manual:phase3`: manual validation scripts for real LegalServer environments.
- `docker build -t legalserver-mcp:test .`: verify the production container image builds.

## Coding Style & Naming Conventions

Use CommonJS on Node 20+. Follow the existing style: 2-space indentation, single quotes, semicolons, small focused modules, and explicit error messages. Tool modules use plural domain filenames such as `tasks.js` or `contacts.js`; shared utilities belong in `helpers` or `tools/shared`. Environment variable names stay uppercase and descriptive, for example `LEGALSERVER_BEARER_TOKEN` and `MCP_SHARED_SECRET`.

## Testing Guidelines

Add or update tests for any behavior change. Prefer the narrowest layer that proves the change: unit tests for parsing/helpers, handler tests for tool behavior, and integration tests for MCP or HTTP transport. Test files should end in `.test.js` and sit beside the relevant suite folder. Run `npm test` before committing; run `npm run smoke` for HTTP/runtime changes.

## Commit & Pull Request Guidelines

Recent history uses short imperative commit subjects, for example `Implement phase 3 global discovery tools` and `Harden HTTP deployment for production cutover`. Keep commits scoped to one concern. Pull requests should explain the user-facing change, note any config or deployment impact, list validation performed, and include updated docs when behavior or setup changes.

## Security & Configuration Tips

Do not commit live tokens or copied deployment `.env` files. Use `.env.example` as the template. For LibreChat deployments, keep the MCP private on the Compose network, prefer `MCP_SHARED_SECRET`, and document any new headers or required environment variables in [`README.md`](/home/john/repos/legalserver-mcp/README.md).

## Current Project Notes

The `v2` branch is one Streamable HTTP service with separate LegalServer and LetterWriter MCP endpoints. Current-user tools depend on LibreChat forwarding the signed-in user's email through `LEGALSERVER_USER_EMAIL_HEADER` (default `x-legalserver-user-email`). Treat this as request context for convenience scoping, not as a LegalServer access-control boundary.

Current-user event tools can use a LegalServer Reports API export when `LEGALSERVER_CURRENT_USER_EVENTS_REPORT_URL` is set. Keep the full report URL in `.env`, not code, because report IDs/API keys differ by tenant and the URL contains a report API key. The configured report must support `filter[person_email]`; the tool passes the forwarded user email into that override and then filters returned rows locally by `time_start`/`time_end`. Report-backed event ranges are intentionally open-ended within whatever window the report itself returns. The legacy non-report event fallback remains bounded because it scans LegalServer event pages.

Current-user task tools can use a LegalServer Reports API export when `LEGALSERVER_CURRENT_USER_TASKS_REPORT_URL` is set. Report 2777 supports `filter[todo_users_email]`, but live validation showed that LegalServer rejects the copied completion override. The MCP removes invalid completion parameters, passes only the forwarded email upstream, and applies Due Date, completion, and deadline filters locally. The legacy API fallback continues to use LegalServer's native `list_date` filter. Keep the report URL in `.env` because it contains a report API key.

For event follow-up work, `event_get` currently uses the v1 event detail endpoint and is the best downstream tool once a report row provides `unique_id`/event UUID. Live dev probing showed v1 event detail is much faster than v2 detail for the same event, while v2 detail adds a `documents` field but was slow. Event reminders endpoints exist in the schemas but returned `404` for the tested fixture. Event-linked task/document searches are plausible (`module=event` with event ID/UUID) but need representative events with linked tasks/documents before adding tools.

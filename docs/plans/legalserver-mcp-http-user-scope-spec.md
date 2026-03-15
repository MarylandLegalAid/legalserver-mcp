# LegalServer MCP v3: HTTP-Only Transport With User-Scoped Task Prototype

## Summary

- Treat this as a breaking transport redesign, not an additive feature. Replace the current `stdio` runtime with a remote Streamable HTTP runtime and ship the user-scoped prototype on that branch only.
- Preserve the current `v2` snapshot untouched by doing all implementation on a new branch named `v3-http-user-scope`. Do not modify `v2`.
- Keep the existing MCP server core, tool contracts, and response envelope wherever possible. Change the bootstrap and request plumbing first, then add user context and the scoped task tool.
- Baseline at planning time: current branch is `v2`, working tree is clean, and `npm test` passes.

## Phase 0: Isolation And Plan Capture

- Start from `v2` and create a new branch: `git switch v2` then `git switch -c v3-http-user-scope`.
- Make one commit per phase. Do not squash or amend. This branch is the experimental cutover branch; `v2` remains the fallback if user scoping or LibreChat HTTP integration proves undesirable.
- Before code changes, write this exact plan to `docs/plans/legalserver-mcp-http-user-scope-spec.md`.
- Acceptance: branch `v3-http-user-scope` exists, `v2` is unchanged, and the plan document is committed on the new branch.

## Phase 1: Replace `stdio` With HTTP-Only Runtime

- Keep the low-level MCP server factory in `src/mcpServer.js`, but remove `stdio` as the app runtime from `index.js`.
- Add a dedicated HTTP bootstrap module, for example `src/httpServer.js`, and make `index.js` launch that server.
- Use `@modelcontextprotocol/sdk/server/express.js` and `StreamableHTTPServerTransport` in stateless mode with `sessionIdGenerator: undefined`.
- Expose exactly one MCP endpoint path: `/mcp`.
- Implement `POST /mcp` by creating a fresh MCP server and fresh Streamable HTTP transport per request, delegating to `transport.handleRequest(req, res, req.body)`, and closing the transport/server on response close.
- Implement `GET /mcp` and `DELETE /mcp` as explicit `405 Method Not Allowed`. This is acceptable because the SDK client treats GET SSE as optional and tolerates `405` for GET and DELETE in stateless flows.
- Extend `src/config.js` with `MCP_HTTP_HOST` default `127.0.0.1` and `MCP_HTTP_PORT` default `3001`.
- Keep `npm start` as the primary runtime entry, but change its meaning to “start HTTP server”. Remove any `StdioServerTransport` import and any README examples that tell users to wire this repo as a local spawned process.
- Do not keep a second runtime mode on this branch. The branch goal is HTTP-only.
- Acceptance: local HTTP server starts with `npm start`, responds on `/mcp`, existing tool listing still works over HTTP, and no runtime path in the branch uses `stdio`.

## Phase 2: Thread Request-Scoped Context Through MCP Execution

- Update `src/mcpServer.js` so the `CallToolRequestSchema` handler accepts the SDK `extra` argument and passes request-scoped metadata into tool execution.
- Update `src/toolRegistry.js` so `execute(name, args, invocationContext)` merges the invocation context into the handler payload. Required fields are `requestInfo`, `sessionId`, and `authInfo`.
- Keep tool handlers transport-agnostic. The handler contract should expose optional request context but not depend on Express objects directly.
- Add a small request-context helper module to normalize header lookup case-insensitively from `requestInfo.headers`.
- Add config support for `LEGALSERVER_USER_EMAIL_HEADER`, defaulting to `x-legalserver-user-email`.
- Add an internal current-user resolver that reads the configured header, resolves `/api/v1/users?email=...` exactly, and returns `email`, `user_uuid`, `id`, `login`, and `full_name`.
- Standardize new error cases: `missing_user_context` with `400`, `user_context_unresolved` with `404`, and reuse `multiple_matches` with `409`.
- Acceptance: a tool handler can access forwarded header data through MCP request context without depending on HTTP-specific globals, and current-user resolution is covered by tests.

## Phase 3: Add The User-Scoped Prototype Tool

- Add exactly one prototype tool in `src/tools/tasks.js`: `task_list_current_user_on_date`.
- Input schema should mirror `task_list_on_date`: `date`, `page`, `page_size`, `completed=false`, and optional `deadline`.
- Tool flow:
  - validate `date`
  - resolve current user from the configured header
  - query `/api/v1/tasks` with `list_date`, `completed`, and optional `deadline`
  - always fetch upstream task pages with `page_size=25`
  - scan at most `20` upstream pages
  - filter results locally to tasks whose assigned users include the resolved `user_uuid` or numeric user `id`
  - paginate the filtered list locally using the existing helper pagination
  - map each record with the existing task summary mapper so the output shape matches existing task list tools
- Add a new constant for the scan cap in `src/constants.js`.
- Only emit warnings when the scan cap is hit. In that case set `truncated=true` and explain that counts reflect the scanned window only.
- Do not add a broad “my tasks” search, diagnostic echo tool, JWT auth, or per-user LegalServer bearer tokens in this phase.
- Acceptance: the new tool returns only tasks assigned to the resolved current user for the specified date and behaves deterministically under scan truncation.

## Phase 4: Tests, Docs, And Packaging Cutover

- Keep the existing protocol-agnostic MCP integration coverage where useful, but add HTTP runtime integration tests that exercise the real server entrypoint over Streamable HTTP.
- Add an HTTP integration test using `StreamableHTTPClientTransport` with `requestInit.headers` carrying `X-LegalServer-User-Email`.
- Cover at least these cases in tests:
  - HTTP server lists tools successfully
  - `task_list_current_user_on_date` happy path
  - missing header
  - no matching LegalServer user
  - duplicate matching user
  - truncated scan window
  - regression check that non-scoped tools still work over the HTTP runtime
- Update `README.md`, `package.json`, and any relevant scripts:
  - version bump to `3.0.0`
  - describe the server as Streamable HTTP, not `stdio`
  - replace the LibreChat example with a YAML-defined remote MCP config using `type: streamable-http`, `url: https://<host>/mcp`, and `headers: { X-LegalServer-User-Email: "{{LIBRECHAT_USER_EMAIL}}" }`
  - remove language saying phase 3 intentionally excludes current-user shortcuts
- Add one manual validation section to the README or a dedicated doc with local server launch, one HTTP verification, one LibreChat YAML example, and one end-to-end “my tasks on date” validation flow.
- Acceptance: `npm test` passes on the branch, the docs describe HTTP-only deployment and LibreChat header forwarding correctly, and the branch can be abandoned without touching `v2`.

## Assumptions And External Findings

- LibreChat’s documented path for dynamic user context is YAML-defined remote MCP servers, where `streamable-http` headers can use placeholders like `{{LIBRECHAT_USER_EMAIL}}`.
- UI-created LibreChat MCP servers intentionally block `{{LIBRECHAT_USER_*}}` placeholders, so this prototype assumes YAML config, not DB-sourced server config.
- LibreChat has had a reported regression around `stdio` `customUserVars` substitution into `env`, while header substitution remained the working path.
- LibreChat does not yet have native authenticated-user JWT forwarding as a settled built-in capability, so the prototype uses forwarded email, not JWT validation.
- This transport change is intentionally a major-version branch. `v2` remains the supported fallback if the HTTP plus user-scoping approach does not justify replacing the simpler shared-token `stdio` model.

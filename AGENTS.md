# Repository Guidelines

## Project Structure & Module Organization

Application code lives in [`src/`](/home/john/repos/legalserver-mcp/src). The HTTP entrypoint is [`index.js`](/home/john/repos/legalserver-mcp/index.js), with server wiring in [`src/httpServer.js`](/home/john/repos/legalserver-mcp/src/httpServer.js) and MCP registration in [`src/mcpServer.js`](/home/john/repos/legalserver-mcp/src/mcpServer.js). Domain tools are grouped under [`src/tools/`](/home/john/repos/legalserver-mcp/src/tools) and shared helpers under [`src/helpers/`](/home/john/repos/legalserver-mcp/src/helpers) and [`src/tools/shared/`](/home/john/repos/legalserver-mcp/src/tools/shared). Document extraction logic is in [`src/documentText/`](/home/john/repos/legalserver-mcp/src/documentText). Tests are split into [`test/unit/`](/home/john/repos/legalserver-mcp/test/unit), [`test/handlers/`](/home/john/repos/legalserver-mcp/test/handlers), [`test/integration/`](/home/john/repos/legalserver-mcp/test/integration), and [`test/regression/`](/home/john/repos/legalserver-mcp/test/regression). Operational docs and the bundled LegalServer OpenAPI file live in [`docs/`](/home/john/repos/legalserver-mcp/docs).

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

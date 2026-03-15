# Wiring LegalServer MCP v3 to LibreChat

This guide walks through the recommended production setup for connecting the `v3` HTTP-based LegalServer MCP server to LibreChat.

It assumes:

- you are cloning the `v3-http-user-scope` branch of this repo
- you are placing that checkout at `/custom-tools/legalserver-v2`
- LibreChat will connect to this MCP as a remote `streamable-http` server
- LibreChat and the MCP will run as separate Docker Compose services on the same private network
- you want LibreChat to forward the signed-in user's email so the MCP can support user-scoped tools such as `task_list_current_user_on_date`
- you want LibreChat to authenticate to the MCP with a static shared secret

## 1. Clone the v3 branch

```bash
git clone --branch v3-http-user-scope https://github.com/MarylandLegalAid/legalserver-mcp.git /custom-tools/legalserver-v2
cd /custom-tools/legalserver-v2
npm install
```

The directory name is still `/custom-tools/legalserver-v2` in this example, even though you are cloning the `v3` branch.

## 2. Configure the MCP server

Create a local environment file from the example:

```bash
cp .env.example .env
```

Set at least these values in `.env`:

```dotenv
LEGALSERVER_BASE_URL=https://your-site.legalserver.org/
LEGALSERVER_BEARER_TOKEN=your-legalserver-api-token
LEGALSERVER_TIMEOUT_MS=30000
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3001
MCP_ALLOWED_HOSTS=legalserver-mcp,localhost,127.0.0.1
MCP_SHARED_SECRET=replace-me
MCP_SHARED_SECRET_HEADER=x-legalserver-mcp-secret
LEGALSERVER_USER_EMAIL_HEADER=x-legalserver-user-email
```

Notes:

- `LEGALSERVER_BEARER_TOKEN` is the correct variable name for this branch. Do not use `LEGALSERVER_API_TOKEN`.
- `LEGALSERVER_USER_EMAIL_HEADER` and `MCP_SHARED_SECRET_HEADER` must match the header names you later configure in LibreChat.
- `MCP_ALLOWED_HOSTS` is a comma-separated list of hostnames, not URLs.
- Treat the MCP endpoint as private infrastructure. The forwarded email header is trusted request context, not authentication by itself.

## 3. Add the MCP service to Docker Compose

Add a dedicated MCP service beside LibreChat instead of reaching a host process through `host.docker.internal`.

Example service blocks:

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

The MCP service should not publish a host port for the normal production setup.

## 4. Start the stack

From the LibreChat deployment root:

```bash
docker compose up -d --build legalserver-mcp api
```

The MCP service should start a Streamable HTTP endpoint at:

```text
http://legalserver-mcp:3001/mcp
```

Quick health checks:

```bash
docker compose exec api node -e "fetch('http://legalserver-mcp:3001/healthz').then(async (r) => { console.log(r.status); console.log(await r.text()); })"
docker compose exec api node -e "fetch('http://legalserver-mcp:3001/mcp').then(async (r) => { console.log(r.status); console.log(await r.text()); })"
```

A `200` on `/healthz` and a `405 Method Not Allowed` on `/mcp` are the expected results.

## 5. Add the MCP server to `librechat.yaml`

Use a YAML-defined MCP server. Do not create this MCP server only through the LibreChat UI, because LibreChat's built-in user placeholders such as `{{LIBRECHAT_USER_EMAIL}}` are intended for YAML-configured servers.

Add an entry like this to `librechat.yaml`:

```yaml
mcpSettings:
  allowedDomains:
    - "http://legalserver-mcp:3001"

mcpServers:
  LegalServer:
    type: streamable-http
    url: http://legalserver-mcp:3001/mcp
    headers:
      X-LegalServer-Mcp-Secret: "${LEGALSERVER_MCP_SHARED_SECRET}"
      X-LegalServer-User-Email: "{{LIBRECHAT_USER_EMAIL}}"
    description: "Read-only LegalServer matter, document, discovery, and current-user task tools"
    chatMenu: true
```

Important details:

- Keep only one LegalServer MCP server entry enabled during the cutover.
- If you changed `LEGALSERVER_USER_EMAIL_HEADER` or `MCP_SHARED_SECRET_HEADER` in the MCP `.env`, use those exact same header names here.
- `{{LIBRECHAT_USER_EMAIL}}` is what lets LibreChat pass the signed-in user's email to the MCP on each request.
- `${LEGALSERVER_MCP_SHARED_SECRET}` must match `MCP_SHARED_SECRET` from the MCP service environment.
- The value LibreChat forwards needs to match a LegalServer user email exactly enough for the MCP to resolve one user record.

## 6. Restart LibreChat

After editing `librechat.yaml`, restart LibreChat so it reloads the MCP config.

The exact restart command depends on your deployment. For example, in Docker Compose that is often:

```bash
docker compose restart api
```

## 7. Confirm the server appears in LibreChat

Open LibreChat and verify:

- the `LegalServer` MCP server appears in the tools or chat menu
- the server is reachable without transport errors
- the expected LegalServer tools are listed

On the `v3` branch, one of those tools should be:

```text
task_list_current_user_on_date
```

## 8. Validate user-scoped behavior

Sign in to LibreChat as a user whose email also exists in LegalServer, then ask something like:

```text
What are my tasks on 2026-03-14?
```

Expected behavior:

- LibreChat sends both the shared secret and the real signed-in user email as headers
- the MCP resolves that email to one LegalServer user
- the MCP uses `task_list_current_user_on_date`
- the response only includes tasks assigned to that LegalServer user for the requested date

## 9. Troubleshooting

If the server does not show up in LibreChat:

- confirm LibreChat can reach `http://legalserver-mcp:3001/mcp` from the `api` container
- confirm the URL ends with `/mcp`
- confirm LibreChat was restarted after editing `librechat.yaml`

If user-scoped tools fail with `missing_user_context`:

- LibreChat is not sending the expected header
- the header name in `librechat.yaml` does not match `LEGALSERVER_USER_EMAIL_HEADER`
- the MCP server entry was created in the UI instead of YAML

If LibreChat fails with `fetch failed`:

- confirm the `legalserver-mcp` service is healthy
- confirm both services are on the same Docker Compose network
- confirm `mcpSettings.allowedDomains` includes `http://legalserver-mcp:3001`
- confirm the MCP service did not start with `LEGALSERVER_API_TOKEN` instead of `LEGALSERVER_BEARER_TOKEN`

If MCP calls fail with shared-secret errors:

- confirm `${LEGALSERVER_MCP_SHARED_SECRET}` in LibreChat matches `MCP_SHARED_SECRET` on the MCP service
- confirm the header name in `librechat.yaml` matches `MCP_SHARED_SECRET_HEADER`

If user-scoped tools fail with `user_context_unresolved`:

- the LibreChat user's email does not match any LegalServer user email
- LegalServer has the user under a different email than the LibreChat identity provider

If user-scoped tools fail with `multiple_matches`:

- more than one LegalServer user matched the forwarded email
- clean up duplicate user records before relying on current-user tools

If LibreChat can reach the server but calls fail unexpectedly:

- verify `LEGALSERVER_BASE_URL` and `LEGALSERVER_BEARER_TOKEN`
- check the `legalserver-mcp` container logs
- test the same LibreChat account with a known-valid LegalServer email

## 10. Recommended production posture

For production or shared environments:

- keep the MCP endpoint private to LibreChat on the Compose network
- do not publish the MCP service as a host port unless you intentionally need external access
- prefer HTTPS or an internal reverse proxy only if traffic must leave the private network
- do not treat the forwarded email header as a substitute for network-level or service-level access control

## Reference Values

Example local paths and values used in this guide:

- repo checkout: `/custom-tools/legalserver-v2`
- branch: `v3-http-user-scope`
- internal MCP URL: `http://legalserver-mcp:3001/mcp`
- LibreChat header name: `X-LegalServer-User-Email`
- shared secret header name: `X-LegalServer-Mcp-Secret`
- MCP env header name: `LEGALSERVER_USER_EMAIL_HEADER=x-legalserver-user-email`

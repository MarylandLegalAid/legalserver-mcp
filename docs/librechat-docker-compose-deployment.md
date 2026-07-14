# Deploying LegalServer MCP Alongside LibreChat With Docker Compose

This guide covers the legacy private Docker Compose deployment path. The repository now hosts LegalServer and LetterWriter in one process; this guide configures the LegalServer endpoint only.

It is written for the current deployment model:

- LibreChat runs in Docker Compose
- this MCP runs as a separate Compose service on the same private network
- LibreChat connects to the MCP with `type: streamable-http`
- LibreChat forwards the signed-in user's email so the MCP can support user-scoped tools such as `task_list_current_user_on_date`, `event_list_current_user_on_date`, and `matter_list_current_user`
- LibreChat also sends a static shared secret so the MCP does not trust any caller on the network by default

If you follow this guide exactly, you should end up with:

- a `legalserver-mcp` container running privately inside the same Compose project as LibreChat
- no published host port for the MCP
- a working `LegalServer` MCP entry in `librechat.yaml`
- successful LibreChat tool calls to both normal read-only tools and the request-scoped current-user tools

## What You Are Building

At a high level, the deployment looks like this:

```text
LibreChat container (service: api)
  -> http://legalserver-mcp:3001/legalserver/mcp
  -> headers:
       X-LegalServer-Mcp-Secret: <shared secret>
       X-LegalServer-User-Email: <signed-in LibreChat user email>

LegalServer MCP container (service: legalserver-mcp)
  -> validates shared secret
  -> resolves current user by forwarded email
  -> calls LegalServer with the shared org-managed bearer token
```

The MCP is not exposed publicly in this guide. Only LibreChat should be able to reach it on the internal Compose network.

## Before You Start

You need:

- a working LibreChat Docker Compose deployment
- shell access to the host running that deployment
- a LegalServer base URL
- a LegalServer API bearer token for the shared read-only MCP credential
- a LibreChat authentication setup where users have an email address that also exists in LegalServer

You should also know which Compose service name is your LibreChat app container. This guide assumes that service is named `api`, which is common in LibreChat Compose setups. If your service name is different, replace `api` in the commands below with your actual service name.

## Directory Layout

This guide assumes the LibreChat deployment root contains the LibreChat Compose files and that you clone this repo into `custom-tools/legalserver-v2` under that root.

Example:

```text
/opt/librechat/
  docker-compose.yml
  librechat.yaml
  .env
  custom-tools/
    legalserver-v2/
```

In the examples below:

- LibreChat deployment root: `/opt/librechat`
- MCP repo path: `/opt/librechat/custom-tools/legalserver-v2`

Adjust the path if your deployment root is different.

## Step 1: Clone The MCP Repo

From the LibreChat deployment root:

```bash
cd /opt/librechat/custom-tools
git clone --branch v2 https://github.com/MarylandLegalAid/legalserver-mcp.git legalserver-v2
cd legalserver-v2
```

You do not need `npm install` on the host for the Compose deployment path, because the Docker image will install dependencies during `docker build`.

## Step 2: Create The MCP Environment File

In the MCP repo:

```bash
cd /opt/librechat/custom-tools/legalserver-v2
cp .env.example .env
```

Edit `.env` and set at least these values:

```dotenv
LEGALSERVER_BASE_URL=https://your-site.legalserver.org/
LEGALSERVER_BEARER_TOKEN=your-legalserver-bearer-token
LEGALSERVER_TIMEOUT_MS=30000

MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3001
MCP_ALLOWED_HOSTS=legalserver-mcp,localhost,127.0.0.1
MCP_SHARED_SECRET=replace-this-with-a-long-random-secret
MCP_SHARED_SECRET_HEADER=x-legalserver-mcp-secret
LEGALSERVER_USER_EMAIL_HEADER=x-legalserver-user-email

DOCUMENT_OCR_PROVIDER=none
DOCUMENT_OCR_MODEL=gemini-2.5-flash
GOOGLE_CLOUD_PROJECT=
GOOGLE_CLOUD_LOCATION=global
GOOGLE_APPLICATION_CREDENTIALS=
```

Important notes:

- Use `LEGALSERVER_BEARER_TOKEN`. Do not use `LEGALSERVER_API_TOKEN`.
- `MCP_ALLOWED_HOSTS` must be hostnames, not URLs.
- `MCP_SHARED_SECRET` is the shared secret that LibreChat must also send.
- `LEGALSERVER_USER_EMAIL_HEADER` is the header name the MCP will inspect for the current user email.
- `MCP_HTTP_HOST=0.0.0.0` is correct inside the container.

If you want OCR for scanned PDFs or images, configure the OCR variables now. If you do not need OCR yet, leave `DOCUMENT_OCR_PROVIDER=none`.

## Step 3: Add The MCP Service To Docker Compose

Open your LibreChat `docker-compose.yml` and add a new service named `legalserver-mcp`.

Example:

```yaml
services:
  api:
    depends_on:
      legalserver-mcp:
        condition: service_healthy

  legalserver-mcp:
    build:
      context: ./custom-tools/legalserver-v2
    env_file:
      - ./custom-tools/legalserver-v2/.env
    expose:
      - "3001"
    restart: unless-stopped
```

What each part is doing:

- `build.context`: builds the MCP image from this repo
- `env_file`: gives the MCP container its own env file
- `expose: "3001"`: makes the container port available to other containers on the Compose network
- no `ports`: keeps the MCP off the public host network
- `depends_on.condition: service_healthy`: waits for the MCP healthcheck before starting LibreChat, if your Compose version supports it

Do not add a `ports:` block for the MCP in the normal production setup unless you intentionally want host access for debugging.

## Step 4: Add The Shared Secret To LibreChat's Environment

LibreChat needs its own env var for the shared secret it will send to the MCP.

Edit LibreChat's root `.env` and add:

```dotenv
LEGALSERVER_MCP_SHARED_SECRET=replace-this-with-the-same-secret-from-the-mcp-env-file
```

This value must match `MCP_SHARED_SECRET` from `/opt/librechat/custom-tools/legalserver-v2/.env`.

Do not assume LibreChat's root `.env` automatically configures the MCP container. In this deployment, the MCP gets its own env file through the `env_file` entry on the `legalserver-mcp` service.

That separation is intentional and helps avoid configuration confusion.

## Step 5: Configure `librechat.yaml`

Open `librechat.yaml`.

First, add or update `mcpSettings.allowedDomains` so LibreChat allows connections to the Docker service name. LibreChat blocks internal service names unless they are explicitly allowed.

Add:

```yaml
mcpSettings:
  allowedDomains:
    - "http://legalserver-mcp:3001"
```

Then add the MCP server itself:

```yaml
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

Important details:

- Use a YAML-defined MCP server, not a UI-created server, for this setup.
- `{{LIBRECHAT_USER_EMAIL}}` is how LibreChat forwards the signed-in user's email.
- `${LEGALSERVER_MCP_SHARED_SECRET}` is read from LibreChat's root `.env`.
- `X-LegalServer-Mcp-Secret` must match `MCP_SHARED_SECRET_HEADER` on the MCP side.
- `X-LegalServer-User-Email` must match `LEGALSERVER_USER_EMAIL_HEADER` on the MCP side.

If you already have an older LegalServer MCP entry in `librechat.yaml`, remove it or comment it out. During cutover, keep only one active LegalServer MCP entry to avoid debugging the wrong server.

## Step 6: Build And Start The Services

From the LibreChat deployment root:

```bash
cd /opt/librechat
docker compose up -d --build legalserver-mcp api
```

If you want to rebuild everything in one pass, you can also use:

```bash
docker compose up -d --build
```

## Step 7: Confirm The MCP Container Is Healthy

Check container status:

```bash
docker compose ps
```

You should see `legalserver-mcp` running.

Then inspect the logs:

```bash
docker compose logs --tail=100 legalserver-mcp
```

You want to see a startup line like:

```text
LegalServer MCP endpoint: /legalserver/mcp
```

If the container exits immediately, check for env issues first. The most common one is using `LEGALSERVER_API_TOKEN` instead of `LEGALSERVER_BEARER_TOKEN`.

## Step 8: Verify Reachability From The LibreChat Container

Before debugging LibreChat MCP behavior, verify basic network access from inside the `api` container.

Health endpoint check:

```bash
docker compose exec api node -e "fetch('http://legalserver-mcp:3001/healthz').then(async (r) => { console.log(r.status); console.log(await r.text()); }).catch((e) => { console.error(e); process.exit(1); })"
```

Expected result:

- status `200`
- JSON body showing `ok: true`

MCP endpoint check:

```bash
docker compose exec api node -e "fetch('http://legalserver-mcp:3001/legalserver/mcp').then(async (r) => { console.log(r.status); console.log(await r.text()); }).catch((e) => { console.error(e); process.exit(1); })"
```

Expected result:

- status `405`

That `405 Method Not Allowed` is success here. It proves the HTTP endpoint exists and is responding. The MCP protocol itself uses `POST`.

If these checks fail, stop and fix the container networking before debugging LibreChat.

## Step 9: Restart LibreChat

After updating `librechat.yaml` and `.env`, restart the LibreChat app service:

```bash
docker compose restart api
```

If your deployment uses a different service name for LibreChat, restart that service instead.

## Step 10: Confirm LibreChat Sees The MCP

Check the LibreChat logs:

```bash
docker compose logs --tail=200 api | grep -i legalserver
```

Healthy signs include:

- LibreChat logs the `LegalServer` MCP config
- LibreChat attempts to initialize the server
- no `Domain ... is not allowed` error
- no `fetch failed` error

If the server initializes correctly, open LibreChat in the browser and confirm the `LegalServer` MCP server appears in the tool selector or chat menu.

## Step 11: Validate A Non-User-Scoped Tool

Before testing `"my tasks"` behavior, validate one ordinary read-only tool. This confirms the server is generally working, not just the current-user path.

Good examples:

- `contact_lookup_by_email`
- `matter_get`
- `user_lookup_by_login`

Example prompt:

```text
Look up the LegalServer contact with email someone@example.org.
```

If that works, the base transport and LegalServer bearer-token path are functioning.

## Step 12: Validate A User-Scoped Tool

Now test the user-scoped tools.

Sign in to LibreChat as a user whose email also exists in LegalServer, then ask:

```text
What are my tasks on 2026-03-14?
```

Expected behavior:

- LibreChat sends the shared secret header
- LibreChat sends the signed-in user's email in `X-LegalServer-User-Email`
- the MCP resolves that email against LegalServer users
- the MCP runs one of the current-user tools such as `task_list_current_user_on_date`
- only tasks assigned to that LegalServer user are returned

## What To Expect If It Works

At this point all of these should be true:

- `docker compose ps` shows `legalserver-mcp` healthy
- `docker compose exec api ... /healthz` returns `200`
- `docker compose exec api ... /legalserver/mcp` returns `405`
- LibreChat logs do not show allowlist or fetch errors
- LibreChat can call at least one non-user-scoped LegalServer tool
- LibreChat can call the current-user LegalServer tools

## Common Mistakes

### 1. Using `LEGALSERVER_API_TOKEN`

This branch expects:

```dotenv
LEGALSERVER_BEARER_TOKEN=...
```

Not:

```dotenv
LEGALSERVER_API_TOKEN=...
```

If you use the wrong variable name, the MCP container will fail to start.

### 2. Putting MCP Variables Only In LibreChat's Root `.env`

LibreChat's root `.env` is not the MCP env file unless you explicitly wire it that way.

In this guide:

- LibreChat root `.env` holds `LEGALSERVER_MCP_SHARED_SECRET`
- the MCP service env file holds `LEGALSERVER_BEARER_TOKEN`, `MCP_ALLOWED_HOSTS`, and the other MCP runtime variables

### 3. Forgetting `mcpSettings.allowedDomains`

LibreChat blocks internal service names such as `legalserver-mcp` unless they are explicitly allowed.

You need:

```yaml
mcpSettings:
  allowedDomains:
    - "http://legalserver-mcp:3001"
```

LibreChat documents this behavior in its MCP settings docs.

### 4. Leaving The Old LegalServer MCP Entry Enabled

If you still have an old `stdio` or temporary `LegalServer-v2` entry active, you can end up debugging the wrong server.

During cutover, keep one active LegalServer MCP server in `librechat.yaml`.

### 5. Publishing The MCP Port Unnecessarily

Do not add:

```yaml
ports:
  - "3001:3001"
```

unless you have a specific operational reason to expose the MCP on the host.

The intended setup is private container-to-container traffic only.

## Troubleshooting By Symptom

### Symptom: `Domain "... is not allowed"`

Cause:

- LibreChat is blocking the MCP target under its SSRF protection rules

Fix:

- add `http://legalserver-mcp:3001` to `mcpSettings.allowedDomains`

### Symptom: `fetch failed`

Cause:

- LibreChat cannot complete an HTTP request to the MCP

Check:

- `docker compose ps`
- `docker compose logs legalserver-mcp`
- `docker compose exec api ... /healthz`
- `docker compose exec api ... /legalserver/mcp`

Typical root causes:

- MCP container not running
- wrong service name in `url`
- services not on the same Compose network
- bad env caused the MCP to exit during startup

### Symptom: MCP container starts and exits immediately

Check:

```bash
docker compose logs legalserver-mcp
```

Typical causes:

- missing `LEGALSERVER_BEARER_TOKEN`
- invalid `LEGALSERVER_BASE_URL`
- OCR enabled without required OCR config

### Symptom: `missing_shared_secret` or `invalid_shared_secret`

Cause:

- LibreChat is not sending the expected shared-secret header

Check:

- `LEGALSERVER_MCP_SHARED_SECRET` in LibreChat root `.env`
- `MCP_SHARED_SECRET` in MCP `.env`
- `MCP_SHARED_SECRET_HEADER` in MCP `.env`
- header name in `librechat.yaml`

All four must align.

### Symptom: `missing_user_context`

Cause:

- LibreChat did not send the expected user-email header

Check:

- `LEGALSERVER_USER_EMAIL_HEADER` in the MCP env
- header name in `librechat.yaml`
- the server was created in YAML, not only via the UI

### Symptom: `user_context_unresolved`

Cause:

- the signed-in LibreChat user's email does not match a LegalServer user

Check:

- the user's LibreChat account email
- the corresponding LegalServer user email

Those need to match closely enough for the MCP's exact-email resolution to find one user.

### Symptom: `multiple_matches`

Cause:

- more than one LegalServer user record matched the forwarded email

Fix:

- clean up the duplicate LegalServer user records

## Recommended Cutover Checklist

Before you consider the HTTP deployment complete:

- remove or disable old LegalServer MCP entries from LibreChat
- confirm the MCP is running as `legalserver-mcp` in Compose
- confirm the MCP has no published host port
- confirm `/healthz` is `200` from inside the LibreChat container
- confirm `/legalserver/mcp` is `405` from inside the LibreChat container
- confirm one non-user-scoped tool works
- confirm a current-user LegalServer tool works
- confirm LibreChat logs are free of MCP allowlist and transport errors

## References

- LibreChat MCP Servers docs: https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers
- LibreChat MCP Settings docs: https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_settings
- Bundled LegalServer API spec: [docs/LegalServerAPI.v1.yaml](/home/john/repos/legalserver-mcp/docs/LegalServerAPI.v1.yaml)

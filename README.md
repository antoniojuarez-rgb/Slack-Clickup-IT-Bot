# TechStop Bot

## 1. Overview

**TechStop Bot** is an internal IT helpdesk automation service for **Felix Pago**. It connects **Slack**, **ClickUp**, and **Google Sheets** so employees can file IT tickets from a Slack Workflow and the team can manage them in ClickUp without copy-pasting between tools.

The bot **replaced a manual Slack ↔ ClickUp workflow** where tickets were created and updated by hand. Today, submissions flow through a structured pipeline: the workflow captures fields, a task is created in ClickUp, a rich message is posted to the IT channel, and thread activity (comments, take/close/reopen) stays in sync with ClickUp.

---

## 2. Features

| Area | Capability |
|------|------------|
| **Ticket creation** | Creates a ClickUp task from workflow data (name, description, priority, type, troubleshooting), posts a formatted Slack message in the configured channel, and stores mappings in Redis. |
| **Take ticket** | Assigns the task in ClickUp to the ClickUp user mapped from the Slack user who clicked **Take Ticket** (only users in `SLACK_TO_CLICKUP_USER_MAP`). |
| **Close ticket** | Closes the ClickUp task, updates the main Slack message, and posts a closure thread with a **Reopen** action. |
| **Reopen ticket** | Reopens the task within **24 hours** of close, limited to **at most 2** reopens per task; only the **assignee** or **reporter** (as stored in Redis) may reopen. |
| **Slack thread URL in ClickUp** | After the ticket message is posted, the public Slack thread URL is written to a dedicated ClickUp custom field for traceability. |
| **Requester @mention resolution** | Resolves the workflow “requester” string to a Slack user ID via `users.list` matching (display name / real name / username) so the ticket message can show `<@U…>`. |
| **Unauthorized user blocking** | Users not in the Slack→ClickUp map cannot take tickets; reopen is restricted to assignee/reporter; Slack signatures reject forged Events/interaction payloads (unless local skip is enabled). |
| **Alerts channel** | Operational errors and important failures are summarized to `SLACK_ALERTS_CHANNEL_ID` via `chat.postMessage`. |
| **Idempotency (ticket creation)** | Duplicate submissions with the same `X-Idempotency-Key` header return `200` with `duplicate` status without creating a second task (Redis, 24-hour TTL). |
| **Rate limiting** | **Per IP** on the Sheets webhook path (Redis-backed, 10 requests / 60s per IP when Redis is available). **Per Slack user** on Events and interactions (in-memory, 10 requests / minute per user ID). If Redis is unavailable (e.g. local dev), IP limiting fails open with a warning. |
| **Comment sync** | Slack thread replies on ticket threads can be posted as ClickUp task comments (Events API handler). |

---

## 3. Architecture

```text
Slack Workflow (form)
        │
        ▼
Google Sheet (one row per submission)  ◄── temporary integration layer
        │
        ▼
Google Apps Script (HTTP POST + headers)
        │
        ▼
TechStop Bot (Express on Google Cloud Run)
        ├──► ClickUp API v2   (tasks, comments, custom fields, status)
        ├──► Upstash Redis    (thread↔task, reporter, assignee, reopen state, idempotency, IP rate limits)
        └──► Slack Web API  (messages, updates, users, alerts)
```

**Google Sheets** is a **temporary workaround**: it buffers workflow output and triggers the bot via Apps Script. The long-term plan is to **migrate to a custom JavaScript Slack Workflow Step** that calls Cloud Run directly—eliminating the spreadsheet hop and reducing latency on ticket creation.

---

## 4. API Endpoints

| Endpoint | Method | Typical caller | Purpose |
|----------|--------|----------------|---------|
| `/api/sheets-webhook` | `POST` | Google Apps Script | Authenticated with `X-Webhook-Secret`; creates ClickUp task, posts Slack message, optional idempotency via `X-Idempotency-Key`. |
| `/api/slack-interaction` | `POST` | Slack (Interactive Components) | `payload` form field; block actions: take / close / reopen ticket. |
| `/api/take-ticket` | `POST` | Slack (legacy or alternate button URL) | Same handler as `/api/slack-interaction` for compatibility. |
| `/api/slack-events` | `POST` | Slack (Events API) | URL verification challenge; `message` events in threads sync replies to ClickUp comments. |
| `/health` | `GET` | Load balancers / Cloud Run / operators | JSON `{ "status": "ok" }` for readiness and monitoring. |

All integration routes expect **HTTPS** in production. Raw request bodies are preserved for Slack signature verification (no global JSON body parser on those routes).

---

## 5. Tech Stack

| Technology | Role |
|------------|------|
| **Node.js 20** | Runtime (see `Dockerfile`; `package.json` allows `>=18` for flexibility). |
| **TypeScript** | Typed application and shared libraries. |
| **Express** | HTTP server; mounts former serverless handlers as route handlers. |
| **Google Cloud Run** | Primary deployment target: containerized service, autoscaling, HTTPS. |
| **Slack API** | Workflows, Events, Interactivity, `users.list`, `chat.postMessage`, etc. |
| **ClickUp API v2** | Tasks, assignees, comments, statuses, custom fields. |
| **Upstash Redis** | Serverless-compatible Redis over HTTPS (REST). |
| **Google Sheets + Apps Script** | Bridge from Slack Workflow to the bot until the Workflow Step migration. |

---

## 6. Libraries & Dependencies

### Runtime (`dependencies`)

| Package | Purpose |
|---------|---------|
| `express` | HTTP server and routing. |
| `@vercel/node` | Types (`VercelRequest` / `VercelResponse`) shared by API handler modules. |
| `@upstash/redis` | Redis client for Upstash (state, rate limits, idempotency). |
| `dotenv` | Loads `.env` when present (used from application entrypoint). |

### Development (`devDependencies`)

| Package | Purpose |
|---------|---------|
| `typescript` | Compiler (`tsc`) for production builds. |
| `tsx` | Run TypeScript directly for `npm run dev`. |
| `@types/node`, `@types/express` | Type definitions. |
| `vitest` | Unit test runner (`npm test`). |

---

## 7. Infrastructure

### Google Cloud Run (recommended shape)

Configure the service in the Google Cloud console or via Infrastructure as Code. Exact values depend on traffic and org policy; typical choices:

| Setting | Notes |
|---------|--------|
| **Region** | Choose a region close to users and Slack/ClickUp (e.g. `us-central1`). |
| **Memory** | Start around **256–512 MiB**; raise if you see OOM under peak webhook load. |
| **CPU** | **1 vCPU** is usually sufficient for I/O-bound webhooks; increase for sustained CPU. |
| **Min / max instances** | **Min 0** for cost; **max** set to cap spend and protect downstream APIs. |
| **Ingress** | **All** or **internal + load balancer** depending on whether only Apps Script / Slack must reach the service. |
| **Authentication** | Public **unauthenticated** invoke is common for Slack/Google webhooks **if** secrets are enforced in-app (`SLACK_SIGNING_SECRET`, `SHEETS_WEBHOOK_SECRET`). Alternatively, restrict ingress and use a proxy. |

The included **`Dockerfile`** builds with `npm ci`, runs `npm run build`, listens on **`PORT` (default 8080)**, and exposes a **`HEALTHCHECK`** against `/health`.

### Service account permissions

The Cloud Run runtime service account generally needs:

- **Artifact Registry** or **Container Registry** read (to pull the image).
- **Secret Manager Secret Accessor** (if you mount secrets from Secret Manager into env vars).
- No broad GCS or Compute permissions unless you add other integrations.

### Secret Manager (suggested secret names)

Store sensitive values as secrets and inject them as environment variables at deploy time. Align names with the [Environment variables](#12-environment-variables) table, for example:

- `CLICKUP_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SHEETS_WEBHOOK_SECRET`
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or legacy `UPSTASH_REDIS_URL` / `UPSTASH_REDIS_TOKEN`)

Non-secret IDs (list ID, channel IDs) can remain plain env configuration or secrets per org policy.

---

## 8. Security

| Control | Description |
|---------|-------------|
| **Slack HMAC (SHA256)** | `X-Slack-Signature` + `X-Slack-Request-Timestamp` verified against the raw body with the signing secret; rejects replay beyond **5 minutes**. |
| **Sheets webhook secret** | `X-Webhook-Secret` compared in constant time to `SHEETS_WEBHOOK_SECRET`. |
| **Rate limiting** | Redis-backed **per-IP** limits on the Sheets webhook (when Redis works); **per Slack user** in-memory limits on Events/interactions. |
| **Authorized user mapping** | Take-ticket and assignee behavior gated by `SLACK_TO_CLICKUP_USER_MAP`. |
| **Log redaction** | Structured logs sanitize keys matching token/secret/password patterns so credentials are not printed. |
| **No persistent disk** | Stateless containers; durable state is in ClickUp, Slack, and Redis only. |
| **HTTPS only** | Slack and ClickUp clients require TLS in production; Cloud Run terminates HTTPS. |
| **Local skip (Slack only)** | `SKIP_SLACK_VERIFY=true` bypasses HMAC **only when `NODE_ENV` is not `production`**. Never set this in production. |

---

## 9. Redis — Data & State

All TTLs below are **30 days** unless noted.

| Key pattern | Value | TTL | Purpose |
|-------------|-------|-----|---------|
| `thread:{thread_ts}` | ClickUp task ID | 30d | Map Slack thread timestamp → task for comment sync. |
| `reporter:{taskId}` | Slack user ID of requester | 30d | Reopen authorization and messaging context. |
| `assignee:{taskId}` | Slack user ID of assignee | 30d | Reopen authorization. |
| `closed_ts:{taskId}` | Unix seconds (string) when ticket was closed | 30d | Enforce **24h** reopen window. |
| `reopen_count:{taskId}` | Integer string (incremented) | 30d | Cap **2** reopens per task. |
| `reopen:{taskId}` | Slack message `ts` after reopen | 30d | Scope thread copy on next close. |
| `idempotency:{key}` | `"1"` marker | **24h** | Prevent duplicate ticket creation for same `X-Idempotency-Key`. |
| `ratelimit:ip:{ip}` | Request count | **60s** | Sheets webhook per-IP rate limit. |

---

## 10. Local Development

1. **Clone** this repository.
2. **Copy** `.env.example` to `.env` and fill in all required variables (see table below).
3. **Install** dependencies: `npm install`.
4. **Run** the API server: `npm run dev` → listens on **http://localhost:3000** (Express + `tsx`).
5. **Optional — Slack signature bypass for local tools**  
   Set `SKIP_SLACK_VERIFY=true` in `.env` when using hand-crafted `curl` or `scripts/test-local.sh` without valid `X-Slack-Signature`. This is **ignored when `NODE_ENV=production`** (e.g. Cloud Run Dockerfile), so production always verifies HMAC.
6. **Smoke test** health:  
   `curl -s http://localhost:3000/health`
7. **Sheets webhook** (with real secret and payload) or **Slack** tunnel (e.g. ngrok) pointed at `/api/slack-events` and `/api/slack-interaction` if you test end-to-end.

If Redis is not configured locally, several `lib/threadStore.ts` helpers **fail open** (warn + safe defaults) so you can still exercise parts of the stack; production should always have Redis.

---

## 11. Deployment

### GitHub → Cloud Build → Cloud Run (high level)

1. **Container image**  
   Use the repo **`Dockerfile`**: build and push to **Artifact Registry** (e.g. `REGION-docker.pkg.dev/PROJECT/REPO/techstop-bot:TAG`).

2. **Cloud Build**  
   Connect the GitHub repository to **Cloud Build triggers** (push to `main` or tags). The build step runs `docker build` and `docker push`.

3. **Deploy to Cloud Run**  
   Either add a second Cloud Build step `gcloud run deploy` or use **Cloud Deploy** / manual `gcloud run deploy` with the new image, env vars, and secrets.

4. **Secrets**  
   Prefer **Secret Manager** references for tokens; avoid baking secrets into the image.

5. **After deploy — update URLs**  
   - **Slack app**: [api.slack.com/apps](https://api.slack.com/apps) → your app → **Event Subscriptions** and **Interactivity & Shortcuts** → Request URLs → base URL `https://YOUR-SERVICE-URL.run.app` (paths `/api/slack-events`, `/api/slack-interaction`).  
   - **Google Apps Script**: update the webhook URL to `https://YOUR-SERVICE-URL.run.app/api/sheets-webhook` and keep `X-Webhook-Secret` aligned with `SHEETS_WEBHOOK_SECRET`.

### Vercel note

Some handlers still use `@vercel/node` types from the prior serverless layout. **Vercel → Google Cloud Run migration is in progress** at Felix Pago (Vercel is not an officially approved platform). **Vercel-specific configuration will be removed** once Cloud Run deployment is fully confirmed and types are inlined or replaced.

---

## 12. Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| `PORT` | Optional | HTTP port (default **8080** in Docker; `npm run dev` sets **3000**). |
| `NODE_ENV` | Optional | Set to `production` in Cloud Run; disables `SKIP_SLACK_VERIFY`. |
| `CLICKUP_API_KEY` | **Yes** | ClickUp personal or OAuth API token. |
| `CLICKUP_LIST_ID` | **Yes** | Target list ID for new tasks. |
| `CLICKUP_REOPEN_STATUS` | Optional | ClickUp status name when reopening (default `open`). |
| `SLACK_BOT_TOKEN` | **Yes** | Bot token (`xoxb-…`). |
| `SLACK_SIGNING_SECRET` | **Yes** | Signing secret for Slack request verification. |
| `SLACK_CHANNEL_ID` | **Yes** | Channel where ticket messages are posted. |
| `SLACK_ALERTS_CHANNEL_ID` | **Yes** | Channel for operational alerts. |
| `ITOPS_TEAM_TAG` | Optional | Tag string for high-priority mentions (default `@itopsteam`). |
| `SLACK_TO_CLICKUP_USER_MAP` | Optional* | JSON map `SlackUserId` → ClickUp user id (number). *Required for **Take Ticket** to authorize anyone. |
| `SHEETS_WEBHOOK_SECRET` | **Yes** for Sheets path | Shared secret sent as `X-Webhook-Secret`. |
| `UPSTASH_REDIS_REST_URL` | **Yes** in prod | Upstash Redis REST URL. |
| `UPSTASH_REDIS_REST_TOKEN` | **Yes** in prod | Upstash REST token. |
| `UPSTASH_REDIS_URL` | Optional | Legacy alias for URL. |
| `UPSTASH_REDIS_TOKEN` | Optional | Legacy alias for token. |
| `SKIP_SLACK_VERIFY` | Optional | If `true`, skips Slack HMAC **outside** `NODE_ENV=production` only. |

---

## 13. Testing

- **Unit tests**: `npm test` (Vitest, `vitest run`). Use `npm run test:watch` during development.
- **Local Slack interaction smoke tests**: `./scripts/test-local.sh` (requires `SLACK_CHANNEL_ID`, `TASK_ID`, server on port 3000, and usually `SKIP_SLACK_VERIFY=true` plus `set -a && source .env && set +a`).

---

## 14. Roadmap & Pending Migration

- **Google Sheets → Custom JavaScript Slack Workflow Step** — Eliminates the Sheets intermediary and the **10s delay** on ticket creation.
- **Vercel → Google Cloud Run migration (in progress)** — Vercel is not an officially approved platform at Felix Pago. All Vercel-specific configuration will be removed once Cloud Run deployment is confirmed.
- **`files:read` and `users:read.email` OAuth scopes** — Pending SecOps approval for richer Slack integrations.
- **File and image attachments** — From Slack thread to ClickUp task.
- **SLA timer alerts** — For high-priority tickets.
- **Requester DM notifications** — On ticket updates.
- **Weekly metrics report** — Operational visibility for the IT queue.

---

## License & ownership

Internal Felix Pago project. Do not commit `.env` or real tokens; use Secret Manager and least-privilege service accounts in production.

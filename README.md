# IT Helpdesk Bot — Slack ↔ ClickUp

This bot connects the Slack IT helpdesk form to ClickUp. Employees submit tickets from Slack, IT engineers manage them from Slack, and everything stays in sync with ClickUp automatically.

---

## Submitting a ticket

Fill out the IT helpdesk form in Slack (via the Workflow). You'll provide:

- **Your name** — who is making the request
- **Type of request** — e.g. "Access Request", "Hardware Issue"
- **Description** — what you need or what's wrong
- **Priority** — how urgent it is (see below)
- **Troubleshooting steps** — (optional) what you've already tried

Once submitted, the bot creates a ticket in ClickUp and posts a message to the IT Slack channel. You don't need to do anything else — the IT team will see it and pick it up.

---

## What happens after you submit

1. A ticket card appears in the IT Slack channel with your request details and a link to the ClickUp task.
2. High-priority tickets also tag `@itopsteam` so the team is alerted right away.
3. The ticket is assigned in ClickUp once an engineer claims it.
4. Any replies you post in the Slack thread are automatically added as comments on the ClickUp task, so everything is tracked in one place.

---

## How IT engineers manage tickets

### Take Ticket

When an engineer is ready to work on a ticket, they click **Take Ticket** on the Slack message. This:

- Assigns the ClickUp task to that engineer
- Updates the Slack message to show "Claimed by @name"
- Disables the Take Ticket button so others know it's taken

### Close Ticket

Once the work is done, the engineer clicks **Close Ticket** (only visible after the ticket has been claimed). This:

- Sets the ClickUp task status to complete
- Updates the Slack message to show "Closed by @name"
- Disables both the Take Ticket and Close Ticket buttons

---

## Priority levels

| Priority | Meaning |
|----------|---------|
| **Critical** | Urgent — business-blocking, needs immediate attention |
| **High** | Important — significant impact, respond today; tags `@itopsteam` |
| **Medium** | Normal — standard request, respond within SLA |
| **Low** | Minor — low impact, address when capacity allows |

When in doubt, use **Medium**. Reserve **Critical** and **High** for issues that are actively blocking work.

---

## Technical details

### Stack

- **Runtime:** Node.js 20, TypeScript (strict, ESM)
- **Hosting:** Vercel Serverless Functions
- **APIs:** Slack API (Block Kit, Events API, Interactivity), ClickUp API v2
- **Testing:** Vitest

### Project structure

```
/api
  sheets-webhook.ts      ← Google Sheets / webhook → ClickUp task → Slack message
  slack-interaction.ts   ← Take Ticket / Close Ticket button handler
  slack-events.ts        ← Thread replies → ClickUp comments
  take-ticket.ts         ← Alias for slack-interaction

/lib
  clickup.ts             ← ClickUp API client (createTask, updateTask, closeTask, postComment)
  slack.ts               ← Block Kit builders + Slack API calls
  priority.ts            ← Priority mapping Slack → ClickUp
  security.ts            ← Slack signature verification + rate limiting
  threadStore.ts         ← In-memory thread_ts → task_id mapping

/types
  clickup.ts, slack.ts

/config
  env.ts                 ← Env variable accessors

/utils
  logger.ts              ← Structured logging (redacts secrets)
  validator.ts           ← Payload validation
  request.ts             ← Shared getRawBody for Slack signature verification

/tests
  *.test.ts
```

### API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/sheets-webhook` | Receive webhook (e.g. Google Apps Script), create ClickUp task, post to Slack |
| POST | `/api/slack-interaction` | Handle Take Ticket and Close Ticket button clicks |
| POST | `/api/slack-events` | Slack Events API: url_verification + thread replies → ClickUp comments |
| POST | `/api/take-ticket` | Alias for `/api/slack-interaction` |

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLICKUP_API_KEY` | ✅ | ClickUp personal API token |
| `CLICKUP_LIST_ID` | ✅ | ClickUp list ID where tasks are created |
| `SLACK_BOT_TOKEN` | ✅ | Slack Bot OAuth token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | ✅ | From Slack App → Basic Information |
| `SLACK_CHANNEL_ID` | ✅ | Channel ID where ticket messages are posted |
| `ITOPS_TEAM_TAG` | ❌ | Default: `@itopsteam` |
| `SLACK_TO_CLICKUP_USER_MAP` | ❌ | JSON: `{"SLACK_USER_ID": CLICKUP_USER_ID}` |
| `UPSTASH_REDIS_URL` | ❌ | For persistent thread → task mapping |
| `UPSTASH_REDIS_TOKEN` | ❌ | For persistent thread → task mapping |

### Security

- Slack requests verified via `X-Slack-Signature` (HMAC SHA256) and timestamp (replay window: 5 min)
- Rate limiting: 10 requests/min per Slack user ID
- All secrets via environment variables only — never logged or hardcoded
- Logged events: `ticket_created`, `ticket_claimed`, `ticket_closed`, `comment_synced`, `api_error`, `validation_error`, `security_reject`

### Development

```bash
npm install
npm run build
npm test
npm run dev   # Vercel dev server
```

# CLAUDE.md — Slack ↔ ClickUp IT Helpdesk Bot

This file gives Claude Code full context to work on this project autonomously.
Read this before touching any file.

---

## What this project does

A Vercel backend that connects Slack Workflow Forms with ClickUp tasks.

1. Employee submits IT ticket via Slack Workflow Form
2. Backend creates a ClickUp task
3. Backend posts a Block Kit message to the IT Slack channel
4. Engineers click "Take Ticket" → assigns the task in ClickUp
5. Replies in the Slack thread → automatically become ClickUp comments

---

## Tech stack

- **Runtime:** Node.js 20
- **Hosting:** Vercel Serverless Functions
- **Language:** TypeScript (strict mode, ESM `"type": "module"`)
- **Module resolution:** NodeNext
- **Testing:** Vitest
- **HTTP:** Native `fetch` (no axios)

---

## Project structure

```
/api
  create-ticket.ts       ← Slack webhook → ClickUp task → Slack message
  slack-interaction.ts   ← "Take Ticket" button handler
  slack-events.ts        ← Thread replies → ClickUp comments
  take-ticket.ts         ← Forwards to slack-interaction logic

/lib
  clickup.ts             ← ClickUp API client (createTask, getTask, updateTask, postComment, getTaskUrl)
  slack.ts               ← Block Kit builder + Slack API calls
  priority.ts            ← Priority mapping Slack → ClickUp
  security.ts            ← Slack signature verification + rate limiting
  threadStore.ts         ← In-memory thread_ts → task_id mapping

/types
  clickup.ts             ← ClickUp request/response types
  slack.ts               ← Slack payload and block types

/config
  env.ts                 ← Env variable accessors (lazy getters, never expose secrets)

/utils
  logger.ts              ← Structured logging, redacts sensitive keys (events: ticket_created, ticket_claimed, comment_synced, api_error, validation_error, security_reject)
  validator.ts           ← Payload validation (flat + workflow_step.inputs)
  request.ts             ← Shared getRawBody stream reader for all API handlers

/tests
  priority.test.ts
  validator.test.ts
  security.test.ts
  clickup.test.ts
  slack.test.ts

vercel.json
package.json
tsconfig.json
```

---

## Environment variables

Set these in Vercel → Settings → Environment Variables. Never hardcode.

| Variable | Required | Description |
|---|---|---|
| `CLICKUP_API_KEY` | ✅ | ClickUp personal API token |
| `CLICKUP_LIST_ID` | ✅ | ClickUp list ID where tasks are created |
| `SLACK_BOT_TOKEN` | ✅ | Slack Bot OAuth token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | ✅ | From Slack App → Basic Information |
| `SLACK_CHANNEL_ID` | ✅ | Channel ID where tickets are posted |
| `ITOPS_TEAM_TAG` | ❌ | Default: `@itopsteam` |
| `SLACK_TO_CLICKUP_USER_MAP` | ❌ | JSON: `{"U01234": 12345678}` |
| `UPSTASH_REDIS_URL` | ❌ | For thread→task mapping persistence |
| `UPSTASH_REDIS_TOKEN` | ❌ | For thread→task mapping persistence |

---

## Known bugs — fixed

### ✅ BUG 1 — bodyParser breaks Slack signature verification

**Files:** `api/create-ticket.ts`, `api/slack-interaction.ts`

Vercel parses the body before the handler runs. When we re-serialize it with
`JSON.stringify`, the raw body changes and the HMAC signature check always fails.

**Fix:** Add `export const config = { api: { bodyParser: false } }` to both files,
and replace `getRawBody` with a stream reader:

```ts
export const config = { api: { bodyParser: false } };

function getRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
```

Then make the handler `async` and `await getRawBody(req)`.

---

### ✅ BUG 2 — ClickUp assignees payload structure is wrong

**Files:** `types/clickup.ts`, `lib/clickup.ts`

The ClickUp API expects `{ assignees: { add: [userId] } }` but the current
type uses `assignees?: number[]` (flat array) and uses `PUT` instead of `POST`.

**Fix in `types/clickup.ts`:**
```ts
export interface ClickUpUpdateTaskPayload {
  assignees?: { add: number[] };
}
```

**Fix in `lib/clickup.ts`:**
```ts
export async function updateTask(
  taskId: string,
  payload: ClickUpUpdateTaskPayload
): Promise<ClickUpTaskResponse> {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}`, {
    method: "POST",  // was PUT
    headers: getHeaders(),
    body: JSON.stringify({
      assignees: { add: payload.assignees?.add ?? [] }
    }),
  });
  ...
}
```

**Fix in `api/slack-interaction.ts`** — update the call:
```ts
await updateTask(taskId, { assignees: { add: [clickUpUserId] } });
```

---

## Implemented features

### ✅ `api/slack-events.ts` — Thread → ClickUp comment sync

Implemented. It:

1. Receive Slack Events API POST to `/api/slack-events`
2. Handle `url_verification` challenge (Slack sends this on first setup)
3. Verify Slack signature on all requests
4. Listen for `message` events where `thread_ts` is set (replies in a thread)
5. Look up the ClickUp `task_id` from a thread mapping store using `thread_ts`
6. Post a comment to ClickUp: `POST /task/{task_id}/comment`

**Thread mapping:** Store `thread_ts → task_id` in memory (Map) for now.
When `postMessage` is called in `create-ticket.ts`, save the returned `ts`
and the `taskId` into the store.

**Comment format:**
```
Slack User: @username

Message:
[text of the reply]
```

**ClickUp endpoint:**
```
POST https://api.clickup.com/api/v2/task/{task_id}/comment
Body: { "comment_text": "...", "notify_all": false }
```

**Thread store interface** (create `/lib/threadStore.ts`):
```ts
const store = new Map<string, string>(); // thread_ts → task_id

export function saveThreadMapping(threadTs: string, taskId: string): void
export function getTaskIdForThread(threadTs: string): string | undefined
```

---

## Testing — done

All tests are in `/tests/`. Use Vitest.

### Tests to write:

**`tests/priority.test.ts`**
- `slackPriorityToClickUp("Critical")` → 1
- `slackPriorityToClickUp("High")` → 2
- `slackPriorityToClickUp("Medium")` → 3
- `slackPriorityToClickUp("Low")` → 4
- `slackPriorityToClickUp("")` → 3 (default)
- `isHighPriority("High")` → true
- `isHighPriority("Critical")` → true
- `isHighPriority("Medium")` → false

**`tests/validator.test.ts`**
- Valid flat payload passes
- Missing `requester` fails with correct missing field
- `workflow_step.inputs` format also passes
- Empty `description` fails

**`tests/security.test.ts`**
- Valid signature returns true
- Wrong secret returns false
- Expired timestamp (>5min) returns false
- Rate limit allows 10, blocks 11th
- Rate limit resets after 1 minute

**`tests/clickup.test.ts`**
- `createTask` calls correct URL with correct headers (mock fetch)
- `getTask` returns task with custom_id
- `updateTask` uses POST and `{ assignees: { add: [...] } }`
- `getTaskUrl` returns correct URL format

**`tests/slack.test.ts`**
- `buildTicketMessageBlocks` includes all required fields
- `markBlocksAsClaimed` disables take_ticket button
- `markBlocksAsClaimed` adds claimed context block
- `maybeAddHighPriorityMention` adds mention for High
- `maybeAddHighPriorityMention` adds mention for Critical
- `maybeAddHighPriorityMention` does NOT add for Medium

---

## Priority mapping reference

| Slack value | ClickUp ID | Meaning |
|---|---|---|
| Critical | 1 | Urgent |
| High | 2 | High |
| Medium | 3 | Normal |
| Low | 4 | Low |

---

## Slack field mapping

Slack form fields → ClickUp task:

| Slack field | ClickUp field | Notes |
|---|---|---|
| `type_of_request` + `description` | `name` | `[type] description (max 80 chars)` |
| `requester`, `priority`, `description`, `troubleshooting_steps` | `description` | Markdown formatted |
| `priority` | `priority` | Via priorityMap |

---

## Security rules (never break these)

1. Always verify `X-Slack-Signature` using HMAC SHA256 with raw body
2. Reject timestamps older than 5 minutes (replay attack prevention)
3. Use `crypto.timingSafeEqual` for signature comparison
4. Never log `CLICKUP_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`
5. All secrets come from `process.env` only
6. Rate limit: max 10 requests/min per Slack user ID

---

## Vercel constraints

- Free tier: 100k executions/month
- Max execution: 10s (we set 30s in vercel.json as buffer but target <3s)
- Must respond to Slack within 3 seconds or Slack retries

---

## Code style

- TypeScript strict mode — no `any`, use proper types
- ESM imports with `.js` extensions (e.g. `import { x } from "../lib/foo.js"`)
- Async/await, no callbacks
- All errors caught and logged with `log()` from `utils/logger.ts`
- Never throw from API handlers — always return HTTP response
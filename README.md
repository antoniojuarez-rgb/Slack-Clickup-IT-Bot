# IT Helpdesk Automation — Slack → ClickUp

A secure automation service that receives IT helpdesk requests from a **Slack Workflow Form**, creates **ClickUp** tickets, and lets the IT team **claim tickets** from Slack.

## Features

- **Slack Workflow → ClickUp**: Form submissions create tasks in a ClickUp list and post a formatted message to a Slack channel.
- **Custom Task ID**: Displays the ClickUp Custom Task ID (e.g. `ITOPS-###`) and a clickable ticket link.
- **Take Ticket**: IT staff can click **Take Ticket** in Slack; the task is assigned in ClickUp and the message is updated (button disabled, “Claimed by @user”).
- **High-priority alert**: If priority is **High**, the Slack message includes `@itopsteam`.
- **Security**: Slack request verification (signature + timestamp), request validation, rate limiting (10 req/min per user), and env-only secrets.

## Stack

- **Runtime**: Node.js, TypeScript
- **Hosting**: Vercel (serverless API)
- **APIs**: Slack API, ClickUp API

## Project structure

```
/api
  create-ticket.ts    # Slack workflow webhook → create task → post to Slack
  take-ticket.ts     # Alias for slack-interaction (Take Ticket)
  slack-interaction.ts # Handles Take Ticket button and updates message

/lib
  clickup.ts         # ClickUp: create task, get task, update assignees
  slack.ts          # Slack: post/update message, Block Kit builders
  priority.ts       # Slack priority → ClickUp priority mapping
  security.ts       # Slack signature verification, rate limiting

/types
  slack.ts, clickup.ts

/config
  env.ts            # Environment variable access

/utils
  logger.ts         # Structured logging (no tokens)
  validator.ts      # Workflow payload validation

/tests
  *.test.ts         # Unit and integration-style tests
```

## Environment variables (Vercel)

Set these in the Vercel project (never commit):

| Variable | Description |
|----------|-------------|
| `CLICKUP_API_KEY` | ClickUp API token |
| `CLICKUP_LIST_ID` | ClickUp list ID where tasks are created |
| `SLACK_BOT_TOKEN` | Slack Bot token (e.g. `xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack Signing Secret for request verification |
| `SLACK_CHANNEL_ID` | Channel ID where ticket messages are posted |
| `ITOPS_TEAM_TAG` | (Optional) Tag for high-priority alerts, default `@itopsteam` |
| `SLACK_TO_CLICKUP_USER_MAP` | (Optional) JSON map: `{"SLACK_USER_ID": CLICKUP_USER_ID}` for Take Ticket assignment |

## Slack workflow input

The workflow that sends the webhook should provide (flat or via `workflow_step.inputs`):

- `requester` — e.g. `@user`
- `description` — request details
- `priority` — `Low` | `Medium` | `High` | `Critical`
- `type_of_request` — e.g. “Access Request”
- `troubleshooting_steps` — (optional)

## Priority mapping

| Slack   | ClickUp |
|---------|---------|
| Critical | 1 (Urgent) |
| High     | 2 (High)  |
| Medium   | 3 (Normal) |
| Low      | 4 (Low)   |

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/create-ticket` | Slack workflow webhook: create ClickUp task, post message to Slack |
| POST | `/api/slack-interaction` | Slack Interactivity (e.g. Take Ticket button) |
| POST | `/api/take-ticket` | Same as `slack-interaction` (alternative URL) |

## Slack configuration

1. **Workflow**: Add a “Send to Webhook” step that POSTs to  
   `https://<your-vercel-domain>/api/create-ticket`  
   with the form variables (e.g. `requester`, `description`, `priority`, `type_of_request`, `troubleshooting_steps`).  
   Ensure the webhook sends **JSON** and that your app can access the **raw request body** for signature verification (see Vercel docs if needed).

2. **Interactivity**: In Slack App → Interactivity & Shortcuts, set **Request URL** to  
   `https://<your-vercel-domain>/api/slack-interaction`  
   (or `/api/take-ticket`).

3. **Bot scopes**: `chat:write`, `users:read` (and any needed for the channel you post to).

## Take Ticket and user mapping

When someone clicks **Take Ticket**, the app:

1. Reads the Slack user ID from the interaction.
2. Looks up the ClickUp user ID from `SLACK_TO_CLICKUP_USER_MAP` (e.g. `{"U01234": 12345678}`).
3. Assigns the task in ClickUp via `PUT /task/{task_id}` with `assignees: [clickup_user_id]`.
4. Updates the Slack message (disables button, adds “Claimed by @username”).

If `SLACK_TO_CLICKUP_USER_MAP` is missing or the user is not in the map, the message is still updated in Slack but the ClickUp task is not assigned.

## Security

- **Slack requests**: Verified using `X-Slack-Signature` (HMAC SHA256) and `X-Slack-Request-Timestamp` (replay window).
- **Secrets**: Only in Vercel environment variables.
- **Validation**: Required workflow fields are validated before creating a task.
- **Rate limiting**: 10 requests per minute per Slack user (in-memory per instance).
- **Logging**: Events like `ticket_created`, `ticket_claimed`, `api_error` are logged; tokens are never logged.

## Development and tests

```bash
npm install
npm run build
npm test
npm run dev   # Vercel dev server
```

## Deployment (Vercel)

1. Connect the GitHub repo to Vercel.
2. Set all required environment variables in the Vercel project.
3. Deploy; `/api/*` routes become serverless functions.

## Raw body and Slack verification

Slack signature verification requires the **raw request body**. If your deployment does not expose it (e.g. body is pre-parsed), you may need to:

- Use a runtime or config that provides the raw body for the webhook and interaction endpoints, or
- Follow Vercel’s guidance for reading the raw body in serverless functions.

---

**Deliverable**: A secure backend that receives Slack helpdesk requests, creates ClickUp tickets, shows ticket cards in Slack, allows claiming from Slack, tags `@itopsteam` for high priority, and keeps credentials and validation production-ready.

#!/usr/bin/env bash
# Simulate Slack block_actions against a local Express server.
#
# Requires:
#   - Server: npm run dev (listens on http://localhost:3000)
#   - SLACK_CHANNEL_ID — same as in .env
#   - TASK_ID — replaces TASK_ID_HERE; use the last created ClickUp task id (e.g. from webhook JSON)
#
# Signature headers are placeholders; use SKIP_SLACK_VERIFY=true in .env for local runs
# (never enable that in production).

set -euo pipefail

: "${SLACK_CHANNEL_ID:?Set SLACK_CHANNEL_ID (e.g. source .env or export from .env)}"
: "${TASK_ID:?Set TASK_ID to the last created ClickUp task id (e.g. export TASK_ID=86abc1234)}"

MSG_TS="1234567890.123456"

take_payload=$(cat <<EOF
{"type":"block_actions","user":{"id":"U0AG1MU7N07","name":"Antonio Juarez"},"channel":{"id":"${SLACK_CHANNEL_ID}"},"message":{"ts":"${MSG_TS}"},"actions":[{"action_id":"take_ticket","value":"${TASK_ID}"}]}
EOF
)

close_payload=$(cat <<EOF
{"type":"block_actions","user":{"id":"U0AG1MU7N07","name":"Antonio Juarez"},"channel":{"id":"${SLACK_CHANNEL_ID}"},"message":{"ts":"${MSG_TS}"},"actions":[{"action_id":"close_ticket","value":"${TASK_ID}"}]}
EOF
)

reopen_payload=$(cat <<EOF
{"type":"block_actions","user":{"id":"U0AG1MU7N07","name":"Antonio Juarez"},"channel":{"id":"${SLACK_CHANNEL_ID}"},"message":{"ts":"${MSG_TS}","thread_ts":"${MSG_TS}"},"actions":[{"action_id":"reopen_ticket","value":"${TASK_ID}"}]}
EOF
)

echo "=== 1. Take Ticket ===" >&2
curl -sS -X POST "http://localhost:3000/api/slack-interaction" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "X-Slack-Signature: v0=test" \
  -H "X-Slack-Request-Timestamp: $(date +%s)" \
  --data-urlencode "payload=${take_payload}"

echo "=== 2. Close Ticket ===" >&2
curl -sS -X POST "http://localhost:3000/api/slack-interaction" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "X-Slack-Signature: v0=test" \
  -H "X-Slack-Request-Timestamp: $(date +%s)" \
  --data-urlencode "payload=${close_payload}"

echo "=== 3. Reopen Ticket ===" >&2
curl -sS -X POST "http://localhost:3000/api/slack-interaction" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "X-Slack-Signature: v0=test" \
  -H "X-Slack-Request-Timestamp: $(date +%s)" \
  --data-urlencode "payload=${reopen_payload}"

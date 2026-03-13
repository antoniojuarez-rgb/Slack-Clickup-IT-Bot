/**
 * Environment variable config. Values must be set in Vercel.
 * Never commit secrets.
 */

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvOptional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

/** JSON map of Slack user ID -> ClickUp user ID (number). e.g. {"U01234": 12345678} */
function getSlackToClickUpUserMap(): Record<string, number> {
  const raw = process.env.SLACK_TO_CLICKUP_USER_MAP;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export const env = {
  CLICKUP_API_KEY: () => getEnv("CLICKUP_API_KEY"),
  CLICKUP_LIST_ID: () => getEnv("CLICKUP_LIST_ID"),
  SLACK_BOT_TOKEN: () => getEnv("SLACK_BOT_TOKEN"),
  SLACK_SIGNING_SECRET: () => getEnv("SLACK_SIGNING_SECRET"),
  SLACK_CHANNEL_ID: () => getEnv("SLACK_CHANNEL_ID"),
  ITOPS_TEAM_TAG: () => getEnvOptional("ITOPS_TEAM_TAG", "@itopsteam"),
  SLACK_TO_CLICKUP_USER_MAP: getSlackToClickUpUserMap,
  /** ClickUp status name when reopening a task (e.g. "open", "to do"). Default: "open" */
  CLICKUP_REOPEN_STATUS: () => getEnvOptional("CLICKUP_REOPEN_STATUS", "open"),
} as const;

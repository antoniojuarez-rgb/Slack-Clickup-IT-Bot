/**
 * HTTP server for Google Cloud Run (and other Node hosts).
 * Vercel serverless handlers are mounted as Express routes; no global body parser so raw bodies work for Slack/webhooks.
 */

import express from "express";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import sheetsWebhook from "./api/sheets-webhook.js";
import slackEvents from "./api/slack-events.js";
import slackInteraction from "./api/slack-interaction.js";

const app = express();

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

function mount(
  fn: (req: VercelRequest, res: VercelResponse) => Promise<void>
): express.RequestHandler {
  return (req, res, next) => {
    fn(
      req as unknown as VercelRequest,
      res as unknown as VercelResponse
    ).catch(next);
  };
}

app.post("/api/sheets-webhook", mount(sheetsWebhook));
app.post("/api/slack-events", mount(slackEvents));
app.post("/api/slack-interaction", mount(slackInteraction));
app.post("/api/take-ticket", mount(slackInteraction));

const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log(`Listening on port ${port}`);
});

/**
 * TEMPORARY DEBUG ENDPOINT — remove after use.
 * Verifies that CLICKUP_API_KEY is readable by Vercel at runtime.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.CLICKUP_API_KEY;
  res.status(200).json({
    exists: !!key,
    prefix: key ? key.slice(0, 10) : null,
  });
}

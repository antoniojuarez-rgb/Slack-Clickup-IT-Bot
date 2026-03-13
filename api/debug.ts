import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.CLICKUP_API_KEY ?? "";
  res.json({
    exists: key.length > 0,
    prefix: key.slice(0, 6),
    length: key.length,
  });
}

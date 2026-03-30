import type { VercelRequest } from "@vercel/node";

export class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Read request body as UTF-8 string. If maxBytes is set, rejects with PayloadTooLargeError when exceeded.
 */
export function getRawBody(req: VercelRequest, maxBytes?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let received = 0;

    const onData = (chunk: Buffer) => {
      received += chunk.length;
      if (maxBytes !== undefined && received > maxBytes) {
        cleanup();
        req.destroy();
        reject(new PayloadTooLargeError());
        return;
      }
      body += chunk.toString();
    };

    const onEnd = () => {
      cleanup();
      resolve(body);
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    function cleanup() {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    }

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

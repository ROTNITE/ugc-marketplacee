import type { IncomingMessage, ServerResponse } from "node:http";
import { pinoHttp } from "pino-http";
import { logger } from "./logger.js";

/**
 * Express middleware: structured access logs with request IDs.
 *
 * - Auto-correlates each log line with `req.id`.
 * - Strips noisy paths (/health) below `info`.
 * - Skips logging entirely under NODE_ENV=test.
 */
export const httpLogger = pinoHttp({
  logger,
  customLogLevel(_req: IncomingMessage, res: ServerResponse, err: Error | undefined) {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage(req: IncomingMessage, res: ServerResponse) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  autoLogging: {
    ignore: (req: IncomingMessage) => req.url === "/health"
  }
});

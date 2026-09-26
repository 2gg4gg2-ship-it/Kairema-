import type { Request, RequestHandler, Response } from "express";
import { resolveRequestUser } from "./_core/context";
import { getWebSearchStatus } from "./web-search";

/**
 * TEMPORARY read-only diagnostic for the staging web-search failure.
 *
 * Access follows the ordinary permanent-session rule used by `requireUser`
 * (server/_core/trpc.ts): an anonymous request and a guest cookie are both
 * rejected, so a guest can never read this. No owner claim, no new secret and
 * no new env var are involved.
 *
 * It returns the already-persisted web-search status and never runs a search,
 * never contacts a provider, and never writes to the database: the only work is
 * a single read of the stored status via `getWebSearchStatus()`.
 *
 * The response is assembled field-by-field on purpose, so a future field added
 * to `WebSearchStatus` cannot silently widen this endpoint's exposure.
 */
export function createWebSearchDiagnosticHandler(): RequestHandler {
  return async (req: Request, res: Response) => {
    const user = await resolveRequestUser({ req }).catch(() => null);
    // Same predicate as requireUser: no session and a guest session both fail.
    if (!user || user.isGuest === 1) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const status = await getWebSearchStatus();
      res.json({
        available: status.available,
        reason: status.reason,
        checkedAt: status.checkedAt,
        youHttp: status.youHttp,
        serperHttp: status.serperHttp,
        exaHttp: status.exaHttp,
        googleHttp: status.googleHttp,
        tavilyHttp: status.tavilyHttp,
        openrouterHttp: status.openrouterHttp,
        layers: status.layers,
      });
    } catch {
      res.status(500).json({ error: "web-search-status-unavailable" });
    }
  };
}

export function registerWebSearchDiagnosticRoute(app: { get: (path: string, handler: RequestHandler) => unknown }) {
  app.get("/api/diagnostic/web-search-status", createWebSearchDiagnosticHandler());
}

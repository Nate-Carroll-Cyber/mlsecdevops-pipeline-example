/**
 * Backend bearer-token auth middleware.
 * Shared by every Counter-Spy service that needs to reject anonymous traffic
 * (gateway + sam-spade-service for now). Each service constructs its own
 * middleware with its INTERCEPT_BEARER_TOKEN at boot.
 */
import type { NextFunction, Request, Response } from 'express';

export type AuthenticatedRequest = Request & { authenticatedCallerId?: string };

export function createBackendAuthMiddleware(interceptBearerToken: string | undefined) {
  return function requireBackendAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const authHeader = req.header('authorization');
    if (!interceptBearerToken || authHeader !== `Bearer ${interceptBearerToken}`) {
      res.status(401).json({ error: 'Unauthorized protected route request.' });
      return;
    }

    const callerId = req.header('x-counter-spy-user-id')?.trim();
    if (callerId) {
      req.authenticatedCallerId = callerId;
    }
    next();
  };
}

export function getAuthenticatedCallerId(req: AuthenticatedRequest, res: Response): string | null {
  const callerId = req.authenticatedCallerId;
  if (!callerId) {
    res.status(401).json({ error: 'Missing authenticated caller identity.' });
    return null;
  }
  return callerId;
}

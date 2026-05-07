import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";

export function createRateLimiter(maxHits: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of hits) {
      const recent = timestamps.filter((t) => now - t < windowMs);
      if (recent.length === 0) hits.delete(key);
      else hits.set(key, recent);
    }
  }, windowMs * 2);

  return (key: string): boolean => {
    const now = Date.now();
    const existing = hits.get(key) || [];
    const recent = existing.filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    return recent.length > maxHits;
  };
}

const EXPENSIVE_PATHS = new Set([
  "/calendar/sync",
  "/suggestions",
  "/events/suggest",
  "/events/discover",
  "/events/match",
  "/availability/multi-friend-overlap",
  "/availability/group-overlap",
]);

function isExpensivePath(path: string): boolean {
  for (const p of EXPENSIVE_PATHS) {
    if (path === p || path.startsWith(p + "/")) return true;
  }
  return false;
}

export function getClientIp(req: { headers: Record<string, any>; ip?: string }): string {
  const forwarded = req.headers["x-forwarded-for"];
  return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.ip || "unknown";
}

// Rate limiter tiers
export const rateLimitRead = createRateLimiter(100, 60_000);
export const rateLimitWrite = createRateLimiter(30, 60_000);
export const rateLimitExpensive = createRateLimiter(5, 60_000);
export const rateLimitPublic = createRateLimiter(30, 60_000);

export function rateLimitMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const uid = req.uid || getClientIp(req);
  const method = req.method;
  const path = req.path;

  if (isExpensivePath(path)) {
    if (rateLimitExpensive(uid)) {
      res.status(429).json({ error: "Too many requests to this endpoint. Please wait a minute." });
      return;
    }
  } else if (method === "GET" || method === "HEAD") {
    if (rateLimitRead(uid)) {
      res.status(429).json({ error: "Too many requests. Please slow down." });
      return;
    }
  } else {
    if (rateLimitWrite(uid)) {
      res.status(429).json({ error: "Too many write requests. Please slow down." });
      return;
    }
  }
  next();
}

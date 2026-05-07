import { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";

export interface AuthRequest extends Request {
  uid?: string;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  try {
    const token = header.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    console.error("Auth token verification failed:", err);
    res.status(401).json({ error: "Invalid token" });
  }
}

const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_SECRET) {
    res.status(403).json({ error: "Forbidden — admin access disabled" });
    return;
  }
  const secret =
    (req.headers["x-admin-secret"] as string) ||
    req.body?.secret;
  if (secret !== ADMIN_SECRET) {
    res.status(403).json({ error: "Forbidden — invalid admin secret" });
    return;
  }
  next();
}

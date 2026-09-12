import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

export type AuthenticatedRequest = Request & { userId: string };

export function getSignedInUserId(req: Request): string | null {
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const userId = getSignedInUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthenticatedRequest).userId = userId;
  next();
}

export async function userIsAdmin(userId: string): Promise<boolean> {
  const user = await clerkClient.users.getUser(userId);
  const privateMetadata = user.privateMetadata as Record<string, unknown>;
  return privateMetadata.role === "admin";
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = getSignedInUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    if (!(await userIsAdmin(userId))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  } catch (error) {
    req.log.error({ err: error }, "Unable to resolve Clerk admin metadata");
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  (req as AuthenticatedRequest).userId = userId;
  next();
}
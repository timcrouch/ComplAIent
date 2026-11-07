import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const VALID_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Accepts an inbound x-request-id only if well-formed, otherwise generates one. */
export function resolveRequestId(inbound: unknown): string {
  return typeof inbound === "string" && VALID_REQUEST_ID.test(inbound) ? inbound : randomUUID();
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = resolveRequestId(req.headers["x-request-id"]);
  req.id = id;
  res.setHeader("x-request-id", id);
  next();
}

export function getRequestId(req: Request): string {
  return typeof req.id === "string" ? req.id : "unknown";
}

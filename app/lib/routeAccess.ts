import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const ROUTE_ACCESS_COOKIE = "fieldops_route_access";

export type RouteAccessPayload = {
  version: 2;
  tokenId: string;
  crewId: string;
  crewName: string;
  weekStart: string;
  weekEnd: string;
  issuedAt: number;
  expiresAt: number;
};

function routeLinkSecret() {
  const secret = process.env.FIELDOPS_ROUTE_LINK_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("FIELDOPS_ROUTE_LINK_SECRET must be configured with at least 32 characters.");
  }
  return secret;
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signature(encodedPayload: string) {
  return createHmac("sha256", routeLinkSecret()).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function revokedTokenIds() {
  return new Set(
    (process.env.FIELDOPS_REVOKED_ROUTE_TOKENS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export function createRouteAccessToken(params: {
  crewId: string;
  crewName: string;
  weekStart: string;
}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const weekStartDate = new Date(`${params.weekStart}T12:00:00Z`);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
  const expiresAt = Math.floor((weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000) / 1000);
  if (expiresAt <= issuedAt) {
    throw new Error("That route week has already ended.");
  }
  const payload: RouteAccessPayload = {
    version: 2,
    tokenId: randomUUID(),
    crewId: params.crewId.trim(),
    crewName: params.crewName.trim(),
    weekStart: params.weekStart,
    weekEnd: weekEndDate.toISOString().slice(0, 10),
    issuedAt,
    expiresAt,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return {
    payload,
    token: `${encodedPayload}.${signature(encodedPayload)}`,
  };
}

export function verifyRouteAccessToken(token: string): RouteAccessPayload {
  const [encodedPayload, providedSignature, extra] = token.split(".");
  if (!encodedPayload || !providedSignature || extra) {
    throw new Error("Invalid route link.");
  }
  if (!safeEqual(signature(encodedPayload), providedSignature)) {
    throw new Error("Invalid route link.");
  }

  let payload: RouteAccessPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid route link.");
  }

  if (
    payload.version !== 2 ||
    !payload.tokenId ||
    !payload.crewId ||
    !payload.crewName ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.weekStart) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.weekEnd) ||
    !Number.isFinite(payload.expiresAt)
  ) {
    throw new Error("Invalid route link.");
  }
  if (payload.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error("This route link has expired.");
  }
  if (revokedTokenIds().has(payload.tokenId)) {
    throw new Error("This route link has been revoked.");
  }

  return payload;
}

export function requireRouteAdminSecret(provided: string) {
  const expected = process.env.FIELDOPS_ROUTE_ADMIN_SECRET?.trim();
  if (!expected || expected.length < 20) {
    throw new Error("FIELDOPS_ROUTE_ADMIN_SECRET is not configured.");
  }
  if (!safeEqual(expected, provided)) {
    throw new Error("Invalid owner password.");
  }
}

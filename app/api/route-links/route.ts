import { NextResponse } from "next/server";
import {
  createRouteAccessToken,
  requireRouteAdminSecret,
} from "@/app/lib/routeAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    requireRouteAdminSecret(request.headers.get("x-fieldops-route-admin-secret") ?? "");

    const crewId = String(body.crewId ?? "").trim();
    const crewName = String(body.crewName ?? "").trim();
    const weekStart = String(body.weekStart ?? "").trim();

    if (!crewId || crewId.length > 80) {
      return NextResponse.json({ message: "Enter a valid crew ID." }, { status: 400 });
    }
    if (!crewName || crewName.length > 120) {
      return NextResponse.json({ message: "Enter a valid crew name." }, { status: 400 });
    }
    if (!validDate(weekStart) || new Date(`${weekStart}T12:00:00Z`).getUTCDay() !== 1) {
      return NextResponse.json({ message: "Choose the Monday that starts the route week." }, { status: 400 });
    }

    const { token, payload } = createRouteAccessToken({
      crewId,
      crewName,
      weekStart,
    });
    const origin = new URL(request.url).origin;

    return NextResponse.json({
      accessUrl: `${origin}/api/route-access?token=${encodeURIComponent(token)}`,
      tokenId: payload.tokenId,
      expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
    });
  } catch (error: unknown) {
    const message = errorMessage(error);
    const status = message === "Invalid owner password." ? 401 : 503;
    return NextResponse.json({ message }, { status });
  }
}

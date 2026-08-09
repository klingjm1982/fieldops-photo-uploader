import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCrewRouteStops } from "@/app/lib/crewRoutes";
import { routeStopKey } from "@/app/lib/routeCompletion";
import { getRouteProgress, recordRouteCompletion } from "@/app/lib/routeProgress";
import {
  ROUTE_ACCESS_COOKIE,
  requireRouteAdminSecret,
  verifyRouteAccessToken,
} from "@/app/lib/routeAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ROUTE_ACCESS_COOKIE)?.value ?? "";
    const access = verifyRouteAccessToken(token);
    const body = await request.json();
    const date = String(body.date ?? "").trim();
    const submittedStopKey = String(body.stopKey ?? "").trim();
    const photoCount = Math.max(0, Math.min(1000, Number(body.photoCount) || 0));
    const status = String(body.status ?? "completed").toLowerCase() === "pending" ? "pending" : "completed";

    if (!validDate(date) || date < access.weekStart || date > access.weekEnd) {
      return NextResponse.json({ message: "This date is outside the secure route week." }, { status: 403 });
    }
    if (!submittedStopKey) {
      return NextResponse.json({ message: "Missing route stop." }, { status: 400 });
    }

    const stops = await getCrewRouteStops(access.crewId, date);
    const stop = stops.find(
      (candidate) => routeStopKey(candidate.siteId, candidate.address) === submittedStopKey
    );
    if (!stop) {
      return NextResponse.json({ message: "This stop is not assigned to the secure crew route." }, { status: 403 });
    }

    const timestamp = new Date().toISOString();
    const saved = await recordRouteCompletion({
      date,
      crewId: access.crewId,
      crewName: access.crewName,
      stopKey: submittedStopKey,
      siteId: stop.siteId,
      address: stop.address,
      jobName: stop.jobName,
      status,
      completedAt: status === "completed" ? timestamp : "",
      photoCount,
      updatedAt: timestamp,
    });
    return NextResponse.json({ ok: true, progress: saved });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not save route progress.";
    const status = message.toLowerCase().includes("route link") ? 401 : 503;
    return NextResponse.json({ message }, { status });
  }
}

export async function GET(request: Request) {
  try {
    requireRouteAdminSecret(request.headers.get("x-fieldops-route-admin-secret") ?? "");
    const url = new URL(request.url);
    const crewId = url.searchParams.get("crewId")?.trim() ?? "";
    const date = url.searchParams.get("date")?.trim() ?? "";
    if (!crewId || !validDate(date)) {
      return NextResponse.json({ message: "Enter a valid crew ID and route date." }, { status: 400 });
    }

    const stops = await getCrewRouteStops(crewId, date);
    const progress = await getRouteProgress(crewId, date, stops);
    const progressByStop = new Map(progress.map((entry) => [entry.stopKey, entry]));
    const merged = stops.map((stop, index) => {
      const stopKey = routeStopKey(stop.siteId, stop.address);
      const progressEntry = progressByStop.get(stopKey);
      const completion = progressEntry?.status === "completed" ? progressEntry : undefined;
      return {
        order: index + 1,
        stopKey,
        jobName: stop.jobName,
        address: stop.address,
        propertySize: stop.propertySize,
        status: completion ? "completed" : "pending",
        completedAt: completion?.completedAt ?? "",
        photoCount: completion?.photoCount ?? 0,
      };
    });
    const completed = merged.filter((stop) => stop.status === "completed").length;
    return NextResponse.json({
      crewId,
      date,
      total: merged.length,
      completed,
      remaining: merged.length - completed,
      nextStop: merged.find((stop) => stop.status === "pending") ?? null,
      stops: merged,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load route progress.";
    const status = message === "Invalid owner password." ? 401 : 503;
    return NextResponse.json({ message }, { status });
  }
}

import { NextResponse } from "next/server";
import { getCrewRouteStops, saveCrewRouteStopOrder } from "@/app/lib/crewRoutes";
import { requireRouteAdminSecret } from "@/app/lib/routeAccess";
import { optimizeCrewRoute } from "@/app/lib/routeOptimizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

export async function POST(request: Request) {
  try {
    requireRouteAdminSecret(request.headers.get("x-fieldops-route-admin-secret") ?? "");
    const body = await request.json();
    const crewId = String(body.crewId ?? "").trim();
    const date = String(body.date ?? "").trim();
    if (!crewId || crewId.length > 80) {
      return NextResponse.json({ message: "Enter a valid crew ID." }, { status: 400 });
    }
    if (!validDate(date)) {
      return NextResponse.json({ message: "Choose a valid route date." }, { status: 400 });
    }

    const stops = await getCrewRouteStops(crewId, date);
    const result = await optimizeCrewRoute(stops, date);
    await saveCrewRouteStopOrder(crewId, date, result.orderedStops);

    return NextResponse.json({
      message: `Optimized ${result.orderedStops.length} stops from the Arlington warehouse.`,
      stopCount: result.orderedStops.length,
      distanceMiles: result.distanceMiles,
      durationSeconds: result.durationSeconds,
      warehouseAddress: result.warehouseAddress,
      stops: result.orderedStops.map((stop, index) => ({
        order: index + 1,
        jobName: stop.jobName,
        address: stop.address,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not optimize this route.";
    const status = message === "Invalid owner password." ? 401 : 503;
    return NextResponse.json({ message }, { status });
  }
}

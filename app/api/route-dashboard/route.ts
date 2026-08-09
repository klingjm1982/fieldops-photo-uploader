import { NextResponse } from "next/server";
import { getAllCrewRouteStops } from "@/app/lib/crewRoutes";
import { routeStopKey } from "@/app/lib/routeCompletion";
import { getRouteProgress } from "@/app/lib/routeProgress";
import { requireRouteAdminSecret } from "@/app/lib/routeAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

export async function GET(request: Request) {
  try {
    requireRouteAdminSecret(request.headers.get("x-fieldops-route-admin-secret") ?? "");
    const url = new URL(request.url);
    const date = url.searchParams.get("date")?.trim() ?? "";
    if (!validDate(date)) {
      return NextResponse.json({ message: "Choose a valid route date." }, { status: 400 });
    }

    const stops = await getAllCrewRouteStops(date);
    const stopsByCrew = new Map<string, typeof stops>();
    for (const stop of stops) {
      const key = stop.crewId || "Unassigned";
      stopsByCrew.set(key, [...(stopsByCrew.get(key) ?? []), stop]);
    }

    const crews = await Promise.all(
      [...stopsByCrew.entries()].map(async ([crewId, crewStops]) => {
        const crewName = crewStops.find((stop) => stop.crewName)?.crewName || crewId;
        const progress = await getRouteProgress(crewId, date, crewStops);
        const progressByStop = new Map(progress.map((entry) => [entry.stopKey, entry]));
        const mergedStops = crewStops
          .sort((left, right) => left.stopOrder - right.stopOrder)
          .map((stop, index) => {
            const stopKey = routeStopKey(stop.siteId, stop.address);
            const progressEntry = progressByStop.get(stopKey);
            const completed = progressEntry?.status === "completed";
            return {
              order: index + 1,
              stopKey,
              siteId: stop.siteId,
              jobName: stop.jobName,
              address: stop.address,
              propertySize: stop.propertySize,
              status: completed ? "completed" : "pending",
              completedAt: completed ? progressEntry.completedAt : "",
              photoCount: completed ? progressEntry.photoCount : 0,
              latitude: stop.latitude,
              longitude: stop.longitude,
            };
          });
        const completed = mergedStops.filter((stop) => stop.status === "completed").length;
        return {
          crewId,
          crewName,
          total: mergedStops.length,
          completed,
          remaining: mergedStops.length - completed,
          nextStop: mergedStops.find((stop) => stop.status === "pending") ?? null,
          stops: mergedStops,
        };
      })
    );

    return NextResponse.json({
      date,
      totalCrews: crews.length,
      totalStops: crews.reduce((total, crew) => total + crew.total, 0),
      completedStops: crews.reduce((total, crew) => total + crew.completed, 0),
      remainingStops: crews.reduce((total, crew) => total + crew.remaining, 0),
      crews: crews.sort((left, right) => left.crewName.localeCompare(right.crewName)),
      refreshedAt: new Date().toISOString(),
      mapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_BROWSER_API_KEY || "",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load route dashboard.";
    const status = message === "Invalid owner password." ? 401 : 503;
    return NextResponse.json({ message }, { status });
  }
}

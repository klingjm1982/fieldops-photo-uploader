import type { CrewRouteStop } from "@/app/lib/crewRoutes";

const WAREHOUSE_ADDRESS = "1220 W. Arkansas Ln, Arlington, TX 76013";

type RoutesApiResponse = {
  routes?: Array<{
    optimizedIntermediateWaypointIndex?: number[];
    distanceMeters?: number;
    duration?: string;
  }>;
  error?: { message?: string };
};

function departureTime(date: string, timeZone: string) {
  const guess = Date.parse(`${date}T07:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  const timeZoneOffset = representedAsUtc - guess;
  return new Date(guess - timeZoneOffset).toISOString();
}

function durationSeconds(value = "0s") {
  return Math.round(Number(value.replace(/s$/, "")) || 0);
}

export async function optimizeCrewRoute(stops: CrewRouteStop[], date: string) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
  if (stops.length < 2) throw new Error("Add at least two active stops before optimizing.");
  if (stops.length > 25) throw new Error("Google waypoint optimization supports up to 25 stops per crew day.");

  const warehouseAddress = process.env.FIELDOPS_WAREHOUSE_ADDRESS || WAREHOUSE_ADDRESS;
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration",
    },
    body: JSON.stringify({
      origin: { address: warehouseAddress },
      destination: { address: warehouseAddress },
      intermediates: stops.map((stop) => ({ address: stop.address })),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      departureTime: departureTime(date, process.env.SERVICE_TIME_ZONE || "America/Chicago"),
      optimizeWaypointOrder: true,
      units: "IMPERIAL",
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const json = (await response.json()) as RoutesApiResponse;
  if (!response.ok) {
    throw new Error(json.error?.message || "Google could not optimize this route.");
  }

  const route = json.routes?.[0];
  const order = route?.optimizedIntermediateWaypointIndex;
  if (!route || !order || order.length !== stops.length) {
    throw new Error("Google returned an incomplete optimized route.");
  }

  return {
    orderedStops: order.map((originalIndex) => stops[originalIndex]),
    warehouseAddress,
    distanceMiles: Math.round(((route.distanceMeters || 0) / 1609.344) * 10) / 10,
    durationSeconds: durationSeconds(route.duration),
  };
}

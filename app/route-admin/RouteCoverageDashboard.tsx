"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMaps } from "@/app/lib/googleMaps";

type DashboardStop = {
  order: number;
  stopKey: string;
  siteId: string;
  jobName: string;
  address: string;
  propertySize: string;
  status: "completed" | "pending";
  completedAt: string;
  photoCount: number;
  latitude?: number;
  longitude?: number;
};

type DashboardCrew = {
  crewId: string;
  crewName: string;
  total: number;
  completed: number;
  remaining: number;
  nextStop: DashboardStop | null;
  stops: DashboardStop[];
};

type DashboardState = {
  date: string;
  totalCrews: number;
  totalStops: number;
  completedStops: number;
  remainingStops: number;
  crews: DashboardCrew[];
  refreshedAt: string;
  mapsApiKey: string;
};

type MappedStop = DashboardStop & {
  crewId: string;
  crewName: string;
  color: string;
};

const crewColors = ["#2563eb", "#7c3aed", "#db2777", "#0891b2", "#ea580c", "#4f46e5"];

function statusLabel(stop: DashboardStop) {
  return stop.status === "completed" ? "Completed" : "Pending";
}

function pinSvg(color: string, label: string) {
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="42" height="54" viewBox="0 0 42 54">
        <path fill="${color}" d="M21 0C9.4 0 0 9.4 0 21c0 15.8 21 33 21 33s21-17.2 21-33C42 9.4 32.6 0 21 0z"/>
        <circle cx="21" cy="21" r="14" fill="white" opacity=".94"/>
        <text x="21" y="26" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="${color}">${label}</text>
      </svg>
    `)}`,
    scaledSize: new (window as any).google.maps.Size(34, 44),
    anchor: new (window as any).google.maps.Point(17, 44),
  };
}

function mapsDirectionsUrl(stops: MappedStop[]) {
  const pending = stops.filter((stop) => stop.status !== "completed");
  const routeStops = pending.length > 0 ? pending : stops;
  const params = new URLSearchParams({
    api: "1",
    travelmode: "driving",
    destination: routeStops.at(-1)?.address ?? "",
  });
  if (routeStops.length > 1) {
    params.set("waypoints", routeStops.slice(0, -1).map((stop) => stop.address).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params}`;
}

function localTime(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

export default function RouteCoverageDashboard({
  ownerPassword,
  routeDate,
}: {
  ownerPassword: string;
  routeDate: string;
}) {
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedCrewId, setSelectedCrewId] = useState("all");
  const [mapMessage, setMapMessage] = useState("");
  const mapRef = useRef<HTMLDivElement | null>(null);

  const loadDashboard = useCallback(async (silent = false) => {
    if (!ownerPassword || !routeDate) return;
    if (!silent) setBusy(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ date: routeDate });
      const response = await fetch(`/api/route-dashboard?${params}`, {
        headers: { "x-fieldops-route-admin-secret": ownerPassword },
        cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || "Could not load route dashboard.");
      setDashboard(json);
      setSelectedCrewId((current) =>
        current === "all" || json.crews.some((crew: DashboardCrew) => crew.crewId === current)
          ? current
          : "all"
      );
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Could not load route dashboard.");
    } finally {
      if (!silent) setBusy(false);
    }
  }, [ownerPassword, routeDate]);

  useEffect(() => {
    if (!dashboard) return;
    const timer = window.setInterval(() => void loadDashboard(true), 30_000);
    return () => window.clearInterval(timer);
  }, [dashboard, loadDashboard]);

  const visibleCrews = useMemo(() => {
    if (!dashboard) return [];
    return selectedCrewId === "all"
      ? dashboard.crews
      : dashboard.crews.filter((crew) => crew.crewId === selectedCrewId);
  }, [dashboard, selectedCrewId]);

  const mappedStops = useMemo<MappedStop[]>(() => {
    return visibleCrews.flatMap((crew) => {
      const crewIndex = dashboard?.crews.findIndex((item) => item.crewId === crew.crewId) ?? 0;
      const color = crewColors[Math.max(0, crewIndex) % crewColors.length];
      return crew.stops.map((stop) => ({ ...stop, crewId: crew.crewId, crewName: crew.crewName, color }));
    });
  }, [dashboard?.crews, visibleCrews]);

  useEffect(() => {
    if (!dashboard || !mapRef.current) return;
    if (!dashboard.mapsApiKey) {
      setMapMessage("Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY or GOOGLE_MAPS_BROWSER_API_KEY in Vercel to show the live map.");
      return;
    }
    if (mappedStops.length === 0) return;

    let cancelled = false;
    const currentDashboard = dashboard;
    async function renderMap() {
      try {
        setMapMessage("Loading map...");
        await loadGoogleMaps(currentDashboard.mapsApiKey);
        if (cancelled || !mapRef.current) return;
        const google = (window as any).google;
        const map = new google.maps.Map(mapRef.current, {
          center: { lat: 32.7767, lng: -96.797 },
          zoom: 9,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        const bounds = new google.maps.LatLngBounds();
        const geocoder = new google.maps.Geocoder();
        const info = new google.maps.InfoWindow();
        const routePaths = new Map<string, any[]>();

        for (const stop of mappedStops) {
          let position =
            typeof stop.latitude === "number" && typeof stop.longitude === "number"
              ? { lat: stop.latitude, lng: stop.longitude }
              : null;

          if (!position) {
            const result = await geocoder.geocode({ address: stop.address }).catch(() => null);
            const location = result?.results?.[0]?.geometry?.location;
            if (location) position = { lat: location.lat(), lng: location.lng() };
          }
          if (!position || cancelled) continue;

          bounds.extend(position);
          routePaths.set(stop.crewId, [...(routePaths.get(stop.crewId) ?? []), position]);
          const marker = new google.maps.Marker({
            position,
            map,
            title: stop.jobName || stop.address,
            icon: pinSvg(stop.status === "completed" ? "#16a34a" : stop.color, String(stop.order)),
          });
          marker.addListener("click", () => {
            info.setContent(`
              <div style="max-width:260px">
                <strong>${stop.order}. ${stop.jobName || stop.address}</strong>
                <p style="margin:6px 0">${stop.address}</p>
                <p style="margin:0;color:${stop.status === "completed" ? "#166534" : "#92400e"}">
                  ${stop.crewName} - ${statusLabel(stop)}
                </p>
              </div>
            `);
            info.open({ anchor: marker, map });
          });
        }

        for (const [crewId, path] of routePaths) {
          if (path.length < 2) continue;
          const crewIndex = currentDashboard.crews.findIndex((crew) => crew.crewId === crewId);
          new google.maps.Polyline({
            path,
            map,
            strokeColor: crewColors[Math.max(0, crewIndex) % crewColors.length],
            strokeOpacity: 0.82,
            strokeWeight: 4,
          });
        }

        if (!bounds.isEmpty()) map.fitBounds(bounds, 56);
        setMapMessage("");
      } catch (error: unknown) {
        setMapMessage(error instanceof Error ? error.message : "Could not load the route map.");
      }
    }

    void renderMap();
    return () => {
      cancelled = true;
    };
  }, [dashboard, mappedStops]);

  const selectedTotals = {
    total: visibleCrews.reduce((total, crew) => total + crew.total, 0),
    completed: visibleCrews.reduce((total, crew) => total + crew.completed, 0),
    remaining: visibleCrews.reduce((total, crew) => total + crew.remaining, 0),
  };

  return (
    <section className="mt-7 rounded-3xl bg-white p-6 text-slate-950 shadow-2xl">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-700">Field command view</p>
      <h2 className="mt-2 text-2xl font-bold">Daily route map</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Toggle between crews, see who is complete, and view today&apos;s coverage from one screen.
      </p>

      <button
        type="button"
        onClick={() => void loadDashboard(false)}
        disabled={busy || !ownerPassword || !routeDate}
        className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white disabled:opacity-50"
      >
        {busy ? "Loading dashboard..." : dashboard ? "Refresh crew map" : "Load crew map"}
      </button>
      {message && <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{message}</p>}

      {dashboard && (
        <div className="mt-5">
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setSelectedCrewId("all")}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-black ${
                selectedCrewId === "all" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              All crews
            </button>
            {dashboard.crews.map((crew) => (
              <button
                key={crew.crewId}
                type="button"
                onClick={() => setSelectedCrewId(crew.crewId)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-black ${
                  selectedCrewId === crew.crewId ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {crew.crewName}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl bg-slate-100 p-3">
              <p className="text-2xl font-black">{selectedTotals.total}</p>
              <p className="text-xs font-semibold text-slate-500">Stops</p>
            </div>
            <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-900">
              <p className="text-2xl font-black">{selectedTotals.completed}</p>
              <p className="text-xs font-semibold">Complete</p>
            </div>
            <div className="rounded-2xl bg-amber-100 p-3 text-amber-900">
              <p className="text-2xl font-black">{selectedTotals.remaining}</p>
              <p className="text-xs font-semibold">Remaining</p>
            </div>
          </div>

          <div className="relative mt-4 h-[420px] overflow-hidden rounded-3xl border border-slate-200 bg-slate-100">
            <div ref={mapRef} className="h-full w-full" />
            {mapMessage && (
              <div className="absolute inset-0 grid place-items-center bg-slate-100/95 p-6 text-center text-sm font-semibold text-slate-600">
                {mapMessage}
              </div>
            )}
          </div>

          {mappedStops.length > 0 && (
            <a
              href={mapsDirectionsUrl(mappedStops)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block rounded-xl bg-slate-950 px-4 py-3 text-center font-bold text-white"
            >
              Open selected route in Google Maps
            </a>
          )}

          <div className="mt-4 space-y-3">
            {visibleCrews.map((crew) => (
              <details key={crew.crewId} open={visibleCrews.length === 1} className="rounded-2xl border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer list-none px-4 py-3 font-black">
                  {crew.crewName}: {crew.completed}/{crew.total} complete
                </summary>
                <ol className="border-t border-slate-200 p-3 text-sm">
                  {crew.stops.map((stop) => (
                    <li key={stop.stopKey} className="flex items-start justify-between gap-3 border-b border-slate-200 py-3 last:border-0">
                      <div className="min-w-0">
                        <p className="font-bold">{stop.order}. {stop.jobName || stop.address}</p>
                        {stop.jobName && <p className="mt-1 text-xs text-slate-500">{stop.address}</p>}
                        {stop.completedAt && (
                          <p className="mt-1 text-xs text-emerald-700">
                            Completed {localTime(stop.completedAt)}
                            {stop.photoCount > 0 ? ` - ${stop.photoCount} photos` : ""}
                          </p>
                        )}
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                        stop.status === "completed" ? "bg-emerald-200 text-emerald-900" : "bg-amber-200 text-amber-900"
                      }`}>
                        {stop.status}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-slate-400">
            Last refreshed {new Date(dashboard.refreshedAt).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
            })}
          </p>
        </div>
      )}
    </section>
  );
}

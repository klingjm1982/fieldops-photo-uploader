"use client";

import { useEffect, useMemo, useState } from "react";
import type { CrewRouteStop } from "@/app/lib/crewRoutes";
import { routeCompletionStorageKey, routeStopKey } from "@/app/lib/routeCompletion";

function googleMapsUrl(address: string) {
  const params = new URLSearchParams({
    api: "1",
    destination: address,
    travelmode: "driving",
    dir_action: "navigate",
  });
  return `https://www.google.com/maps/dir/?${params}`;
}

function appleMapsUrl(address: string) {
  const params = new URLSearchParams({ daddr: address, dirflg: "d" });
  return `https://maps.apple.com/?${params}`;
}

function uploaderUrl(stop: CrewRouteStop, crewId: string, serviceDate: string) {
  const stopKey = routeStopKey(stop.siteId, stop.address);
  const params = new URLSearchParams({
    siteId: stop.siteId,
    address: stop.address,
    serviceDate,
    routeCrewId: crewId,
    routeDate: serviceDate,
    routeStopKey: stopKey,
    returnTo: `/crew-route?day=${serviceDate}`,
  });
  return `/?${params}`;
}

export default function CrewRouteStops({
  crewId,
  selectedDate,
  stops,
  sharedCompletedKeys,
}: {
  crewId: string;
  selectedDate: string;
  stops: CrewRouteStop[];
  sharedCompletedKeys: string[];
}) {
  const [completed, setCompleted] = useState<string[]>([]);

  useEffect(() => {
    const storageKey = routeCompletionStorageKey(crewId, selectedDate);
    const timeout = window.setTimeout(() => {
      try {
        const value = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as unknown;
        const localCompleted = Array.isArray(value) ? value.map(String) : [];
        const combined = [...new Set([...sharedCompletedKeys, ...localCompleted])];
        setCompleted(combined);
        for (const stopKey of localCompleted) {
          if (sharedCompletedKeys.includes(stopKey)) continue;
          void fetch("/api/route-progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: selectedDate, stopKey, status: "completed", photoCount: 0 }),
            keepalive: true,
          }).catch(() => undefined);
        }
      } catch {
        setCompleted(sharedCompletedKeys);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [crewId, selectedDate, sharedCompletedKeys]);

  const { unfinished, finished } = useMemo(() => {
    const done = new Set(completed);
    return {
      unfinished: stops.filter((stop) => !done.has(routeStopKey(stop.siteId, stop.address))),
      finished: stops.filter((stop) => done.has(routeStopKey(stop.siteId, stop.address))),
    };
  }, [completed, stops]);

  function reopen(stop: CrewRouteStop) {
    const stopKey = routeStopKey(stop.siteId, stop.address);
    const next = completed.filter((value) => value !== stopKey);
    window.localStorage.setItem(routeCompletionStorageKey(crewId, selectedDate), JSON.stringify(next));
    setCompleted(next);
    void fetch("/api/route-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: selectedDate, stopKey, status: "pending", photoCount: 0 }),
      keepalive: true,
    }).catch(() => undefined);
  }

  if (stops.length === 0) return null;

  return (
    <>
      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-slate-950">Route progress</p>
            <p className="mt-1 text-sm text-slate-500">{finished.length} of {stops.length} stops completed</p>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800">
            {unfinished.length} left
          </span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${(finished.length / stops.length) * 100}%` }}
          />
        </div>
      </section>

      {unfinished.map((stop, index) => (
        <article key={routeStopKey(stop.siteId, stop.address)} className={`mt-4 rounded-3xl border bg-white p-5 shadow-sm ${index === 0 ? "border-emerald-400 ring-2 ring-emerald-100" : "border-slate-200"}`}>
          {index === 0 && (
            <p className="mb-3 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">
              Up next
            </p>
          )}
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-950 text-lg font-bold text-white">
              {stops.indexOf(stop) + 1}
            </span>
            <div className="min-w-0">
              <h3 className="text-lg font-bold">{stop.jobName || stop.address}</h3>
              {stop.propertySize && (
                <span
                  className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${
                    stop.propertySize.toLowerCase() === "large"
                      ? "bg-red-100 text-red-800"
                      : stop.propertySize.toLowerCase() === "medium"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {stop.propertySize} property
                </span>
              )}
              <p className="mt-1 leading-6 text-slate-600">{stop.address}</p>
              {(stop.timeWindowStart || stop.timeWindowEnd) && (
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  Time window: {stop.timeWindowStart || "Anytime"} – {stop.timeWindowEnd || "Anytime"}
                </p>
              )}
              {stop.notes && <p className="mt-2 text-sm text-slate-500">{stop.notes}</p>}
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <a href={googleMapsUrl(stop.address)} className="rounded-xl bg-blue-600 px-4 py-3 text-center font-bold text-white" rel="noreferrer">
              Google Maps
            </a>
            <a href={appleMapsUrl(stop.address)} className="rounded-xl bg-slate-900 px-4 py-3 text-center font-bold text-white" rel="noreferrer">
              Apple Maps
            </a>
            <a href={uploaderUrl(stop, crewId, selectedDate)} className="rounded-xl bg-emerald-600 px-4 py-3 text-center font-bold text-white">
              Upload Photos
            </a>
          </div>
        </article>
      ))}

      {unfinished.length === 0 && (
        <section className="mt-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm">
          <p className="text-3xl">✓</p>
          <h2 className="mt-2 text-xl font-bold text-emerald-950">Route complete</h2>
          <p className="mt-2 text-emerald-800">All {stops.length} stops are marked complete for today.</p>
        </section>
      )}

      {finished.length > 0 && (
        <details className="mt-4 rounded-3xl border border-slate-200 bg-white shadow-sm">
          <summary className="cursor-pointer list-none px-5 py-4 font-bold text-slate-700">
            ✓ Completed stops ({finished.length})
          </summary>
          <div className="border-t border-slate-200 px-5 pb-3">
            {finished.map((stop) => (
              <div key={routeStopKey(stop.siteId, stop.address)} className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-500 line-through">{stop.jobName || stop.address}</p>
                  {stop.jobName && <p className="truncate text-xs text-slate-400">{stop.address}</p>}
                </div>
                <button type="button" onClick={() => reopen(stop)} className="shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
                  Reopen
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

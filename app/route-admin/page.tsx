"use client";

import { useCallback, useEffect, useState } from "react";
import RouteCoverageDashboard from "@/app/route-admin/RouteCoverageDashboard";

type LinkResult = {
  accessUrl: string;
  tokenId: string;
  expiresAt: string;
};

type OptimizeResult = {
  message: string;
  stopCount: number;
  distanceMiles: number;
  durationSeconds: number;
  warehouseAddress: string;
  startAddress?: string;
  stops: Array<{ order: number; jobName: string; address: string }>;
};

type LiveProgress = {
  crewId: string;
  date: string;
  total: number;
  completed: number;
  remaining: number;
  refreshedAt: string;
  nextStop: null | { order: number; jobName: string; address: string; propertySize: string };
  stops: Array<{
    order: number;
    stopKey: string;
    jobName: string;
    address: string;
    propertySize: string;
    status: "completed" | "pending";
    completedAt: string;
    photoCount: number;
  }>;
};

const OWNER_PASSWORD_STORAGE_KEY = "fieldops-route-admin-owner-password";

function todayInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  const local = new Date(now.getTime() - offsetMs);
  const day = local.getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  local.setUTCDate(local.getUTCDate() - daysFromMonday);
  return local.toISOString().slice(0, 10);
}

function currentDateInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

export default function RouteAdminPage() {
  const [ownerPassword, setOwnerPassword] = useState("");
  const [crewId, setCrewId] = useState("");
  const [crewName, setCrewName] = useState("");
  const [weekStart, setWeekStart] = useState(todayInputValue);
  const [result, setResult] = useState<LinkResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [routeDate, setRouteDate] = useState(currentDateInputValue);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [optimizeMessage, setOptimizeMessage] = useState("");
  const [liveProgress, setLiveProgress] = useState<LiveProgress | null>(null);
  const [progressMessage, setProgressMessage] = useState("");
  const [progressBusy, setProgressBusy] = useState(false);
  const [watchingProgress, setWatchingProgress] = useState(false);
  const [startStopKey, setStartStopKey] = useState("");

  useEffect(() => {
    try {
      const savedPassword = window.localStorage.getItem(OWNER_PASSWORD_STORAGE_KEY);
      if (savedPassword) setOwnerPassword(savedPassword);
    } catch {
      // Local storage is a convenience only. The route still works without it.
    }
  }, []);

  useEffect(() => {
    try {
      if (ownerPassword) {
        window.localStorage.setItem(OWNER_PASSWORD_STORAGE_KEY, ownerPassword);
      } else {
        window.localStorage.removeItem(OWNER_PASSWORD_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures in private browsing or locked-down devices.
    }
  }, [ownerPassword]);

  const loadProgress = useCallback(async (silent = false) => {
    if (!silent) setProgressBusy(true);
    setProgressMessage("");
    try {
      const params = new URLSearchParams({ crewId, date: routeDate });
      const response = await fetch(`/api/route-progress?${params}`, {
        headers: { "x-fieldops-route-admin-secret": ownerPassword },
        cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || "Could not load live progress.");
      setLiveProgress(json);
      setWatchingProgress(true);
    } catch (error: unknown) {
      setProgressMessage(error instanceof Error ? error.message : "Could not load live progress.");
    } finally {
      if (!silent) setProgressBusy(false);
    }
  }, [crewId, ownerPassword, routeDate]);

  useEffect(() => {
    if (!watchingProgress) return;
    const timer = window.setInterval(() => void loadProgress(true), 30_000);
    return () => window.clearInterval(timer);
  }, [loadProgress, watchingProgress]);

  async function createLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setResult(null);

    try {
      const response = await fetch("/api/route-links", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fieldops-route-admin-secret": ownerPassword,
        },
        body: JSON.stringify({ crewId, crewName, weekStart }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || "Could not create route link.");
      setResult(json);
      setMessage("Secure crew link created.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Could not create route link.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    await navigator.clipboard.writeText(result.accessUrl);
    setMessage("Secure link copied.");
  }

  async function optimizeRoute() {
    setOptimizing(true);
    setOptimizeMessage("");
    setOptimizeResult(null);
    try {
      const response = await fetch("/api/route-optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fieldops-route-admin-secret": ownerPassword,
        },
        body: JSON.stringify({ crewId, date: routeDate, startStopKey }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || "Could not optimize this route.");
      setOptimizeResult(json);
      setOptimizeMessage(json.message);
    } catch (error: unknown) {
      setOptimizeMessage(error instanceof Error ? error.message : "Could not optimize this route.");
    } finally {
      setOptimizing(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <section className="mx-auto max-w-lg">
        <p className="text-sm font-semibold tracking-[0.18em] text-amber-400">FIELD OPS OWNER</p>
        <h1 className="mt-2 text-3xl font-bold">Create a crew route link</h1>
        <p className="mt-3 leading-7 text-slate-300">
          This link is separate from the subcontractor uploader and opens one crew&apos;s Monday–Sunday route week.
        </p>

        <form onSubmit={createLink} className="mt-7 space-y-4 rounded-3xl bg-white p-6 text-slate-950 shadow-2xl">
          <label className="block text-sm font-semibold">
            Owner password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={ownerPassword}
              onChange={(event) => setOwnerPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
            />
            <span className="mt-2 block font-normal text-slate-500">
              Saved on this device after you enter it once.
            </span>
          </label>
          {ownerPassword && (
            <button
              type="button"
              onClick={() => setOwnerPassword("")}
              className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700"
            >
              Clear saved owner password
            </button>
          )}
          <label className="block text-sm font-semibold">
            Crew name
            <input
              required
              value={crewName}
              onChange={(event) => setCrewName(event.target.value)}
              placeholder="North Dallas Crew"
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
            />
          </label>
          <label className="block text-sm font-semibold">
            Crew ID
            <input
              required
              value={crewId}
              onChange={(event) => {
                setCrewId(event.target.value);
                setWatchingProgress(false);
                setLiveProgress(null);
                setStartStopKey("");
              }}
              placeholder="north-dallas-1"
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3"
            />
          </label>
          <label className="block text-sm font-semibold">
            Week starting Monday
            <input
              type="date"
              required
              value={weekStart}
              onChange={(event) => setWeekStart(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3"
            />
            <span className="mt-2 block font-normal text-slate-500">
              The link covers Monday through Sunday and expires the following Monday morning.
            </span>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-slate-950 px-4 py-3 font-bold text-white disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create secure link"}
          </button>
        </form>

        {message && <p className="mt-4 rounded-xl bg-slate-800 p-4 text-sm">{message}</p>}
        {result && (
          <section className="mt-4 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5">
            <h2 className="font-bold text-emerald-300">Ready to send</h2>
            <button onClick={copyLink} className="mt-4 w-full rounded-xl bg-emerald-400 px-4 py-3 font-bold text-slate-950">
              Copy crew link
            </button>
            <p className="mt-4 break-all text-xs text-slate-300">Revocation ID: {result.tokenId}</p>
            <p className="mt-2 text-xs text-slate-300">
              Expires {new Date(result.expiresAt).toLocaleString()}
            </p>
          </section>
        )}

        <section className="mt-7 rounded-3xl bg-white p-6 text-slate-950 shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Live operations</p>
          <h2 className="mt-2 text-2xl font-bold">Crew route progress</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Uses the Crew ID and owner password above. Once loaded, this view refreshes automatically every 30 seconds.
          </p>
          <label className="mt-5 block text-sm font-semibold">
            Progress date
            <input
              type="date"
              required
              value={routeDate}
              onChange={(event) => {
                setRouteDate(event.target.value);
                setWatchingProgress(false);
                setLiveProgress(null);
                setStartStopKey("");
              }}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3"
            />
          </label>
          <button
            type="button"
            onClick={() => void loadProgress(false)}
            disabled={progressBusy || !ownerPassword || !crewId || !routeDate}
            className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-50"
          >
            {progressBusy ? "Loading…" : liveProgress ? "Refresh live progress" : "View live progress"}
          </button>
          {progressMessage && <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{progressMessage}</p>}
          {liveProgress && (
            <div className="mt-5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl bg-slate-100 p-3">
                  <p className="text-2xl font-black">{liveProgress.total}</p>
                  <p className="text-xs font-semibold text-slate-500">Total</p>
                </div>
                <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-900">
                  <p className="text-2xl font-black">{liveProgress.completed}</p>
                  <p className="text-xs font-semibold">Completed</p>
                </div>
                <div className="rounded-2xl bg-amber-100 p-3 text-amber-900">
                  <p className="text-2xl font-black">{liveProgress.remaining}</p>
                  <p className="text-xs font-semibold">Remaining</p>
                </div>
              </div>
              <div className="mt-4 rounded-2xl bg-slate-950 p-4 text-white">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-300">
                  {liveProgress.nextStop ? "Likely current / next stop" : "Route status"}
                </p>
                <p className="mt-2 font-bold">
                  {liveProgress.nextStop
                    ? `${liveProgress.nextStop.order}. ${liveProgress.nextStop.jobName || liveProgress.nextStop.address}`
                    : liveProgress.total > 0 ? "Route complete" : "No route stops scheduled"}
                </p>
                {liveProgress.nextStop?.jobName && (
                  <p className="mt-1 text-sm text-slate-300">{liveProgress.nextStop.address}</p>
                )}
              </div>
              <ol className="mt-4 space-y-2 text-sm">
                {liveProgress.stops.map((stop) => (
                  <li key={stop.stopKey} className={`rounded-xl p-3 ${stop.status === "completed" ? "bg-emerald-50" : "bg-slate-100"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className={`font-bold ${stop.status === "completed" ? "text-emerald-900" : "text-slate-800"}`}>
                          {stop.order}. {stop.jobName || stop.address}
                        </p>
                        {stop.jobName && <p className="mt-1 text-xs text-slate-500">{stop.address}</p>}
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase ${stop.status === "completed" ? "bg-emerald-200 text-emerald-900" : "bg-slate-200 text-slate-600"}`}>
                        {stop.status}
                      </span>
                    </div>
                    {stop.completedAt && (
                      <p className="mt-2 text-xs text-emerald-700">
                        Completed {new Date(stop.completedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}
                        {stop.photoCount > 0 ? ` · ${stop.photoCount} photos` : ""}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-center text-xs text-slate-400">
                Last refreshed {new Date(liveProgress.refreshedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
              </p>
            </div>
          )}
        </section>

        <RouteCoverageDashboard ownerPassword={ownerPassword} routeDate={routeDate} />

        <section className="mt-7 rounded-3xl bg-white p-6 text-slate-950 shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Traffic-aware routing</p>
          <h2 className="mt-2 text-2xl font-bold">Optimize a crew day</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Starts at the warehouse unless you select a starting property below. Google will reorder the remaining active Sheet rows based on predicted traffic, distance, and turns.
          </p>
          <label className="mt-5 block text-sm font-semibold">
            Route date
            <input
              type="date"
              required
              value={routeDate}
              onChange={(event) => {
                setRouteDate(event.target.value);
                setWatchingProgress(false);
                setLiveProgress(null);
                setStartStopKey("");
              }}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3"
            />
          </label>
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-900">Optional starting property</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  Pick a large or priority property to lock as Stop 1. The rest of the day optimizes after that stop.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadProgress(false)}
                disabled={progressBusy || !ownerPassword || !crewId || !routeDate}
                className="shrink-0 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {progressBusy ? "Loading..." : "Load stops"}
              </button>
            </div>

            <label className="mt-3 block text-sm font-semibold">
              Start route at
              <select
                value={startStopKey}
                onChange={(event) => setStartStopKey(event.target.value)}
                disabled={!liveProgress?.stops.length}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"
              >
                <option value="">Warehouse / optimizer decides</option>
                {liveProgress?.stops.map((stop) => (
                  <option key={stop.stopKey} value={stop.stopKey}>
                    {stop.order}. {stop.jobName || stop.address}
                    {stop.propertySize ? ` - ${stop.propertySize}` : ""}
                  </option>
                ))}
              </select>
            </label>

            {liveProgress?.stops.length ? (
              <div className="mt-3 space-y-2">
                {liveProgress.stops.map((stop) => (
                  <button
                    type="button"
                    key={stop.stopKey}
                    onClick={() => setStartStopKey(stop.stopKey)}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                      startStopKey === stop.stopKey
                        ? "border-blue-500 bg-blue-50 text-blue-950"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <span className="font-black">Start here:</span>{" "}
                    {stop.jobName || stop.address}
                    {stop.propertySize && (
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                        stop.propertySize.toLowerCase() === "large"
                          ? "bg-red-100 text-red-800"
                          : stop.propertySize.toLowerCase() === "medium"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-blue-100 text-blue-800"
                      }`}>
                        {stop.propertySize}
                      </span>
                    )}
                    {stop.jobName && <span className="mt-1 block text-xs opacity-75">{stop.address}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Load stops after entering Crew ID, owner password, and route date.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={optimizeRoute}
            disabled={optimizing || !ownerPassword || !crewId || !routeDate}
            className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-50"
          >
            {optimizing ? "Optimizing…" : "Optimize route and save order"}
          </button>
          {optimizeMessage && (
            <p className={`mt-4 rounded-xl p-4 text-sm ${optimizeResult ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>
              {optimizeMessage}
            </p>
          )}
          {optimizeResult && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-700">
                Estimated round trip: {optimizeResult.distanceMiles} miles · {Math.floor(optimizeResult.durationSeconds / 3600)}h {Math.round((optimizeResult.durationSeconds % 3600) / 60)}m driving
              </p>
              {optimizeResult.startAddress && (
                <p className="mt-2 rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-900">
                  Locked first stop: {optimizeResult.startAddress}
                </p>
              )}
              <ol className="mt-3 space-y-2 text-sm">
                {optimizeResult.stops.map((stop) => (
                  <li key={`${stop.order}-${stop.address}`} className="rounded-xl bg-slate-100 p-3">
                    <span className="font-bold">{stop.order}. {stop.jobName || stop.address}</span>
                    {stop.jobName && <span className="mt-1 block text-slate-600">{stop.address}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

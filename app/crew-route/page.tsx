import type { Metadata } from "next";
import Image from "next/image";
import { cookies } from "next/headers";
import { ROUTE_ACCESS_COOKIE, verifyRouteAccessToken } from "@/app/lib/routeAccess";
import {
  currentServiceDate,
  getCrewRouteWeekStops,
  weekdayForDate,
} from "@/app/lib/crewRoutes";
import CrewRouteStops from "@/app/crew-route/CrewRouteStops";
import { getRouteProgress } from "@/app/lib/routeProgress";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "FIELD OPS Crew Route",
  description: "Private weekly FIELD OPS crew route.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function friendlyDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function weekDates(weekStart: string) {
  const first = new Date(`${weekStart}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function shortDay(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`)
  );
}

function dayNumber(value: string) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`)
  );
}

export default async function CrewRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; day?: string }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(ROUTE_ACCESS_COOKIE)?.value ?? "";
  const query = await searchParams;

  let access;
  let error = query.error ?? "";
  let routeError = "";
  if (token) {
    try {
      access = verifyRouteAccessToken(token);
    } catch (caught: unknown) {
      error = caught instanceof Error ? caught.message : "This route link is not valid.";
    }
  }

  if (!access) {
    return (
      <main className="min-h-screen bg-slate-950 px-5 py-12 text-white">
        <section className="mx-auto max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-7 shadow-2xl">
          <p className="text-sm font-semibold tracking-[0.18em] text-amber-400">FIELD OPS</p>
          <h1 className="mt-3 text-3xl font-bold">Private crew route</h1>
          <p className="mt-4 leading-7 text-slate-300">
            {error || "Open the secure daily link sent by your FIELD OPS dispatcher."}
          </p>
          <p className="mt-6 rounded-2xl bg-slate-800 p-4 text-sm leading-6 text-slate-400">
            The subcontractor photo-upload link does not grant access to crew routes.
          </p>
        </section>
      </main>
    );
  }

  const serviceDate = currentServiceDate(process.env.SERVICE_TIME_ZONE || "America/Chicago");
  const dates = weekDates(access.weekStart);
  const todayIsInLinkWeek = serviceDate >= access.weekStart && serviceDate <= access.weekEnd;
  const requestedDay = query.day ?? "";
  const selectedDate = dates.includes(requestedDay)
    ? requestedDay
    : todayIsInLinkWeek
      ? serviceDate
      : access.weekStart;
  const weekday = weekdayForDate(selectedDate);
  let weekStops = [] as Awaited<ReturnType<typeof getCrewRouteWeekStops>>;
  let sharedCompletedKeys: string[] = [];
  try {
    weekStops = await getCrewRouteWeekStops(access.crewId, access.weekStart, access.weekEnd);
  } catch (caught: unknown) {
    routeError = caught instanceof Error ? caught.message : "Could not load this week’s route.";
  }
  const stops = weekStops.filter((stop) => stop.date === selectedDate);
  try {
    const progress = await getRouteProgress(access.crewId, selectedDate, stops);
    sharedCompletedKeys = progress
      .filter((entry) => entry.status === "completed")
      .map((entry) => entry.stopKey);
  } catch {
    // Live progress is additive. The existing local checklist remains available if sync is offline.
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950">
      <section className="mx-auto max-w-2xl">
        <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl">
          <div className="mb-5 inline-flex rounded-2xl bg-white px-4 py-2 shadow-sm">
            <Image src="/logo.png" alt="FIELD OPS" width={170} height={67} priority className="h-auto w-36" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.18em] text-emerald-400">SECURE FIELD OPS ROUTE</p>
              <h1 className="mt-2 text-3xl font-bold">{access.crewName}</h1>
              <p className="mt-2 text-slate-300">
                Week of {friendlyDate(access.weekStart)} – {friendlyDate(access.weekEnd)}
              </p>
            </div>
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-300">
              Verified
            </span>
          </div>
        </header>

        <nav aria-label="Route week" className="mt-5 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="grid grid-cols-7 gap-1.5">
            {dates.map((date) => {
              const selected = date === selectedDate;
              const isToday = date === serviceDate;
              const count = weekStops.filter((stop) => stop.date === date).length;
              return (
                <a
                  key={date}
                  href={`/crew-route?day=${date}`}
                  aria-current={selected ? "date" : undefined}
                  className={`rounded-2xl px-1 py-3 text-center transition ${
                    selected ? "bg-slate-950 text-white shadow-md" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  <span className={`block text-[11px] font-bold uppercase ${selected ? "text-emerald-300" : "text-slate-500"}`}>
                    {shortDay(date)}
                  </span>
                  <span className="mt-1 block text-lg font-bold">{dayNumber(date)}</span>
                  <span className={`mt-1 block text-[10px] font-semibold ${selected ? "text-slate-300" : "text-slate-500"}`}>
                    {count} {count === 1 ? "stop" : "stops"}
                  </span>
                  {isToday && <span className="mt-1 block text-[9px] font-bold uppercase text-amber-400">Today</span>}
                </a>
              );
            })}
          </div>
        </nav>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">{weekday} route</h2>
          {routeError ? (
            <p className="mt-2 rounded-2xl bg-red-50 p-4 leading-7 text-red-800">{routeError}</p>
          ) : stops.length === 0 && weekday === "Saturday" ? (
            <p className="mt-2 rounded-2xl bg-amber-50 p-4 leading-7 text-amber-900">
              No Saturday route is scheduled. If dispatch adds a rain-delay or makeup route for today, it will appear here automatically.
            </p>
          ) : stops.length === 0 ? (
            <p className="mt-2 rounded-2xl bg-slate-100 p-4 leading-7 text-slate-600">
              No stops are assigned to this crew for {friendlyDate(selectedDate)}.
            </p>
          ) : (
            <p className="mt-2 text-slate-600">
              {stops.length} {stops.length === 1 ? "stop" : "stops"} assigned for {friendlyDate(selectedDate)}.
            </p>
          )}
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-slate-100 p-4">
              <dt className="text-slate-500">Crew ID</dt>
              <dd className="mt-1 font-semibold">{access.crewId}</dd>
            </div>
            <div className="rounded-2xl bg-slate-100 p-4">
              <dt className="text-slate-500">Access expires</dt>
              <dd className="mt-1 font-semibold">
                {new Date(access.expiresAt * 1000).toLocaleString("en-US", { timeZone: "America/Chicago" })}
              </dd>
            </div>
          </dl>
        </section>

        <CrewRouteStops
          crewId={access.crewId}
          selectedDate={selectedDate}
          stops={stops}
          sharedCompletedKeys={sharedCompletedKeys}
        />
      </section>
    </main>
  );
}

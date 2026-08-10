import { google } from "googleapis";
import { readServiceAccount } from "@/app/lib/googleServiceAccount";
import { quoteSheetTitle } from "@/app/lib/siteSubCompanyOverrides";
import type { CrewRouteStop } from "@/app/lib/crewRoutes";
import { routeStopKey } from "@/app/lib/routeCompletion";

const PROGRESS_TAB = "RouteProgress";
const HEADERS = [
  "date",
  "crewId",
  "crewName",
  "stopKey",
  "siteId",
  "address",
  "jobName",
  "status",
  "completedAt",
  "photoCount",
  "updatedAt",
];

const ROUTE_PROGRESS_CACHE_TTL_MS = Number(process.env.ROUTE_PROGRESS_CACHE_TTL_MS || 60_000);
const routeProgressCache = new Map<string, { expiresAt: number; entries: RouteProgressEntry[] }>();

export type RouteProgressEntry = {
  date: string;
  crewId: string;
  crewName: string;
  stopKey: string;
  siteId: string;
  address: string;
  jobName: string;
  status: "completed" | "pending";
  completedAt: string;
  photoCount: number;
  updatedAt: string;
};

async function sheetsClient(readOnly: boolean) {
  const { clientEmail, privateKey } = readServiceAccount();
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      readOnly
        ? "https://www.googleapis.com/auth/spreadsheets.readonly"
        : "https://www.googleapis.com/auth/spreadsheets",
    ],
  });
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

async function ensureProgressSheet(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string
) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const exists = metadata.data.sheets?.some(
    (sheet) => sheet.properties?.title === PROGRESS_TAB
  );
  if (!exists) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: PROGRESS_TAB, gridProperties: { frozenRowCount: 1 } },
            },
          }],
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("already exists")) throw error;
    }
  }

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetTitle(PROGRESS_TAB)}!A1:K1`,
  });
  if ((headerResponse.data.values?.[0]?.length ?? 0) === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteSheetTitle(PROGRESS_TAB)}!A1:K1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
  }
}

function parseRows(values: unknown[][]): RouteProgressEntry[] {
  const [, ...rows] = values;
  return rows
    .map((row) => ({
      date: String(row[0] ?? "").trim(),
      crewId: String(row[1] ?? "").trim(),
      crewName: String(row[2] ?? "").trim(),
      stopKey: String(row[3] ?? "").trim(),
      siteId: String(row[4] ?? "").trim(),
      address: String(row[5] ?? "").trim(),
      jobName: String(row[6] ?? "").trim(),
      status: String(row[7] ?? "").trim().toLowerCase() === "pending" ? "pending" as const : "completed" as const,
      completedAt: String(row[8] ?? "").trim(),
      photoCount: Number(row[9]) || 0,
      updatedAt: String(row[10] ?? "").trim(),
    }))
    .filter((row) => row.date && row.crewId && row.stopKey);
}

function uploadPhotoCount(value: unknown) {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export async function getRouteProgress(
  crewId: string,
  date: string,
  stops: CrewRouteStop[] = []
) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID");
  const normalizedCrewId = crewId.trim().toLowerCase();
  const stopsKey = stops.map((stop) => routeStopKey(stop.siteId, stop.address)).sort().join("|");
  const cacheKey = `${normalizedCrewId}|${date}|${stopsKey}`;
  const cached = routeProgressCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.entries;

  const sheets = await sheetsClient(true);
  let response;
  try {
    response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [`${quoteSheetTitle(PROGRESS_TAB)}!A:K`, "UploadsLog!A:K"],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("unable to parse range")) return [];
    throw error;
  }

  const latestByStop = new Map<string, RouteProgressEntry>();
  const progressValues = response.data.valueRanges?.[0]?.values ?? [];
  const uploadValues = response.data.valueRanges?.[1]?.values ?? [];
  const stopBySiteId = new Map(stops.filter((stop) => stop.siteId).map((stop) => [stop.siteId, stop]));

  for (const uploadRow of uploadValues.slice(1)) {
    const serviceDate = String(uploadRow[10] ?? "").trim();
    const siteId = String(uploadRow[2] ?? "").trim();
    const stop = stopBySiteId.get(siteId);
    if (serviceDate !== date || !stop) continue;
    const stopKey = routeStopKey(stop.siteId, stop.address);
    const timestamp = String(uploadRow[0] ?? "").trim();
    const previousUpload = latestByStop.get(stopKey);
    latestByStop.set(stopKey, {
      date,
      crewId,
      crewName: stop.crewName,
      stopKey,
      siteId: stop.siteId,
      address: stop.address,
      jobName: stop.jobName,
      status: "completed",
      completedAt: timestamp,
      photoCount: (previousUpload?.photoCount ?? 0) + uploadPhotoCount(uploadRow[5]),
      updatedAt: timestamp,
    });
  }

  for (const entry of parseRows(progressValues)) {
    if (entry.date !== date || entry.crewId.toLowerCase() !== normalizedCrewId) continue;
    latestByStop.set(entry.stopKey, entry);
  }
  const entries = [...latestByStop.values()];
  routeProgressCache.set(cacheKey, { expiresAt: Date.now() + ROUTE_PROGRESS_CACHE_TTL_MS, entries });
  return entries;
}

export async function recordRouteCompletion(entry: RouteProgressEntry) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID");
  const sheets = await sheetsClient(false);
  await ensureProgressSheet(sheets, spreadsheetId);

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetTitle(PROGRESS_TAB)}!A:K`,
  });
  const previous = parseRows(existing.data.values ?? [])
    .filter(
      (row) =>
        row.date === entry.date &&
        row.crewId.toLowerCase() === entry.crewId.toLowerCase() &&
        row.stopKey === entry.stopKey
    )
    .at(-1);
  if (previous?.status === entry.status) return previous;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetTitle(PROGRESS_TAB)}!A:K`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        entry.date,
        entry.crewId,
        entry.crewName,
        entry.stopKey,
        entry.siteId,
        entry.address,
        entry.jobName,
        entry.status,
        entry.completedAt,
        entry.photoCount,
        entry.updatedAt,
      ]],
    },
  });
  routeProgressCache.clear();
  return entry;
}

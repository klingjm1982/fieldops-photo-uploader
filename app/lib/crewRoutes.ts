import { google } from "googleapis";
import { readServiceAccount } from "@/app/lib/googleServiceAccount";
import { normalizeAddress, quoteSheetTitle } from "@/app/lib/siteSubCompanyOverrides";

export type CrewRouteStop = {
  date: string;
  crewId: string;
  crewName: string;
  stopOrder: number;
  siteId: string;
  address: string;
  jobName: string;
  routeType: string;
  timeWindowStart: string;
  timeWindowEnd: string;
  notes: string;
  propertySize: string;
  latitude?: number;
  longitude?: number;
};

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function column(headers: unknown[], names: string[], fallback: number) {
  const normalized = headers.map(normalizeHeader);
  const wanted = names.map(normalizeHeader);
  const index = normalized.findIndex((header) => wanted.includes(header));
  return index >= 0 ? index : fallback;
}

function cell(row: unknown[], index: number) {
  return index < 0 ? "" : String(row[index] ?? "").trim();
}

function optionalNumber(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function activeValue(value: string) {
  return !["n", "no", "false", "inactive", "0"].includes(value.toLowerCase());
}

function normalizeRouteDate(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return trimmed;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function saturdayRouteType(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  return ["makeup", "rainmakeup", "raindelay", "weathermakeup"].includes(normalized);
}

function canonicalPropertySize(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("small")) return "Small";
  if (normalized.startsWith("medium")) return "Medium";
  if (normalized.startsWith("large")) return "Large";
  return "";
}

function propertyAddressKey(value: string) {
  const streetNumber = value.match(/\b\d+\b/)?.[0] ?? "";
  const zip = value.match(/\b\d{5}(?:-\d{4})?\b/g)?.at(-1)?.slice(0, 5) ?? "";
  return streetNumber && zip ? `${streetNumber}|${zip}` : "";
}

async function sheetsClient(readOnly = true) {
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

export function currentServiceDate(timeZone = "America/Chicago") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function weekdayForDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`)
  );
}

export async function getCrewRouteWeekStops(
  crewId: string,
  weekStart: string,
  weekEnd: string
): Promise<CrewRouteStop[]> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_CREW_ROUTES_TAB || "CrewRoutes";
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID");

  const sheets = await sheetsClient();
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [`${quoteSheetTitle(tab)}!A:Z`, "Sites!A:Z", `${quoteSheetTitle("Chipotle sites")}!A:I`],
  });
  const routeValues = response.data.valueRanges?.[0]?.values ?? [];
  const siteValues = response.data.valueRanges?.[1]?.values ?? [];
  const classificationValues = response.data.valueRanges?.[2]?.values ?? [];
  const [headers = [], ...rows] = routeValues;
  if (headers.length === 0) return [];

  const [siteHeaders = [], ...siteRows] = siteValues;
  const siteAddressIndex = column(siteHeaders, ["address", "displayName", "siteAddress"], 0);
  const siteIdIndexForSize = column(
    siteHeaders,
    ["siteId", "folderId", "addressFolderId", "driveFolderId"],
    1
  );
  const sizeIndex = column(siteHeaders, ["size", "propertySize", "siteSize", "classification"], 6);
  const sizeBySiteId = new Map<string, string>();
  const sizeByAddress = new Map<string, string>();
  for (const siteRow of siteRows) {
    const propertySize = canonicalPropertySize(cell(siteRow, sizeIndex));
    if (!propertySize) continue;
    const siteId = cell(siteRow, siteIdIndexForSize).toLowerCase();
    const address = normalizeAddress(cell(siteRow, siteAddressIndex));
    if (siteId) sizeBySiteId.set(siteId, propertySize);
    if (address) sizeByAddress.set(address, propertySize);
  }
  const [classificationHeaders = [], ...classificationRows] = classificationValues;
  const classificationAddressIndex = column(classificationHeaders, ["address"], 0);
  const classificationSizeIndex = column(
    classificationHeaders,
    ["size", "propertySize", "siteSize", "classification"],
    6
  );
  const sizeByPropertyKey = new Map<string, string>();
  for (const classificationRow of classificationRows) {
    const propertySize = canonicalPropertySize(cell(classificationRow, classificationSizeIndex));
    const propertyKey = propertyAddressKey(cell(classificationRow, classificationAddressIndex));
    if (propertySize && propertyKey) sizeByPropertyKey.set(propertyKey, propertySize);
  }

  const dateIndex = column(headers, ["date", "serviceDate"], 0);
  const crewIdIndex = column(headers, ["crewId", "crew"], 1);
  const crewNameIndex = column(headers, ["crewName"], 2);
  const orderIndex = column(headers, ["stopOrder", "sequence", "order"], 3);
  const siteIdIndex = column(headers, ["siteId"], 4);
  const addressIndex = column(headers, ["address", "siteAddress"], 5);
  const jobNameIndex = column(headers, ["jobName", "propertyName", "siteName"], 6);
  const routeTypeIndex = column(headers, ["routeType", "type"], 7);
  const startIndex = column(headers, ["timeWindowStart", "startTime"], 8);
  const endIndex = column(headers, ["timeWindowEnd", "endTime"], 9);
  const notesIndex = column(headers, ["notes"], 10);
  const activeIndex = column(headers, ["active", "isActive"], 11);
  const latitudeIndex = column(headers, ["latitude", "lat"], -1);
  const longitudeIndex = column(headers, ["longitude", "lng", "lon"], -1);
  const normalizedCrewId = crewId.trim().toLowerCase();

  return rows
    .map((row, index) => ({
      date: normalizeRouteDate(cell(row, dateIndex)),
      crewId: cell(row, crewIdIndex),
      crewName: cell(row, crewNameIndex),
      stopOrder: Number(cell(row, orderIndex)) || index + 1,
      siteId: cell(row, siteIdIndex),
      address: cell(row, addressIndex),
      jobName: cell(row, jobNameIndex),
      routeType: cell(row, routeTypeIndex),
      timeWindowStart: cell(row, startIndex),
      timeWindowEnd: cell(row, endIndex),
      notes: cell(row, notesIndex),
      latitude: optionalNumber(cell(row, latitudeIndex)),
      longitude: optionalNumber(cell(row, longitudeIndex)),
      propertySize:
        sizeBySiteId.get(cell(row, siteIdIndex).toLowerCase()) ||
        sizeByAddress.get(normalizeAddress(cell(row, addressIndex))) ||
        sizeByPropertyKey.get(propertyAddressKey(cell(row, addressIndex))) ||
        "",
      active: activeValue(cell(row, activeIndex)),
    }))
    .filter(
      (row) =>
        row.active &&
        row.date >= weekStart &&
        row.date <= weekEnd &&
        (!normalizedCrewId || row.crewId.toLowerCase() === normalizedCrewId) &&
        row.address
    )
    .filter((row) => weekdayForDate(row.date) !== "Saturday" || saturdayRouteType(row.routeType))
    .sort((left, right) => left.date.localeCompare(right.date) || left.stopOrder - right.stopOrder)
    .map((row) => ({
      date: row.date,
      crewId: row.crewId,
      crewName: row.crewName,
      stopOrder: row.stopOrder,
      siteId: row.siteId,
      address: row.address,
      jobName: row.jobName,
      routeType: row.routeType,
      timeWindowStart: row.timeWindowStart,
      timeWindowEnd: row.timeWindowEnd,
      notes: row.notes,
      propertySize: row.propertySize,
      latitude: row.latitude,
      longitude: row.longitude,
    }));
}

export async function getCrewRouteStops(crewId: string, date: string) {
  return getCrewRouteWeekStops(crewId, date, date);
}

export async function getAllCrewRouteStops(date: string) {
  return getCrewRouteWeekStops("", date, date);
}

function columnLetter(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export async function saveCrewRouteStopOrder(
  crewId: string,
  date: string,
  orderedStops: CrewRouteStop[]
) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_CREW_ROUTES_TAB || "CrewRoutes";
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID");

  const sheets = await sheetsClient(false);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetTitle(tab)}!A:Z`,
  });
  const [headers = [], ...rows] = response.data.values ?? [];
  if (headers.length === 0) throw new Error("The CrewRoutes sheet has no headers.");

  const dateIndex = column(headers, ["date", "serviceDate"], 0);
  const crewIdIndex = column(headers, ["crewId", "crew"], 1);
  const orderIndex = column(headers, ["stopOrder", "sequence", "order"], 3);
  const siteIdIndex = column(headers, ["siteId"], 4);
  const addressIndex = column(headers, ["address", "siteAddress"], 5);
  const normalizedCrewId = crewId.trim().toLowerCase();
  const usedRows = new Set<number>();

  const updates = orderedStops.map((stop, index) => {
    const rowIndex = rows.findIndex((row, candidateIndex) => {
      if (usedRows.has(candidateIndex)) return false;
      if (normalizeRouteDate(cell(row, dateIndex)) !== date) return false;
      if (cell(row, crewIdIndex).toLowerCase() !== normalizedCrewId) return false;
      const rowSiteId = cell(row, siteIdIndex);
      if (stop.siteId && rowSiteId) return rowSiteId === stop.siteId;
      return cell(row, addressIndex).toLowerCase() === stop.address.toLowerCase();
    });
    if (rowIndex < 0) throw new Error(`Could not match route stop: ${stop.address}`);
    usedRows.add(rowIndex);
    return {
      range: `${quoteSheetTitle(tab)}!${columnLetter(orderIndex)}${rowIndex + 2}`,
      values: [[index + 1]],
    };
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: updates },
  });
}

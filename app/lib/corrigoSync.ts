import { google, sheets_v4 } from "googleapis";
import { parseCorrigoWorkOrderEmail } from "@/app/lib/corrigoEmailParser";
import { readServiceAccount } from "@/app/lib/googleServiceAccount";

export type CorrigoWorkOrder = {
  month: string;
  siteId: string;
  address: string;
  workOrderNumber: string;
  active: boolean;
  notes: string;
};

export type CorrigoQueueRow = {
  queueId: string;
  month: string;
  siteId: string;
  address: string;
  serviceDate: string;
  workOrderNumber: string;
  uploadTimestamp: string;
  photoCount: number;
  driveLinks: string;
  originalFilenames: string;
  status: string;
  attempts: number;
  lastError: string;
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
};

type UploadGroup = {
  month: string;
  siteId: string;
  address: string;
  serviceDate: string;
  uploadTimestamp: string;
  photoCount: number;
  driveLinks: string[];
  originalFilenames: string[];
};

type SiteMatch = {
  siteId: string;
  address: string;
};

const WORK_ORDERS_TAB = "CorrigoWorkOrders";
const QUEUE_TAB = "CorrigoUploadQueue";
const UPLOADS_TAB = process.env.GOOGLE_UPLOADS_TAB || "UploadsLog";

const WORK_ORDER_HEADERS = [
  "month",
  "siteId",
  "address",
  "workOrderNumber",
  "active",
  "notes",
];

const QUEUE_HEADERS = [
  "queueId",
  "month",
  "siteId",
  "address",
  "serviceDate",
  "workOrderNumber",
  "uploadTimestamp",
  "photoCount",
  "driveLinks",
  "originalFilenames",
  "status",
  "attempts",
  "lastError",
  "uploadedAt",
  "createdAt",
  "updatedAt",
];

async function getSheetsClient() {
  const { clientEmail, privateKey } = readServiceAccount();
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

function spreadsheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEET_ID");
  return id;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function headerIndex(headers: unknown[], names: string[], fallback: number) {
  const normalized = headers.map(normalizeHeader);
  const wanted = names.map(normalizeHeader);
  const index = normalized.findIndex((h) => wanted.includes(h));
  return index >= 0 ? index : fallback;
}

function hasHeader(headers: unknown[], names: string[]) {
  const normalized = headers.map(normalizeHeader);
  const wanted = names.map(normalizeHeader);
  return normalized.some((h) => wanted.includes(h));
}

function cell(row: unknown[], index: number) {
  if (index < 0) return "";
  return String(row[index] ?? "").trim();
}

function parseActive(value: string) {
  if (!value) return true;
  return !["n", "no", "false", "inactive", "0"].includes(value.toLowerCase());
}

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSiteHeaderRow(siteId: string, address: string) {
  const normalizedSiteId = normalizeHeader(siteId);
  const normalizedAddress = normalizeHeader(address);
  return (
    normalizedAddress.includes("address") ||
    normalizedAddress.includes("displayname") ||
    normalizedSiteId.includes("siteid") ||
    normalizedSiteId.includes("folderid")
  );
}

function localDateParts(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) return null;
  return { month: `${year}-${month}`, date: `${year}-${month}-${day}` };
}

function currentMonth(timeZone: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}

function queueIdFor(group: UploadGroup, workOrderNumber: string) {
  return [group.month, group.siteId, group.serviceDate, workOrderNumber].join("__");
}

function splitLines(value: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const MONTH_ABBREVIATIONS: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  SEPT: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

function serviceDateFromFilename(filename: string, fallbackYear: string) {
  const upper = filename.toUpperCase();
  const isoMatch = upper.match(/\b(20\d{2})[-_ ]?([01]\d)[-_ ]?([0-3]\d)\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashDateMatch = upper.match(/\b([01]?\d)[-.\/_ ]([0-3]?\d)[-.\/_ ](20\d{2})\b/);
  if (slashDateMatch) {
    return `${slashDateMatch[3]}-${slashDateMatch[1].padStart(2, "0")}-${slashDateMatch[2].padStart(2, "0")}`;
  }

  const dayMonthMatch = upper.match(/\b([0-3]?\d)\s*[-_ ]?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\b/);
  if (dayMonthMatch) {
    return `${fallbackYear}-${MONTH_ABBREVIATIONS[dayMonthMatch[2]]}-${dayMonthMatch[1].padStart(2, "0")}`;
  }

  const monthDayMatch = upper.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\s*[-_ ]?\s*([0-3]?\d)\b/);
  if (monthDayMatch) {
    return `${fallbackYear}-${MONTH_ABBREVIATIONS[monthDayMatch[1]]}-${monthDayMatch[2].padStart(2, "0")}`;
  }

  return "";
}

function serviceDateFromFilenames(filenames: string[], fallbackDate: string) {
  const fallbackYear = fallbackDate.slice(0, 4);
  const dates = filenames
    .map((filename) => serviceDateFromFilename(filename, fallbackYear))
    .filter(Boolean)
    .sort();

  return dates[0] || fallbackDate;
}

async function ensureSheet(sheets: sheets_v4.Sheets, title: string, headers: string[]) {
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties.title",
  });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === title);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
  }

  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${title}!A1:Z1`,
  });

  if ((current.data.values ?? []).length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${title}!A1:${String.fromCharCode(64 + headers.length)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [headers] },
    });
  }
}

async function readValues(sheets: sheets_v4.Sheets, tab: string) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${tab}!A:Z`,
  });
  return resp.data.values ?? [];
}

function parseWorkOrders(rows: unknown[][]): CorrigoWorkOrder[] {
  const [maybeHeaders = [], ...remainingRows] = rows;
  const headers = hasHeader(maybeHeaders, ["workOrderNumber", "siteId", "month"])
    ? maybeHeaders
    : [];
  const body = headers.length > 0 ? remainingRows : rows;
  const monthIdx = headerIndex(headers, ["month"], 0);
  const siteIdx = headerIndex(headers, ["siteId"], 1);
  const addressIdx = headerIndex(headers, ["address"], 2);
  const workOrderIdx = headerIndex(headers, ["workOrderNumber", "corrigoWorkOrderNumber"], 3);
  const activeIdx = headerIndex(headers, ["active"], 4);
  const notesIdx = headerIndex(headers, ["notes"], 5);

  return body
    .map((row) => ({
      month: cell(row, monthIdx),
      siteId: cell(row, siteIdx),
      address: cell(row, addressIdx),
      workOrderNumber: cell(row, workOrderIdx),
      active: parseActive(cell(row, activeIdx)),
      notes: cell(row, notesIdx),
    }))
    .filter((row) => row.month && row.siteId && row.workOrderNumber);
}

function parseQueue(rows: unknown[][]): CorrigoQueueRow[] {
  const [maybeHeaders = [], ...remainingRows] = rows;
  const headers = hasHeader(maybeHeaders, ["queueId", "workOrderNumber", "status"])
    ? maybeHeaders
    : [];
  const body = headers.length > 0 ? remainingRows : rows;

  return body
    .map((row) => ({
      queueId: cell(row, headerIndex(headers, ["queueId"], 0)),
      month: cell(row, headerIndex(headers, ["month"], 1)),
      siteId: cell(row, headerIndex(headers, ["siteId"], 2)),
      address: cell(row, headerIndex(headers, ["address"], 3)),
      serviceDate: cell(row, headerIndex(headers, ["serviceDate"], 4)),
      workOrderNumber: cell(row, headerIndex(headers, ["workOrderNumber"], 5)),
      uploadTimestamp: cell(row, headerIndex(headers, ["uploadTimestamp"], 6)),
      photoCount: parseNumber(cell(row, headerIndex(headers, ["photoCount"], 7))),
      driveLinks: cell(row, headerIndex(headers, ["driveLinks"], 8)),
      originalFilenames: cell(row, headerIndex(headers, ["originalFilenames"], 9)),
      status: cell(row, headerIndex(headers, ["status"], 10)) || "Pending Corrigo Upload",
      attempts: parseNumber(cell(row, headerIndex(headers, ["attempts"], 11))),
      lastError: cell(row, headerIndex(headers, ["lastError"], 12)),
      uploadedAt: cell(row, headerIndex(headers, ["uploadedAt"], 13)),
      createdAt: cell(row, headerIndex(headers, ["createdAt"], 14)),
      updatedAt: cell(row, headerIndex(headers, ["updatedAt"], 15)),
    }))
    .filter((row) => row.queueId);
}

function parseUploadGroups(rows: unknown[][], timeZone: string, month: string) {
  const [maybeHeaders = [], ...remainingRows] = rows;
  const headers = hasHeader(maybeHeaders, ["timestamp", "timestampISO", "siteId"])
    ? maybeHeaders
    : [];
  const body = headers.length > 0 ? remainingRows : rows;
  const timestampIdx = headerIndex(headers, ["timestamp", "timestampISO", "uploadedAt"], 0);
  const addressIdx = headerIndex(headers, ["address"], 1);
  const siteIdx = headerIndex(headers, ["siteId"], 2);
  const countIdx = headerIndex(headers, ["count", "fileCount", "driveFileId"], 5);
  const linksIdx = headerIndex(headers, ["driveLinks", "driveLink"], 6);
  const filenamesIdx = headerIndex(headers, ["originalFilenames", "originalFilename"], 7);
  const groups = new Map<string, UploadGroup>();

  for (const row of body) {
    const timestamp = cell(row, timestampIdx);
    const parts = localDateParts(timestamp, timeZone);
    const siteId = cell(row, siteIdx);
    if (!parts || parts.month !== month || !siteId) continue;

    const countText = cell(row, countIdx);
    const parsedCount = Number(countText.match(/\d+/)?.[0] ?? "0");
    const links = splitLines(cell(row, linksIdx));
    const filenames = splitLines(cell(row, filenamesIdx));
    const serviceDate = serviceDateFromFilenames(filenames, parts.date);
    const serviceMonth = serviceDate.slice(0, 7);
    if (serviceMonth !== month) continue;

    const key = `${serviceMonth}__${siteId}__${serviceDate}`;
    const existing = groups.get(key);

    if (existing) {
      existing.photoCount += parsedCount || links.length || filenames.length || 1;
      existing.driveLinks.push(...links);
      existing.originalFilenames.push(...filenames);
      if (timestamp > existing.uploadTimestamp) existing.uploadTimestamp = timestamp;
      continue;
    }

    groups.set(key, {
      month: serviceMonth,
      siteId,
      address: cell(row, addressIdx),
      serviceDate,
      uploadTimestamp: timestamp,
      photoCount: parsedCount || links.length || filenames.length || 1,
      driveLinks: links,
      originalFilenames: filenames,
    });
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.serviceDate.localeCompare(b.serviceDate) || a.address.localeCompare(b.address)
  );
}

function normalizeAddress(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(united states|usa|us)\b/g, "")
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(parkway)\b/g, "pkwy")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(north)\b/g, "n")
    .replace(/\b(south)\b/g, "s")
    .replace(/\b(east)\b/g, "e")
    .replace(/\b(west)\b/g, "w")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseSites(rows: unknown[][]): SiteMatch[] {
  const [maybeHeaders = [], ...remainingRows] = rows;
  const headers = hasHeader(maybeHeaders, ["address", "siteId", "folderId"]) ? maybeHeaders : [];
  const body = headers.length > 0 ? remainingRows : rows;
  const addressIdx = headerIndex(headers, ["address", "displayName", "siteAddress"], 0);
  const folderIdx = headerIndex(headers, ["folderId", "addressFolderId", "driveFolderId"], 1);
  const siteIdIdx = headerIndex(headers, ["siteId"], folderIdx);
  const activeIdx = headerIndex(headers, ["active", "isActive"], 2);

  return body
    .map((row) => ({
      siteId: cell(row, siteIdIdx) || cell(row, folderIdx),
      address: cell(row, addressIdx),
      active: parseActive(cell(row, activeIdx)),
    }))
    .filter((row) => row.siteId && row.address && row.active)
    .filter((row) => !isSiteHeaderRow(row.siteId, row.address))
    .map((row) => ({ siteId: row.siteId, address: row.address }));
}

async function readSites(sheets: sheets_v4.Sheets) {
  const sitesTab = process.env.GOOGLE_SHEET_TAB || "Sites";
  try {
    return parseSites(await readValues(sheets, sitesTab));
  } catch (error) {
    if (sitesTab !== "Sheet1") throw error;
    return parseSites(await readValues(sheets, "Sites"));
  }
}

function findSiteByAddress(sites: SiteMatch[], address: string) {
  const normalized = normalizeAddress(address);
  return (
    sites.find((site) => normalizeAddress(site.address) === normalized) ??
    sites.find((site) => {
      const siteAddress = normalizeAddress(site.address);
      return siteAddress.includes(normalized) || normalized.includes(siteAddress);
    }) ??
    null
  );
}

function queueRowToValues(row: CorrigoQueueRow) {
  return [
    row.queueId,
    row.month,
    row.siteId,
    row.address,
    row.serviceDate,
    row.workOrderNumber,
    row.uploadTimestamp,
    row.photoCount,
    row.driveLinks,
    row.originalFilenames,
    row.status,
    row.attempts,
    row.lastError,
    row.uploadedAt,
    row.createdAt,
    row.updatedAt,
  ];
}

export async function getCorrigoSyncState(monthParam?: string) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets, WORK_ORDERS_TAB, WORK_ORDER_HEADERS);
  await ensureSheet(sheets, QUEUE_TAB, QUEUE_HEADERS);

  const timeZone = process.env.SERVICE_TIME_ZONE || "America/Chicago";
  const month = monthParam || currentMonth(timeZone);
  const [workOrderRows, queueRows, uploadRows] = await Promise.all([
    readValues(sheets, WORK_ORDERS_TAB),
    readValues(sheets, QUEUE_TAB),
    readValues(sheets, UPLOADS_TAB),
  ]);

  const workOrders = parseWorkOrders(workOrderRows);
  const queue = parseQueue(queueRows);
  const uploadGroups = parseUploadGroups(uploadRows, timeZone, month);
  const activeWorkOrders = workOrders.filter((row) => row.month === month && row.active);
  const activeSiteIds = new Set(activeWorkOrders.map((row) => row.siteId));
  const queuedIds = new Set(queue.map((row) => row.queueId));
  const queueCandidates = uploadGroups
    .filter((group) => activeSiteIds.has(group.siteId))
    .filter((group) => {
      const workOrder = activeWorkOrders.find((row) => row.siteId === group.siteId);
      return workOrder ? !queuedIds.has(queueIdFor(group, workOrder.workOrderNumber)) : false;
    });

  return {
    month,
    workOrders,
    queue,
    uploadGroups,
    queueCandidates,
  };
}

export async function addCorrigoWorkOrder(row: CorrigoWorkOrder) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets, WORK_ORDERS_TAB, WORK_ORDER_HEADERS);
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${WORK_ORDERS_TAB}!A:F`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[row.month, row.siteId, row.address, row.workOrderNumber, row.active ? "Y" : "N", row.notes]],
    },
  });
}

export async function addCorrigoWorkOrderFromEmail(params: { subject: string; body: string }) {
  const parsed = parseCorrigoWorkOrderEmail(params.subject, params.body);
  if (!parsed.accepted) {
    return { ok: false, parsed, message: parsed.reason };
  }

  const sheets = await getSheetsClient();
  const sites = await readSites(sheets);
  const match = findSiteByAddress(sites, parsed.siteAddress);

  if (!match) {
    return {
      ok: false,
      parsed,
      message: "No matching site found for Site Address.",
    };
  }

  await addCorrigoWorkOrder({
    month: parsed.month,
    siteId: match.siteId,
    address: match.address,
    workOrderNumber: parsed.workOrderNumber,
    active: true,
    notes: [parsed.customerName, parsed.propertyName, "Parsed from Corrigo email"]
      .filter(Boolean)
      .join(" | "),
  });

  return { ok: true, parsed, site: match };
}

export async function buildCorrigoQueue(monthParam?: string) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets, WORK_ORDERS_TAB, WORK_ORDER_HEADERS);
  await ensureSheet(sheets, QUEUE_TAB, QUEUE_HEADERS);

  const state = await getCorrigoSyncState(monthParam);
  const now = new Date().toISOString();
  const workOrderBySite = new Map(
    state.workOrders
      .filter((row) => row.month === state.month && row.active)
      .map((row) => [row.siteId, row])
  );
  const existingQueueIds = new Set(state.queue.map((row) => row.queueId));
  const rowsToAppend: CorrigoQueueRow[] = [];

  for (const group of state.uploadGroups) {
    const workOrder = workOrderBySite.get(group.siteId);
    if (!workOrder) continue;

    const queueId = queueIdFor(group, workOrder.workOrderNumber);
    if (existingQueueIds.has(queueId)) continue;

    rowsToAppend.push({
      queueId,
      month: group.month,
      siteId: group.siteId,
      address: group.address || workOrder.address,
      serviceDate: group.serviceDate,
      workOrderNumber: workOrder.workOrderNumber,
      uploadTimestamp: group.uploadTimestamp,
      photoCount: group.photoCount,
      driveLinks: group.driveLinks.join("\n"),
      originalFilenames: group.originalFilenames.join("\n"),
      status: "Pending Corrigo Upload",
      attempts: 0,
      lastError: "",
      uploadedAt: "",
      createdAt: now,
      updatedAt: now,
    });
  }

  if (rowsToAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId(),
      range: `${QUEUE_TAB}!A:P`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rowsToAppend.map(queueRowToValues) },
    });
  }

  return { created: rowsToAppend.length, rows: rowsToAppend };
}

export async function rebuildCorrigoQueue(monthParam?: string) {
  const sheets = await getSheetsClient();
  await ensureSheet(sheets, WORK_ORDERS_TAB, WORK_ORDER_HEADERS);
  await ensureSheet(sheets, QUEUE_TAB, QUEUE_HEADERS);

  const state = await getCorrigoSyncState(monthParam);
  const preservedRows = state.queue.filter(
    (row) => row.month !== state.month || row.status !== "Pending Corrigo Upload"
  );

  await sheets.spreadsheets.values.clear({
    spreadsheetId: spreadsheetId(),
    range: `${QUEUE_TAB}!A:P`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${QUEUE_TAB}!A1:P${Math.max(preservedRows.length + 1, 1)}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [QUEUE_HEADERS, ...preservedRows.map(queueRowToValues)],
    },
  });

  return buildCorrigoQueue(state.month);
}

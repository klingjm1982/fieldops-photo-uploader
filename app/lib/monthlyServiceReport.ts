import { google, sheets_v4 } from "googleapis";
import { readServiceAccount } from "@/app/lib/googleServiceAccount";
import {
  firstHeaderIndex,
  isValidWorkOrderValue,
  quoteSheetTitle,
  readSubCompanyOverrides,
  subCompanyForSite,
  normalizeAddress,
  workOrderColumnIndex,
  workOrderSiteListTab,
} from "@/app/lib/siteSubCompanyOverrides";

export type MonthlyStatus = "OK" | "LOW" | "MISSING";

export type MonthlyServiceRow = {
  month: string;
  siteId: string;
  workOrderNumber: string;
  address: string;
  clientName: string;
  subCompany: string;
  subEmail: string;
  expectedServices: number;
  completedServices: number;
  missingServices: number;
  subPrice: number;
  invoiceAmount: number;
  lastUploadDate: string;
  status: MonthlyStatus;
};

type SiteRow = {
  siteId: string;
  folderId: string;
  address: string;
  clientName: string;
  subCompany: string;
  subEmail: string;
  expectedServices: number;
  subPrice: number;
  workOrdersByMonth: Map<string, string>;
  active: boolean;
};

const SUMMARY_TAB = "MonthlyServiceSummary";
const MISSED_TAB = "MissedServices";
const EXPECTATIONS_TAB = "MonthlyServiceExpectations";
const EXPECTATIONS_HEADERS = ["month", "siteId", "expectedServices", "notes"];
const SUMMARY_HEADERS = [
  "month",
  "siteId",
  "workOrderNumber",
  "address",
  "clientName",
  "subCompany",
  "subEmail",
  "expectedServices",
  "completedServices",
  "missingServices",
  "subPrice",
  "invoiceAmount",
  "lastUploadDate",
  "status",
];

export async function getSheetsClient() {
  const { clientEmail, privateKey } = readServiceAccount();
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
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
  return !["n", "no", "false", "inactive", "0"].includes(value.trim().toLowerCase());
}

function parseNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function monthNumberFromWorkOrderHeader(header: unknown) {
  const normalized = normalizeHeader(header);
  if (!normalized.includes("workorders") && !normalized.includes("wo")) return "";

  const monthIndex = MONTH_NAMES.findIndex((name) => normalized.includes(name));
  return monthIndex >= 0 ? String(monthIndex + 1).padStart(2, "0") : "";
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

function dateOnlyParts(value: string) {
  const match = value.trim().match(/^(20\d{2})-([01]\d)-([0-3]\d)/);
  if (!match) return null;
  return { month: `${match[1]}-${match[2]}`, date: `${match[1]}-${match[2]}-${match[3]}` };
}

function localDateParts(value: string, timeZone: string, dateOnly = false) {
  if (dateOnly) return dateOnlyParts(value);

  const normalizedValue = value.trim().replace(
    /^(20\d{2}-[01]\d-[0-3]\d)(\d{2}:\d{2})/,
    "$1T$2"
  );
  const date = new Date(normalizedValue);
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

function rowToValues(row: MonthlyServiceRow) {
  return [
    row.month,
    row.siteId,
    row.workOrderNumber,
    row.address,
    row.clientName,
    row.subCompany,
    row.subEmail,
    row.expectedServices,
    row.completedServices,
    row.missingServices,
    row.subPrice,
    row.invoiceAmount,
    row.lastUploadDate,
    row.status,
  ];
}

async function ensureSheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
  headers?: string[]
) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
  }

  if (!headers) return;

  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${title}!A1:Z1`,
  });

  if ((current.data.values ?? []).length > 0) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1:${String.fromCharCode(64 + headers.length)}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers] },
  });
}

async function replaceTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
  rows: unknown[][]
) {
  await ensureSheet(sheets, spreadsheetId, title);
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${title}!A:N`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1:N${Math.max(rows.length, 1)}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
}

function parseSites(rows: unknown[][]): SiteRow[] {
  const [maybeHeaders = [], ...remainingRows] = rows;
  const knownHeaders = [
    "address",
    "displayName",
    "siteAddress",
    "siteId",
    "folderId",
    "active",
    "servicesPerMonth",
    "Subcontractor company",
  ];
  const headers = hasHeader(maybeHeaders, knownHeaders) ? maybeHeaders : [];
  const body = headers.length > 0 ? remainingRows : rows;
  const addressIdx = firstHeaderIndex(
    headers,
    [
      ["fullAddress", "full address"],
      ["address", "displayName", "siteAddress", "address1", "address 1"],
    ],
    0
  );
  const folderIdx = headerIndex(headers, ["folderId", "addressFolderId", "driveFolderId"], 1);
  const siteIdIdx = headerIndex(headers, ["siteId"], folderIdx);
  const activeIdx = headerIndex(headers, ["active", "isActive"], -1);
  const clientIdx = headerIndex(headers, ["clientName", "client"], -1);
  const subCompanyIdx = headerIndex(
    headers,
    ["Subcontractor company", "subcontractorCompany", "subCompany", "subCompanyName", "market"],
    10
  );
  const subEmailIdx = firstHeaderIndex(
    headers,
    [
      ["emailAddress", "email address"],
      ["subEmail", "subcontractorEmail", "subcontractor email"],
    ],
    -1
  );
  const expectedIdx = headerIndex(
    headers,
    ["servicesPerMonth", "expectedServices", "expectedServicesPerMonth"],
    -1
  );
  const subPriceIdx = headerIndex(headers, ["subPrice", "Sub Price", "subServicePrice"], -1);
  const workOrderIndexes = headers
    .map((header, index) => ({ index, monthNumber: monthNumberFromWorkOrderHeader(header) }))
    .filter((item) => item.monthNumber);

  return body
    .map((r) => {
      const siteId = cell(r, siteIdIdx) || cell(r, folderIdx);
      const workOrdersByMonth = new Map<string, string>();
      for (const item of workOrderIndexes) {
        const workOrderNumber = cell(r, item.index);
        if (isValidWorkOrderValue(workOrderNumber)) {
          workOrdersByMonth.set(item.monthNumber, workOrderNumber);
        }
      }

      return {
        siteId,
        folderId: cell(r, folderIdx),
        address: cell(r, addressIdx),
        clientName: cell(r, clientIdx) || "Driven Brands",
        subCompany: cell(r, subCompanyIdx),
        subEmail: cell(r, subEmailIdx),
        expectedServices: parseNumber(cell(r, expectedIdx), 0),
        subPrice: parseNumber(cell(r, subPriceIdx), 0),
        workOrdersByMonth,
        active: parseActive(cell(r, activeIdx)),
      };
    })
    .filter((s) => s.siteId && s.address && s.active)
    .filter((s) => !isSiteHeaderRow(s.siteId, s.address));
}

function parseLegacySites(rows: unknown[][]): SiteRow[] {
  const [maybeHeaders = [], ...remainingRows] = rows;
  const headers = hasHeader(maybeHeaders, ["address", "folderId", "active"]) ? maybeHeaders : [];
  const body = headers.length > 0 ? remainingRows : rows;
  const addressIdx = firstHeaderIndex(headers, [["address", "displayName", "siteAddress"]], 0);
  const folderIdx = headerIndex(headers, ["folderId", "addressFolderId", "driveFolderId", "siteId"], 1);
  const activeIdx = headerIndex(headers, ["active", "isActive"], 2);
  const subCompanyIdx = headerIndex(headers, ["subCompany", "subcontractorCompany", "market"], 3);
  const expectedIdx = headerIndex(headers, ["servicesPerMonth", "expectedServices"], 4);
  const clientIdx = headerIndex(headers, ["clientName", "client"], 5);

  return body
    .map((row) => {
      const address = cell(row, addressIdx);
      const folderId = cell(row, folderIdx);
      return {
        siteId: folderId,
        folderId,
        address,
        clientName: cell(row, clientIdx) || "Driven Brands",
        subCompany: cell(row, subCompanyIdx),
        subEmail: "",
        expectedServices: parseNumber(cell(row, expectedIdx), 0),
        subPrice: 0,
        workOrdersByMonth: new Map<string, string>(),
        active: parseActive(cell(row, activeIdx)),
      };
    })
    .filter((s) => s.siteId && s.address && s.active)
    .filter((s) => !isSiteHeaderRow(s.siteId, s.address));
}

function mergeSiteRows(primary: SiteRow[], fallback: SiteRow[]) {
  const byAddress = new Set(primary.map((site) => normalizeAddress(site.address)));
  const bySiteId = new Set(primary.map((site) => site.siteId).filter(Boolean));
  const merged = [...primary];

  for (const site of fallback) {
    const addressKey = normalizeAddress(site.address);
    if (bySiteId.has(site.siteId) || byAddress.has(addressKey)) continue;
    merged.push(site);
    bySiteId.add(site.siteId);
    byAddress.add(addressKey);
  }

  return merged;
}

function parseMonthlyExpectations(rows: unknown[][]) {
  const [maybeHeaders = [], ...remainingRows] = rows;
  const headers = hasHeader(maybeHeaders, ["month", "expectedServices"]) ? maybeHeaders : [];
  const body = headers.length > 0 ? remainingRows : rows;
  const monthIdx = headerIndex(headers, ["month"], 0);
  const siteIdx = headerIndex(headers, ["siteId", "folderId", "addressFolderId"], 1);
  const expectedIdx = headerIndex(headers, ["expectedServices", "servicesPerMonth"], 2);
  const expectations = new Map<string, number>();

  for (const row of body) {
    const month = cell(row, monthIdx);
    const siteId = cell(row, siteIdx);
    const expectedServices = parseNumber(cell(row, expectedIdx), -1);
    if (!month || expectedServices < 0) continue;

    const normalizedSiteId = siteId && !["all", "default", "*"].includes(siteId.toLowerCase()) ? siteId : "*";
    expectations.set(`${month}::${normalizedSiteId}`, expectedServices);
  }

  return expectations;
}

function parseUploads(rows: unknown[][], timeZone: string) {
  const [maybeHeaders = [], ...remainingRows] = rows;
  const headers = hasHeader(maybeHeaders, ["timestamp", "timestampISO", "uploadedAt", "siteId"])
    ? maybeHeaders
    : [];
  const body = headers.length > 0 ? remainingRows : rows;
  const timestampIdx = headerIndex(headers, ["timestamp", "timestampISO", "uploadedAt"], 0);
  const siteIdIdx = headerIndex(headers, ["siteId"], 2);
  const addressFolderIdIdx = headerIndex(headers, ["addressFolderId", "folderId", "driveFolderId"], 3);
  const countIdx = headerIndex(headers, ["count", "fileCount", "driveFileId"], 5);
  const linksIdx = headerIndex(headers, ["driveLinks", "driveLink"], 6);
  const filenamesIdx = headerIndex(headers, ["originalFilenames", "originalFilename"], 7);
  const notesIdx = headerIndex(headers, ["notes"], 9);
  const groups = new Set<string>();
  const lastUploadByMonthSite = new Map<string, string>();
  const months = new Set<string>();

  for (const r of body) {
    const siteIds = Array.from(new Set([cell(r, siteIdIdx), cell(r, addressFolderIdIdx)].filter(Boolean)));
    const manualText = [cell(r, countIdx), cell(r, linksIdx), cell(r, filenamesIdx), cell(r, notesIdx)]
      .join(" ")
      .toLowerCase();
    const hasPhotoEvidence =
      /\d+\s*file/.test(cell(r, countIdx).toLowerCase()) ||
      Boolean(cell(r, linksIdx)) ||
      Boolean(cell(r, filenamesIdx));
    const isManualUpload = !hasPhotoEvidence || manualText.includes("manual") || manualText.includes("no photo");
    const parts = localDateParts(cell(r, timestampIdx), timeZone, isManualUpload);
    if (siteIds.length === 0 || !parts) continue;

    months.add(parts.month);
    for (const siteId of siteIds) {
      groups.add(`${parts.month}::${siteId}::${parts.date}`);
      const monthSiteKey = `${parts.month}::${siteId}`;
      const currentLast = lastUploadByMonthSite.get(monthSiteKey);
      if (!currentLast || parts.date > currentLast) lastUploadByMonthSite.set(monthSiteKey, parts.date);
    }
  }

  const completedByMonthSite = new Map<string, number>();
  for (const key of groups) {
    const [month, siteId] = key.split("::");
    const monthSiteKey = `${month}::${siteId}`;
    completedByMonthSite.set(monthSiteKey, (completedByMonthSite.get(monthSiteKey) ?? 0) + 1);
  }

  return { completedByMonthSite, lastUploadByMonthSite, months };
}

function parseWorkOrders(rows: unknown[][]) {
  const [maybeHeaders = [], ...remainingRows] = rows;
  const headers = hasHeader(maybeHeaders, ["workOrderNumber", "siteId", "month"])
    ? maybeHeaders
    : [];
  const body = headers.length > 0 ? remainingRows : rows;
  const monthIdx = headerIndex(headers, ["month"], 0);
  const siteIdx = headerIndex(headers, ["siteId"], 1);
  const workOrderIdx = headerIndex(headers, ["workOrderNumber", "corrigoWorkOrderNumber"], 3);
  const activeIdx = headerIndex(headers, ["active"], 4);
  const workOrders = new Map<string, string>();

  for (const row of body) {
    const month = cell(row, monthIdx);
    const siteId = cell(row, siteIdx);
    const workOrderNumber = cell(row, workOrderIdx);
    const active = parseActive(cell(row, activeIdx));
    if (!month || !siteId || !workOrderNumber || !active) continue;
    workOrders.set(`${month}::${siteId}`, workOrderNumber);
  }

  return workOrders;
}

export async function refreshMonthlyServiceReport(monthParam?: string) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sitesTab = workOrderSiteListTab();
  const uploadsTab = process.env.GOOGLE_UPLOADS_TAB || "UploadsLog";
  const workOrdersTab = "CorrigoWorkOrders";
  const timeZone = process.env.SERVICE_TIME_ZONE || "America/Chicago";

  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID");

  const sheets = await getSheetsClient();
  const sitesResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetTitle(sitesTab)}!A:AZ`,
  });
  let fallbackSitesResp;
  try {
    fallbackSitesResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Sites!A:Z",
    });
  } catch {
    fallbackSitesResp = { data: { values: [] } };
  }

  const uploadsResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${uploadsTab}!A:Z`,
  });
  await ensureSheet(sheets, spreadsheetId, EXPECTATIONS_TAB, EXPECTATIONS_HEADERS);
  const expectationsResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${EXPECTATIONS_TAB}!A:D`,
  });
  let workOrdersResp;
  try {
    workOrdersResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${workOrdersTab}!A:Z`,
    });
  } catch {
    workOrdersResp = { data: { values: [] } };
  }

  const sites = mergeSiteRows(
    parseSites(sitesResp.data.values ?? []),
    parseLegacySites(fallbackSitesResp.data.values ?? [])
  );
  const subCompanyOverrides = await readSubCompanyOverrides(sheets, spreadsheetId);
  const expectations = parseMonthlyExpectations(expectationsResp.data.values ?? []);
  const uploads = parseUploads(uploadsResp.data.values ?? [], timeZone);
  const workOrders = parseWorkOrders(workOrdersResp.data.values ?? []);
  const months = monthParam
    ? [monthParam]
    : Array.from(new Set([...uploads.months, currentMonth(timeZone)])).sort().reverse();

  const summary: MonthlyServiceRow[] = months
    .flatMap((month) =>
      sites.flatMap((site) => {
        const monthWorkOrderNumber = site.workOrdersByMonth.get(month.slice(5, 7)) ?? "";
        const monthSiteKey = `${month}::${site.siteId}`;
        const mappedWorkOrderNumber = workOrders.get(monthSiteKey) ?? "";
        if (
          workOrderColumnIndex(sitesResp.data.values?.[0] ?? [], month) >= 0 &&
          !monthWorkOrderNumber &&
          !mappedWorkOrderNumber
        ) {
          return [];
        }

        const completedServices = uploads.completedByMonthSite.get(monthSiteKey) ?? 0;
        const expectedServices =
          expectations.get(monthSiteKey) ??
          expectations.get(`${month}::*`) ??
          site.expectedServices;
        const missingServices = Math.max(expectedServices - completedServices, 0);
        const subPrice = site.subPrice;
        const invoiceAmount = completedServices * subPrice;
        const status: MonthlyStatus =
          completedServices >= expectedServices ? "OK" : completedServices > 0 ? "LOW" : "MISSING";

        return {
          month,
          siteId: site.siteId,
          workOrderNumber: mappedWorkOrderNumber || monthWorkOrderNumber,
          address: site.address,
          clientName: site.clientName,
          subCompany: subCompanyForSite(
            subCompanyOverrides,
            { folderId: site.folderId, siteId: site.siteId, address: site.address },
            site.subCompany
          ),
          subEmail: site.subEmail,
          expectedServices,
          completedServices,
          missingServices,
          subPrice,
          invoiceAmount,
          lastUploadDate: uploads.lastUploadByMonthSite.get(monthSiteKey) ?? "",
          status,
        };
      })
    )
    .sort((a, b) => {
      const statusOrder = { MISSING: 0, LOW: 1, OK: 2 };
      return (
        b.month.localeCompare(a.month) ||
        statusOrder[a.status] - statusOrder[b.status] ||
        a.clientName.localeCompare(b.clientName) ||
        a.subCompany.localeCompare(b.subCompany) ||
        a.address.localeCompare(b.address)
      );
    });

  const missed = summary.filter((row) => row.status === "LOW" || row.status === "MISSING");
  await replaceTab(sheets, spreadsheetId, SUMMARY_TAB, [SUMMARY_HEADERS, ...summary.map(rowToValues)]);
  await replaceTab(sheets, spreadsheetId, MISSED_TAB, [SUMMARY_HEADERS, ...missed.map(rowToValues)]);

  return { month: monthParam || "", months, summary, missed };
}

export async function setMonthlyExpectedServices(params: {
  month: string;
  expectedServices: number;
  siteId?: string;
  notes?: string;
}) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID");

  const month = params.month.trim();
  const siteId = (params.siteId || "all").trim() || "all";
  const expectedServices = Number(params.expectedServices);
  if (!month) throw new Error("Missing month.");
  if (!Number.isFinite(expectedServices) || expectedServices < 0) {
    throw new Error("Expected services must be zero or greater.");
  }

  const sheets = await getSheetsClient();
  await ensureSheet(sheets, spreadsheetId, EXPECTATIONS_TAB, EXPECTATIONS_HEADERS);

  const valuesResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${EXPECTATIONS_TAB}!A:D`,
  });
  const values = valuesResp.data.values ?? [];
  const [maybeHeaders = [], ...remainingRows] = values;
  const headers = hasHeader(maybeHeaders, ["month", "expectedServices"])
    ? maybeHeaders
    : EXPECTATIONS_HEADERS;
  const rows = hasHeader(maybeHeaders, ["month", "expectedServices"]) ? remainingRows : values;
  const monthIdx = headerIndex(headers, ["month"], 0);
  const siteIdx = headerIndex(headers, ["siteId"], 1);
  const rowOffset = hasHeader(maybeHeaders, ["month", "expectedServices"]) ? 2 : 1;
  const normalizedSiteId = siteId.toLowerCase();
  const rowIndex = rows.findIndex(
    (row) => cell(row, monthIdx) === month && cell(row, siteIdx).toLowerCase() === normalizedSiteId
  );
  const rowValues = [month, siteId, expectedServices, params.notes ?? ""];

  if (rowIndex >= 0) {
    const sheetRowNumber = rowIndex + rowOffset;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${EXPECTATIONS_TAB}!A${sheetRowNumber}:D${sheetRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rowValues] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${EXPECTATIONS_TAB}!A:D`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });
  }

  return refreshMonthlyServiceReport(month);
}

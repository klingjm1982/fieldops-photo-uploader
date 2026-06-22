import { sheets_v4 } from "googleapis";

export type SubCompanyOverride = {
  folderId: string;
  address: string;
  subCompany: string;
};

const DEFAULT_OVERRIDE_TAB = "Site List W/WO's";

export function workOrderSiteListTab() {
  return DEFAULT_OVERRIDE_TAB;
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

export function firstHeaderIndex(headers: unknown[], groups: string[][], fallback: number) {
  for (const names of groups) {
    const index = headerIndex(headers, names, -1);
    if (index >= 0) return index;
  }
  return fallback;
}

export function isValidWorkOrderValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return Boolean(
    normalized &&
      !["#n/a", "#ref!", "#value!", "n/a", "na", "none", "-"].includes(normalized)
  );
}

export function monthNameFromMonth(month: string) {
  const monthNumber = Number(month.slice(5, 7));
  const names = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return names[monthNumber] ?? "";
}

export function workOrderColumnIndex(headers: unknown[], month: string) {
  const monthName = monthNameFromMonth(month);
  if (!monthName) return -1;

  const normalizedMonth = normalizeHeader(monthName);
  const normalizedHeaders = headers.map(normalizeHeader);

  return normalizedHeaders.findIndex(
    (header) =>
      header.includes(normalizedMonth) &&
      (header.includes("workorders") || header.includes("wo"))
  );
}

export function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function quoteSheetTitle(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

export function normalizeAddress(value: string) {
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

export async function readSubCompanyOverrides(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
) {
  const tab = workOrderSiteListTab();

  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteSheetTitle(tab)}!A:Z`,
    });
    return parseSubCompanyOverrides(resp.data.values ?? []);
  } catch (error) {
    console.warn(`Could not read ${tab} for subcontractor overrides.`, error);
    return [];
  }
}

export function parseSubCompanyOverrides(rows: unknown[][]): SubCompanyOverride[] {
  const [maybeHeaders = [], ...remainingRows] = rows;
  const headers = hasHeader(maybeHeaders, ["Subcontractor company", "folderId", "address"])
    ? maybeHeaders
    : [];
  const body = headers.length > 0 ? remainingRows : rows;
  const addressIdx = firstHeaderIndex(
    headers,
    [
      ["fullAddress", "full address"],
      ["address", "displayName", "siteAddress", "address1", "address 1"],
    ],
    0
  );
  const folderIdx = headerIndex(headers, ["folderId", "addressFolderId", "driveFolderId", "siteId"], 1);
  const subCompanyIdx = headerIndex(
    headers,
    ["Subcontractor company", "subcontractorCompany", "subCompany", "subCompanyName"],
    10
  );

  return body
    .map((row) => ({
      folderId: cell(row, folderIdx),
      address: cell(row, addressIdx),
      subCompany: cell(row, subCompanyIdx),
    }))
    .filter((row) => row.subCompany && (row.folderId || row.address));
}

export function subCompanyForSite(
  overrides: SubCompanyOverride[],
  site: { folderId?: string; siteId?: string; address?: string },
  fallback: string
) {
  const folderId = String(site.folderId || site.siteId || "").trim();
  const address = normalizeAddress(String(site.address || ""));

  const byFolder = folderId
    ? overrides.find((override) => override.folderId && override.folderId === folderId)
    : null;
  if (byFolder?.subCompany) return byFolder.subCompany;

  const byAddress = address
    ? overrides.find((override) => override.address && normalizeAddress(override.address) === address)
    : null;
  if (byAddress?.subCompany) return byAddress.subCompany;

  return fallback;
}

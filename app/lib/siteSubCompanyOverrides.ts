import { sheets_v4 } from "googleapis";

export type SubCompanyOverride = {
  folderId: string;
  address: string;
  subCompany: string;
};

const DEFAULT_OVERRIDE_TAB = "Site List W/WO's";

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

function quoteSheetTitle(title: string) {
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
  const tab = process.env.GOOGLE_SITE_WORK_ORDERS_TAB || DEFAULT_OVERRIDE_TAB;

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
  const addressIdx = headerIndex(headers, ["address", "displayName", "siteAddress"], 0);
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

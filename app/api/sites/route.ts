import { NextResponse } from "next/server";
import { google } from "googleapis";
import { readServiceAccount } from "@/app/lib/googleServiceAccount";
import {
  firstHeaderIndex,
  readSubCompanyOverrides,
  subCompanyForSite,
  quoteSheetTitle,
  workOrderSiteListTab,
} from "@/app/lib/siteSubCompanyOverrides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Site = {
  siteId: string;
  displayName: string;
  address?: string;
  folderId?: string;

  // Optional extras (your UI can ignore these)
  active?: boolean;
  market?: string;
  clientName?: string;
  subCompany?: string;
  servicesPerMonth?: number;
};

async function getSheetsClient() {
  const { clientEmail, privateKey } = readServiceAccount();

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const tab = workOrderSiteListTab();

    if (!sheetId) {
      return NextResponse.json({ error: "Missing GOOGLE_SHEET_ID" }, { status: 500 });
    }

    const sheets = await getSheetsClient();

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${quoteSheetTitle(tab)}!A:Z`,
    });
    const subCompanyOverrides = await readSubCompanyOverrides(sheets, sheetId);

    const rows = resp.data.values ?? [];
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
    const marketIdx = headerIndex(headers, ["market"], 3);
    const clientIdx = headerIndex(headers, ["clientName", "client"], -1);
    const subCompanyIdx = headerIndex(
      headers,
      ["Subcontractor company", "subcontractorCompany", "subCompany", "subCompanyName"],
      10
    );
    const servicesIdx = headerIndex(headers, ["servicesPerMonth", "expectedServices"], -1);

    const sites: Site[] = body
      .filter((r) => Array.isArray(r) && r.length > 0)
      .map((r, i) => {
        const address = cell(r, addressIdx);
        const folderId = cell(r, folderIdx);
        const active = parseActive(cell(r, activeIdx));
        const market = cell(r, marketIdx);
        const siteId = cell(r, siteIdIdx) || folderId || `site-${i + 1}`;

        const baseSubCompany = cell(r, subCompanyIdx);

        return {
          siteId,
          displayName: address,
          address,
          folderId,
          active,
          market,
          clientName: cell(r, clientIdx) || "Driven Brands",
          subCompany: subCompanyForSite(
            subCompanyOverrides,
            { folderId, siteId, address },
            baseSubCompany
          ),
          servicesPerMonth: Number(cell(r, servicesIdx)) || 0,
        };
      })
      .filter((s) => s.displayName && s.folderId)
      .filter((s) => !isSiteHeaderRow(s.siteId, s.displayName))
      .filter((s) => s.active !== false);

    return NextResponse.json(sites);
  } catch (e: unknown) {
    console.error("Sheets API error:", e);
    return NextResponse.json(
      { error: "Sheets API error", message: errorMessage(e) },
      { status: 500 }
    );
  }
}

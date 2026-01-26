import { NextResponse } from "next/server";
import { google } from "googleapis";

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
};

function readServiceAccount() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error("Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY");
  }

  // Vercel often stores multiline keys with \n
  privateKey = privateKey.replace(/\\n/g, "\n");

  return { clientEmail, privateKey };
}

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

export async function GET() {
  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const tab = process.env.GOOGLE_SHEET_TAB || "Sheet1";

    if (!sheetId) {
      return NextResponse.json({ error: "Missing GOOGLE_SHEET_ID" }, { status: 500 });
    }

    const sheets = await getSheetsClient();

    // A: Address, B: FolderId, C: Active (Y/N), D: Market
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tab}!A2:D`,
    });

    const rows = resp.data.values ?? [];

    const sites: Site[] = rows
      .filter((r) => Array.isArray(r) && r.length > 0)
      .map((r, i) => {
        const address = String(r[0] ?? "").trim();
        const folderId = String(r[1] ?? "").trim();
        const activeFlag = String(r[2] ?? "").trim().toUpperCase(); // Y / N / blank
        const market = String(r[3] ?? "").trim();

        const active = activeFlag ? activeFlag === "Y" : true;

        return {
          siteId: folderId || `site-${i + 1}`, // prefer folderId as the key
          displayName: address,
          address,
          folderId,
          active,
          market,
        };
      })
      .filter((s) => s.displayName && s.folderId)
      .filter((s) => s.active !== false);

    return NextResponse.json(sites);
  } catch (e: any) {
    console.error("Sheets API error:", e);
    return NextResponse.json(
      { error: "Sheets API error", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}


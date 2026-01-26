import { NextResponse } from "next/server";
import { google } from "googleapis";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Site = {
  siteId: string;
  displayName: string;
  address?: string;
  folderId?: string;
};


export async function GET() {
  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const tab = process.env.GOOGLE_SHEET_TAB || "Sheet1";

    if (!sheetId) {
      return NextResponse.json({ error: "Missing GOOGLE_SHEET_ID" }, { status: 500 });
    }

    const keyPath = path.join(process.cwd(), "credentials", "service-account.json");
    const keyJson = JSON.parse(fs.readFileSync(keyPath, "utf8"));

    const clientEmail = keyJson.client_email as string | undefined;
    const privateKey = keyJson.private_key as string | undefined;

    if (!clientEmail || !privateKey) {
      return NextResponse.json(
        { error: "service-account.json missing client_email/private_key" },
        { status: 500 }
      );
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    await auth.authorize();

    const sheets = google.sheets({ version: "v4", auth });

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tab}!A2:D`,
    });

    const rows = resp.data.values ?? [];

    const sites: Site[] = rows
      .filter((r) => Array.isArray(r) && r.length > 0)
      .map((r, i) => {
        const address = String(r[0] ?? "").trim();
        const folderId = String(r[1] ?? "").trim(); // <-- Drive folder ID
        const activeFlag = String(r[2] ?? "").trim().toUpperCase();
        const market = String(r[3] ?? "").trim();

        return {
  siteId: folderId || `site-${i + 1}`,  // <-- use Drive folderId as the key
  displayName: address,
  address,
  folderId,
  active: activeFlag ? activeFlag === "Y" : true,
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

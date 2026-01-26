import { NextResponse } from "next/server";
import { google } from "googleapis";
import { Readable } from "stream";
import sgMail from "@sendgrid/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- Email helper (SendGrid) ----------
async function sendUploadEmail(params: { to: string; from: string; subject: string; text: string }) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("Missing SENDGRID_API_KEY");
  sgMail.setApiKey(key);
  await sgMail.send({
    to: params.to,
    from: params.from,
    subject: params.subject,
    text: params.text,
  });
}

// ---------- ISO week helpers ----------
function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}
function weekFolderName(date: Date) {
  const { year, week } = getISOWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// ---------- Google clients ----------
function readServiceAccount() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error("Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY");
  }

  privateKey = privateKey
    .replace(/\\n/g, "\n")     // if stored with \n
    .replace(/\r\n/g, "\n")    // windows newlines
    .trim();

  // Safety: remove accidental surrounding quotes
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }

  return { clientEmail, privateKey };
}



async function getDriveClient() {
  const { clientEmail, privateKey } = readServiceAccount();
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  await auth.authorize();
  return google.drive({ version: "v3", auth });
}

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

// ---------- Drive helpers ----------
async function findOrCreateWeeklySubfolder(drive: any, parentFolderId: string, name: string) {
  const safeName = name.replace(/'/g, "\\'");
  const q =
    `mimeType='application/vnd.google-apps.folder' ` +
    `and name='${safeName}' ` +
    `and '${parentFolderId}' in parents ` +
    `and trashed=false`;

  const existing = await drive.files.list({
    q,
    fields: "files(id,name,webViewLink)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const found = existing.data.files?.[0];
  if (found?.id) return found.id as string;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  return created.data.id as string;
}

async function getWebViewLink(drive: any, fileId: string) {
  const meta = await drive.files.get({
    fileId,
    fields: "webViewLink",
    supportsAllDrives: true,
  });
  return String(meta.data.webViewLink || "");
}

// ---------- Sheets append helper ----------
async function appendUploadLogRow(params: {
  timestampISO: string;
  address: string;
  siteId: string;
  addressFolderId: string;
  weekFolderName: string;
  weekFolderId: string;
  driveFileIds: string[];
  driveLinks: string[];
  originalFilenames: string[];
  uploadedBy?: string;
  notes?: string;
}) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_UPLOADS_TAB || "UploadsLog";
  if (!sheetId) throw new Error("Missing GOOGLE_SHEET_ID");

  const sheets = await getSheetsClient();

  // One row summary. Store multiple links/ids as newline-separated text.
  const values = [[
    params.timestampISO,
    params.address,
    params.siteId,
    params.addressFolderId,
    params.weekFolderName,
    `${params.driveFileIds.length} file(s)`,                   // DriveFileId column becomes “count”
    params.driveLinks.join("\n"),                              // DriveLink column: list of links
    params.originalFilenames.join("\n"),                       // OriginalFilename column: list
    params.uploadedBy || "",
    params.notes || "",
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tab}!A:J`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

// ---------- API handler ----------
export async function POST(req: Request) {
  try {
    const form = await req.formData();

    // Accept multiple files: "files" (preferred) or fallback to single "file"
    const files = form.getAll("files").filter((x) => x instanceof File) as File[];
    const single = form.get("file");
    if (files.length === 0 && single instanceof File) files.push(single);

    const folderId = String(form.get("folderId") ?? "");
    const siteId = String(form.get("siteId") ?? "");
    const displayName = String(form.get("displayName") ?? "");
    const uploadedBy = String(form.get("uploadedBy") ?? "");
    const notes = String(form.get("notes") ?? "");

    if (files.length === 0) {
      return NextResponse.json({ message: "Missing files" }, { status: 400 });
    }
    if (!folderId) {
      return NextResponse.json({ message: "Missing folderId (select a site)" }, { status: 400 });
    }

    const drive = await getDriveClient();

    const now = new Date();
    const weekName = weekFolderName(now);

    // One weekly folder operation per batch
    const weekFolderId = await findOrCreateWeeklySubfolder(drive, folderId, weekName);
    const weekFolderLink = await getWebViewLink(drive, weekFolderId);

    // Upload all files
    const driveFileIds: string[] = [];
    const driveLinks: string[] = [];
    const originalFilenames: string[] = [];

    for (const f of files) {
      const bytes = await f.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const bodyStream = Readable.from(buffer);

      const original = f.name || "upload.jpg";
      const safeName = original.replace(/[^\w.\-]+/g, "_");
      const finalName = `${now.toISOString().replace(/[:.]/g, "-")}_${safeName}`;

      const created = await drive.files.create({
        requestBody: {
          name: finalName,
          parents: [weekFolderId],
        },
        media: {
          mimeType: f.type || "image/jpeg",
          body: bodyStream,
        },
        fields: "id,webViewLink",
        supportsAllDrives: true,
      });

      const id = String(created.data.id || "");
      const link = String(created.data.webViewLink || "");
      if (id) driveFileIds.push(id);
      driveLinks.push(link || "");
      originalFilenames.push(original);
    }

    // Sheet status
    let sheetLogged = false;
    let sheetError: string | null = null;

    try {
      await appendUploadLogRow({
        timestampISO: now.toISOString(),
        address: displayName,
        siteId,
        addressFolderId: folderId,
        weekFolderName: weekName,
        weekFolderId,
        driveFileIds,
        driveLinks,
        originalFilenames,
        uploadedBy,
        notes,
      });
      sheetLogged = true;
    } catch (err: any) {
      sheetError = err?.message ?? String(err);
      console.error("UploadsLog append failed:", err);
    }

    // Email status (one email per batch)
    let emailSent = false;
    let emailError: string | null = null;

    try {
      const to = process.env.NOTIFY_EMAIL_TO || "";
      const from = process.env.NOTIFY_EMAIL_FROM || "";
      if (!to || !from) throw new Error("Missing NOTIFY_EMAIL_TO or NOTIFY_EMAIL_FROM");

      const linkList = driveLinks.filter(Boolean).slice(0, 20).join("\n"); // keep email reasonable

      await sendUploadEmail({
        to,
        from,
        subject: `FIELD OPS Photo Upload (${driveFileIds.length}): ${displayName}`,
        text:
          `New photo batch uploaded\n\n` +
          `Address: ${displayName}\n` +
          `SiteId: ${siteId}\n` +
          `Week Folder: ${weekName}\n` +
          `Week Folder Link: ${weekFolderLink}\n` +
          `Files Uploaded: ${driveFileIds.length}\n` +
          (uploadedBy ? `Uploaded By: ${uploadedBy}\n` : "") +
          (notes ? `Notes: ${notes}\n` : "") +
          `\nFile Links (up to 20):\n${linkList}\n` +
          `\nTimestamp: ${now.toISOString()}\n`,
      });

      emailSent = true;
    } catch (err: any) {
      emailError = err?.message ?? String(err);
      console.error("Email send failed:", err);
    }

    return NextResponse.json({
      ok: true,
      count: driveFileIds.length,
      weekFolderName: weekName,
      weekFolderId,
      weekFolderLink,
      routedTo: {
        siteId,
        address: displayName,
        addressFolderId: folderId,
      },
      files: driveFileIds.map((id, i) => ({
        driveFileId: id,
        webViewLink: driveLinks[i] || "",
        originalFilename: originalFilenames[i] || "",
      })),
      sheet: { logged: sheetLogged, error: sheetError },
      email: { sent: emailSent, error: emailError },
    });
  } catch (e: any) {
    console.error("Upload error:", e);
    return NextResponse.json({ message: e?.message ?? "Upload failed" }, { status: 500 });
  }
}

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const queueTab = "CorrigoUploadQueue";
const defaultStatus = "Pending Corrigo Upload";

loadDotEnvLocal();

function loadDotEnvLocal() {
  const envPath = path.join(rootDir, ".env.local");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex < 1) continue;

    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n");
    if (!process.env[key]) process.env[key] = value;
  }
}

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function cleanPrivateKey(value) {
  return String(value ?? "")
    .trim()
    .replace(/^['"]|['"],?$/g, "")
    .replace(/,\s*$/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

function isValidPrivateKey(privateKey) {
  try {
    createPrivateKey(privateKey);
    return true;
  } catch {
    return false;
  }
}

function readServiceAccount() {
  const envEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const envPrivateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (envEmail && envPrivateKey) {
    const privateKey = cleanPrivateKey(envPrivateKey);
    if (isValidPrivateKey(privateKey)) {
      return { clientEmail: envEmail, privateKey };
    }
  }

  const credentialPath = path.join(rootDir, "credentials", "service-account.json");
  if (!existsSync(credentialPath)) {
    throw new Error("Missing Google service account credentials.");
  }

  const json = JSON.parse(readFileSync(credentialPath, "utf8"));
  if (!json.client_email || !json.private_key) {
    throw new Error("Invalid service account JSON.");
  }

  const privateKey = cleanPrivateKey(json.private_key);
  if (!isValidPrivateKey(privateKey)) {
    throw new Error("Invalid service account private key.");
  }

  return { clientEmail: json.client_email, privateKey };
}

async function getGoogleClients() {
  const { clientEmail, privateKey } = readServiceAccount();
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
  });
  await auth.authorize();
  return {
    drive: google.drive({ version: "v3", auth }),
    sheets: google.sheets({ version: "v4", auth }),
  };
}

function spreadsheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEET_ID.");
  return id;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function headerIndex(headers, names, fallback) {
  const normalized = headers.map(normalizeHeader);
  const wanted = names.map(normalizeHeader);
  const index = normalized.findIndex((header) => wanted.includes(header));
  return index >= 0 ? index : fallback;
}

function cell(row, index) {
  if (index < 0) return "";
  return String(row[index] ?? "").trim();
}

function splitLines(value) {
  return String(value ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseDriveFileId(link) {
  const filePathMatch = link.match(/\/file\/d\/([^/]+)/);
  if (filePathMatch) return filePathMatch[1];

  const idMatch = link.match(/[?&]id=([^&]+)/);
  if (idMatch) return idMatch[1];

  return "";
}

function safePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function cleanPreparedImageFiles(outputDir) {
  if (!existsSync(outputDir)) return;
  for (const name of readdirSync(outputDir)) {
    if (/\.(jpe?g|png|heic|webp)$/i.test(name)) {
      unlinkSync(path.join(outputDir, name));
    }
  }
}

function parseQueue(rows) {
  const [headers = [], ...body] = rows;
  const queueIdIdx = headerIndex(headers, ["queueId"], 0);
  const monthIdx = headerIndex(headers, ["month"], 1);
  const siteIdIdx = headerIndex(headers, ["siteId"], 2);
  const addressIdx = headerIndex(headers, ["address"], 3);
  const serviceDateIdx = headerIndex(headers, ["serviceDate"], 4);
  const workOrderIdx = headerIndex(headers, ["workOrderNumber"], 5);
  const photoCountIdx = headerIndex(headers, ["photoCount"], 7);
  const driveLinksIdx = headerIndex(headers, ["driveLinks"], 8);
  const filenamesIdx = headerIndex(headers, ["originalFilenames"], 9);
  const statusIdx = headerIndex(headers, ["status"], 10);

  return body
    .map((row) => ({
      queueId: cell(row, queueIdIdx),
      month: cell(row, monthIdx),
      siteId: cell(row, siteIdIdx),
      address: cell(row, addressIdx),
      serviceDate: cell(row, serviceDateIdx),
      workOrderNumber: cell(row, workOrderIdx),
      photoCount: Number(cell(row, photoCountIdx)) || 0,
      driveLinks: splitLines(cell(row, driveLinksIdx)),
      originalFilenames: splitLines(cell(row, filenamesIdx)),
      status: cell(row, statusIdx) || defaultStatus,
    }))
    .filter((row) => row.queueId);
}

async function downloadFile(drive, fileId, outputPath) {
  const response = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  writeFileSync(outputPath, Buffer.from(response.data));
}

async function main() {
  const month = argValue("month");
  const queueId = argValue("queue-id");
  const workOrder = argValue("work-order");
  const serviceDate = argValue("service-date");
  const status = argValue("status") || defaultStatus;
  const outputBase = path.join(rootDir, "corrigo-test-downloads");

  const { drive, sheets } = await getGoogleClients();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${queueTab}!A:P`,
  });

  const queue = parseQueue(response.data.values ?? []);
  const candidates = queue
    .filter((row) => row.status === status)
    .filter((row) => (month ? row.month === month : true))
    .filter((row) => (queueId ? row.queueId === queueId : true))
    .filter((row) => (workOrder ? row.workOrderNumber === workOrder : true))
    .filter((row) => (serviceDate ? row.serviceDate === serviceDate : true))
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));

  if (candidates.length === 0) {
    console.log(`No Corrigo upload rows with status "${status}" matched the requested filters.`);
    process.exitCode = 1;
    return;
  }

  const row = candidates[0];
  const outputDir = path.join(
    outputBase,
    `${safePathPart(row.serviceDate)}_${safePathPart(row.workOrderNumber)}`
  );
  mkdirSync(outputDir, { recursive: true });
  cleanPreparedImageFiles(outputDir);

  const downloaded = [];
  for (const [index, link] of row.driveLinks.entries()) {
    const fileId = parseDriveFileId(link);
    if (!fileId) continue;

    const originalName = row.originalFilenames[index] || `photo-${index + 1}.jpg`;
    const outputPath = path.join(
      outputDir,
      `${row.serviceDate}_${safePathPart(row.workOrderNumber)}_${String(index + 1).padStart(2, "0")}_${safePathPart(originalName)}`
    );
    await downloadFile(drive, fileId, outputPath);
    downloaded.push(outputPath);
  }

  console.log("Prepared Corrigo upload test files.");
  console.log(`Queue ID: ${row.queueId}`);
  console.log(`Work order: ${row.workOrderNumber}`);
  console.log(`Service date: ${row.serviceDate}`);
  console.log(`Address: ${row.address}`);
  console.log(`Photos downloaded: ${downloaded.length}`);
  console.log(`Queue status: ${row.status}`);
  console.log(`Folder: ${outputDir}`);
  for (const filePath of downloaded) console.log(`- ${filePath}`);
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});

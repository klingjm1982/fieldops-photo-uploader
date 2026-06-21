import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const execFileAsync = promisify(execFile);

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function safePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function findPreparedFiles(serviceDate, workOrder) {
  const preparedDir = path.join(
    rootDir,
    "corrigo-test-downloads",
    `${safePathPart(serviceDate)}_${safePathPart(workOrder)}`
  );

  if (!existsSync(preparedDir)) {
    throw new Error(`Prepared photo folder was not found: ${preparedDir}`);
  }

  const files = readdirSync(preparedDir)
    .filter((name) => /\.(jpe?g|png|heic|webp)$/i.test(name))
    .filter((name) => name.includes(serviceDate))
    .sort()
    .map((name) => path.join(preparedDir, name));

  if (files.length === 0) {
    throw new Error(`No date-stamped prepared photo files for ${serviceDate} were found in: ${preparedDir}`);
  }

  return { preparedDir, files };
}

async function waitForUser(message) {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(`${message}\nPress Enter when ready... `);
  } finally {
    rl.close();
  }
}

async function askUser(message) {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}

async function maybeClick(locator, description) {
  const count = await locator.count();
  if (count !== 1) return false;
  await locator.click();
  console.log(`Clicked ${description}.`);
  return true;
}

async function isWorkOrderPopupOpen(page, workOrder) {
  const popupWorkOrder = page.getByText(`WO# ${workOrder}`, { exact: false });
  return (await popupWorkOrder.count()) > 0 && (await page.getByPlaceholder("Type your message or drag and drop files").count()) === 1;
}

async function attachPhotos(page, files) {
  const fileInputs = page.locator('input[type="file"]');
  const fileInputCount = await fileInputs.count();

  if (fileInputCount > 0) {
    await fileInputs.last().setInputFiles(files);
    console.log(`Attached ${files.length} photo file(s) using Corrigo's file input.`);
    return;
  }

  const dropTarget = page.getByPlaceholder("Type your message or drag and drop files");
  const dropTargetCount = await dropTarget.count();
  if (dropTargetCount === 1) {
    await dropTarget.scrollIntoViewIfNeeded();
    const payload = files.map((filePath) => ({
      name: path.basename(filePath),
      mimeType: "image/jpeg",
      base64: readFileSync(filePath).toString("base64"),
    }));

    const dataTransfer = await page.evaluateHandle((items) => {
      const transfer = new DataTransfer();
      for (const item of items) {
        const binary = atob(item.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        transfer.items.add(new File([bytes], item.name, { type: item.mimeType }));
      }
      return transfer;
    }, payload);

    await dropTarget.dispatchEvent("dragenter", { dataTransfer });
    await dropTarget.dispatchEvent("dragover", { dataTransfer });
    await dropTarget.dispatchEvent("drop", { dataTransfer });
    await dataTransfer.dispose();
    console.log(`Dropped ${files.length} photo file(s) onto Corrigo's message/drop field.`);
    return;
  }

  const screenshotPath = path.join(rootDir, "corrigo-test-downloads", "corrigo-file-input-not-found.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  throw new Error(`Could not find a Corrigo file input or drop field. Screenshot saved: ${screenshotPath}`);
}

async function guidedFinderUpload(page, preparedDir, workOrder) {
  console.log("Automatic browser upload did not confirm. Opening the prepared photo folder for real Finder drag/drop.");
  await execFileAsync("open", [preparedDir]);
  await waitForUser(
    "Drag the prepared photos from Finder into Corrigo's message/drop field, then wait for the photo bubbles to appear."
  );

  const screenshotPath = path.join(rootDir, "corrigo-test-downloads", `corrigo-after-manual-drag-${workOrder}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Manual drag review screenshot saved: ${screenshotPath}`);
}

async function processUploadGroup(page, group, workOrder) {
  const confirmation = await askUser(
    `About to attach ${group.files.length} photo file(s) for ${group.serviceDate} to Corrigo work order ${workOrder}. Type UPLOAD to continue: `
  );
  if (confirmation !== "UPLOAD") {
    console.log(`Upload cancelled for ${group.serviceDate}. No photos were attached for this date.`);
    return;
  }

  try {
    await attachPhotos(page, group.files);
    await page.waitForTimeout(5000);
  } catch (error) {
    console.log(error?.message ?? error);
    await guidedFinderUpload(page, group.preparedDir, `${workOrder}-${group.serviceDate}`);
  }

  const screenshotPath = path.join(rootDir, "corrigo-test-downloads", `corrigo-after-upload-${workOrder}-${group.serviceDate}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Upload attempt complete for ${group.serviceDate}. Screenshot saved: ${screenshotPath}`);
  console.log("Confirm the photo bubbles appear in Corrigo. The script has not changed the Google Sheet status.");
  await waitForUser(`Press Enter after you finish reviewing Corrigo for ${group.serviceDate}.`);
}

async function main() {
  const workOrder = argValue("work-order");
  const serviceDateArg = argValue("service-date") || argValue("service-dates");
  const serviceDates = serviceDateArg
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const corrigoUrl = argValue("url") || process.env.CORRIGO_URL || "https://www.corrigopro.com";
  const channel = argValue("channel") || process.env.CORRIGO_BROWSER_CHANNEL || "";
  const upload = process.argv.includes("--upload");

  if (!workOrder || serviceDates.length === 0) {
    throw new Error("Usage: npm run corrigo:test-browser -- --work-order=303520204 --service-date=2026-06-16 --url=https://...");
  }

  if (corrigoUrl === "YOUR_CORRIGOPRO_URL") {
    throw new Error("Replace YOUR_CORRIGOPRO_URL with the real CorrigoPro login/home URL.");
  }

  const uploadGroups = serviceDates.map((serviceDate) => ({
    serviceDate,
    ...findPreparedFiles(serviceDate, workOrder),
  }));
  const userDataDir = path.join(rootDir, "corrigo-browser-profile");

  console.log("Starting Corrigo browser test.");
  console.log(`Corrigo URL: ${corrigoUrl}`);
  console.log(`Work order: ${workOrder}`);
  console.log(`Service dates: ${serviceDates.join(", ")}`);
  for (const group of uploadGroups) {
    console.log(`Prepared folder (${group.serviceDate}): ${group.preparedDir}`);
    console.log(`Prepared files (${group.serviceDate}): ${group.files.length}`);
    for (const file of group.files) console.log(`- ${file}`);
  }

  const launchOptions = {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  };
  if (channel) launchOptions.channel = channel;

  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(corrigoUrl, { waitUntil: "domcontentloaded" });

  console.log("If Corrigo asks you to log in, complete login in the opened browser.");
  await waitForUser("Continue after CorrigoPro home/search is visible.");

  const searchInput = page.getByPlaceholder("Search work order");
  try {
    await searchInput.waitFor({ state: "visible", timeout: 15000 });
  } catch {
    await page.screenshot({ path: path.join(rootDir, "corrigo-test-downloads", "corrigo-search-not-found.png"), fullPage: true });
    throw new Error("Could not find the Corrigo 'Search work order' field. A screenshot was saved in corrigo-test-downloads.");
  }

  await searchInput.fill(workOrder);
  await searchInput.press("Enter");
  console.log(`Searched work order ${workOrder}.`);

  await page.waitForTimeout(2500);
  if (await isWorkOrderPopupOpen(page, workOrder)) {
    console.log("Work order popup is already open.");
  } else {
    const clicked = await maybeClick(page.getByText(`WO# ${workOrder}`, { exact: false }), "matching work order label");
    if (!clicked) {
      console.log("Could not find a unique search result to click. Please open the correct work order manually.");
      await waitForUser("Continue after the correct work order popup is open.");
    }
  }

  console.log("Confirm the correct work order popup is open in CorrigoPro.");

  if (!upload) {
    console.log("Stopped before uploading files.");
    console.log("No photos were uploaded. Rerun with --upload only after the stop-before-upload test looks correct.");
    await waitForUser("Leave the browser open for review, then press Enter here to end the test.");
    await context.close();
    return;
  }

  for (const group of uploadGroups) {
    await processUploadGroup(page, group, workOrder);
  }

  await context.close();
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const localApi = "http://localhost:3000/api/corrigo-sync";
const searchPositionPath = path.join(process.cwd(), "corrigo-search-position.json");
const closePositionPath = path.join(process.cwd(), "corrigo-close-position.json");

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

async function ask(message) {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}

async function runInherited(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

async function run(command, args) {
  const result = await execFileAsync(command, args);
  return result.stdout.trim();
}

async function mousePosition() {
  const stdout = await run("cliclick", ["p:."]);
  const match = stdout.match(/(\d+),(\d+)/);
  if (!match) throw new Error(`Could not read mouse position from: ${stdout}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

function readSearchPosition() {
  return readPosition(searchPositionPath);
}

function readClosePosition() {
  return readPosition(closePositionPath);
}

function requireSavedPosition(position, label, filePath) {
  if (!position) {
    throw new Error(`Missing saved ${label} position. Run the recalibrate command first to create ${filePath}.`);
  }
  return position;
}

function readPosition(filePath) {
  if (!existsSync(filePath)) return null;
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!parsed?.x || !parsed?.y) return null;
  return parsed;
}

function saveSearchPosition(position) {
  savePosition(searchPositionPath, position);
}

function saveClosePosition(position) {
  savePosition(closePositionPath, position);
}

function savePosition(filePath, position) {
  writeFileSync(filePath, JSON.stringify({ ...position, savedAt: new Date().toISOString() }, null, 2));
}

async function capturePosition(label, saveFn) {
  await ask(`Press Enter, then move your mouse over ${label}. I will capture it in 5 seconds.`);
  for (const seconds of [5, 4, 3, 2, 1]) {
    console.log(`${seconds}...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const position = await mousePosition();
  saveFn(position);
  console.log(`Saved position for ${label}: ${position.x},${position.y}`);
  return position;
}

async function captureSearchPosition() {
  return capturePosition("Corrigo's work order search box", saveSearchPosition);
}

async function captureClosePosition() {
  return capturePosition("the X close button on the Corrigo work order popup", saveClosePosition);
}

async function closeCorrigoPopup(closePosition) {
  console.log("Closing the current Corrigo work order popup.");
  await run("cliclick", [`c:${closePosition.x},${closePosition.y}`]);
  await new Promise((resolve) => setTimeout(resolve, 1200));
}

async function osSearchCorrigoWorkOrder(workOrder, searchPosition) {
  console.log(`Searching Corrigo work order ${workOrder} using saved search position.`);
  await run("cliclick", [`c:${searchPosition.x},${searchPosition.y}`]);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await run("osascript", [
    "-e",
    `tell application "System Events"
      keystroke "a" using command down
      keystroke "${String(workOrder).replaceAll('"', '\\"')}"
      key code 36
    end tell`,
  ]);
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

async function apiGet(month) {
  const url = `${localApi}?month=${encodeURIComponent(month)}`;
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? `GET ${url} failed with ${res.status}`);
  return json;
}

async function updateStatus(queueId, status) {
  const res = await fetch(localApi, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "updateQueueStatus", queueId, status }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? `Status update failed with ${res.status}`);
}

async function findSearchInput(page) {
  const searchInput = page.getByPlaceholder("Search work order");
  await searchInput.waitFor({ state: "visible", timeout: 15000 });
  return searchInput;
}

async function searchCorrigoWorkOrder(page, workOrder) {
  await page.bringToFront();

  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  } catch {
    // Corrigo sometimes ignores Escape; the global search can still usually be reused.
  }

  const searchInput = await findSearchInput(page);
  await searchInput.fill("");
  await searchInput.fill(workOrder);
  await searchInput.press("Enter");
  console.log(`Searched work order ${workOrder}.`);
  await page.waitForTimeout(2500);
  console.log("Confirm the correct Corrigo work order popup is open.");
}

async function openCorrigo(corrigoUrl) {
  const context = await chromium.launchPersistentContext("corrigo-browser-profile", {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });

  let page = context.pages().find((candidate) => candidate.url().includes("am-desktop.corrigopro.com"));
  if (page) {
    console.log(`Reusing existing Corrigo tab: ${page.url()}`);
  } else {
    page = await context.newPage();
  }
  await page.bringToFront();
  const targetUrl = corrigoUrl.endsWith("/") ? corrigoUrl : `${corrigoUrl}/`;
  if (!page.url().includes("am-desktop.corrigopro.com")) {
    console.log(`Opening Corrigo: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
  }
  if (page.url() === "about:blank") {
    console.log("First Corrigo navigation stayed on about:blank. Retrying...");
    await page.evaluate((url) => {
      window.location.href = url;
    }, targetUrl);
    await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
    await page.waitForTimeout(1500);
  }
  console.log(`Browser landed on: ${page.url()}`);
  if (page.url() === "about:blank") {
    throw new Error("Corrigo page did not load. Open https://am-desktop.corrigopro.com manually, then rerun.");
  }
  await ask("Continue after CorrigoPro home/search is visible. Press Enter here.");

  return { context, page };
}

async function main() {
  const month = argValue("month") || "2026-06";
  const workOrder = argValue("work-order");
  const serviceDateArg = argValue("service-date") || argValue("service-dates");
  const corrigoUrl = argValue("url") || "https://am-desktop.corrigopro.com";
  const limit = Number(argValue("limit") || "0");
  const maxPhotosPerDrag = Number(argValue("max-photos-per-drag") || "10");
  const closeFinderDelayMs = Number(argValue("close-finder-delay-ms") || "5000");
  const uploadSettleMs = Number(argValue("upload-settle-ms") || "4000");
  const manualCorrigo = process.argv.includes("--manual-corrigo");
  const osSearch = process.argv.includes("--os-search");
  const allPending = process.argv.includes("--all-pending");
  const useLastDrag = process.argv.includes("--use-last-drag");
  const recalibrateDrag = process.argv.includes("--recalibrate-drag");
  const finderSelectedStart = process.argv.includes("--finder-selected-start");
  const autoDrag = process.argv.includes("--auto-drag");
  const closeFinderAfterDrag = process.argv.includes("--close-finder-after-drag");
  const continuous = process.argv.includes("--continuous");
  const instant = process.argv.includes("--instant");

  if (!workOrder && !allPending) {
    throw new Error(
      "Usage: npm run corrigo:upload-queue -- --work-order=304050184 --service-date=2026-06-03,2026-06-11 OR --all-pending --limit=100"
    );
  }

  const requestedDates = new Set(
    serviceDateArg
      ? serviceDateArg.split(",").map((value) => value.trim()).filter(Boolean)
      : []
  );

  const state = await apiGet(month);
  let rows = state.queue
    .filter((row) => allPending || row.workOrderNumber === workOrder)
    .filter((row) => row.status === "Pending Corrigo Upload")
    .filter((row) => requestedDates.size === 0 || requestedDates.has(row.serviceDate))
    .sort((a, b) => {
      const dateCompare = a.serviceDate.localeCompare(b.serviceDate);
      if (dateCompare !== 0) return dateCompare;
      return a.workOrderNumber.localeCompare(b.workOrderNumber);
    });

  if (limit > 0) rows = rows.slice(0, limit);

  if (rows.length === 0) {
    console.log("No pending Corrigo queue rows matched that filter.");
    return;
  }

  console.log(`Found ${rows.length} pending row(s):`);
  for (const row of rows) {
    console.log(`- WO ${row.workOrderNumber}, ${row.serviceDate}: ${row.photoCount} photo(s), ${row.address}`);
  }

  const browser = manualCorrigo || osSearch ? null : await openCorrigo(corrigoUrl);
  const searchPosition = osSearch
    ? instant
      ? requireSavedPosition(readSearchPosition(), "Corrigo search", searchPositionPath)
      : readSearchPosition() ?? await captureSearchPosition()
    : null;
  const closePosition = osSearch
    ? instant
      ? requireSavedPosition(readClosePosition(), "Corrigo close", closePositionPath)
      : readClosePosition() ?? await captureClosePosition()
    : null;
  if (manualCorrigo) {
    console.log("Manual Corrigo mode enabled.");
    console.log("Open Corrigo yourself and search the correct work order before each drag step.");
    await ask("Continue after the correct Corrigo work order popup is open. Press Enter here.");
  } else if (osSearch) {
    console.log("OS search mode enabled.");
    console.log("Keep your real Corrigo Chrome window visible. The script will click the saved search box and type each work order.");
  }

  try {
    let lastWorkOrder = "";
    let dragPositionCaptured = instant || !recalibrateDrag;
    for (const [index, row] of rows.entries()) {
      console.log(`\nNext row: WO ${row.workOrderNumber}, ${row.serviceDate} (${row.photoCount} photo(s))`);

      if (manualCorrigo) {
        if (row.workOrderNumber !== lastWorkOrder) {
          await ask(`Search/open Corrigo work order ${row.workOrderNumber}, then press Enter here.`);
        }
      } else if (osSearch) {
        await osSearchCorrigoWorkOrder(row.workOrderNumber, searchPosition);
        if (!continuous) {
          await ask(`Continue after Corrigo work order ${row.workOrderNumber} is open. Press Enter here.`);
        }
      } else {
        await searchCorrigoWorkOrder(browser.page, row.workOrderNumber);
      }
      lastWorkOrder = row.workOrderNumber;

      console.log(`Preparing ${row.serviceDate}...`);
      await runInherited("npm", [
        "run",
        "corrigo:test-prepare",
        "--",
        `--month=${month}`,
        `--work-order=${row.workOrderNumber}`,
        `--service-date=${row.serviceDate}`,
      ]);

      const photoCount = Number(row.photoCount) || 0;
      const uploadLimit = maxPhotosPerDrag > 0 ? maxPhotosPerDrag : photoCount;
      if (photoCount > uploadLimit) {
        console.log(`Corrigo limit: uploading the first ${uploadLimit} of ${photoCount} photo(s) for this service.`);
      }
      console.log(`\nStarting OS drag for ${row.serviceDate}.`);
      const shouldUseSavedDrag = (useLastDrag || recalibrateDrag) && dragPositionCaptured;
      await runInherited("npm", [
        "run",
        "corrigo:os-drag",
        "--",
        `--work-order=${row.workOrderNumber}`,
        `--service-date=${row.serviceDate}`,
        `--chunk-size=${uploadLimit}`,
        "--chunk-index=0",
        ...(finderSelectedStart ? ["--finder-selected-start"] : []),
        ...(autoDrag ? ["--auto-drag"] : []),
        ...(closeFinderAfterDrag ? ["--close-finder-after-drag"] : []),
        ...(closeFinderAfterDrag ? [`--close-finder-delay-ms=${closeFinderDelayMs}`] : []),
        ...(shouldUseSavedDrag ? ["--use-last"] : []),
      ]);
      dragPositionCaptured = true;

      if (continuous) {
        console.log(`Waiting ${Math.round(uploadSettleMs / 1000)} second(s), then marking uploaded.`);
        await new Promise((resolve) => setTimeout(resolve, uploadSettleMs));
        await updateStatus(row.queueId, "Uploaded to Corrigo");
        console.log(`Marked ${row.serviceDate} Uploaded to Corrigo.`);
      } else {
        const confirmed = await ask(
          `Did Corrigo show the uploaded photo bubbles for ${row.serviceDate}? Type YES to mark Uploaded to Corrigo: `
        );
        if (confirmed.toUpperCase() === "YES") {
          await updateStatus(row.queueId, "Uploaded to Corrigo");
          console.log(`Marked ${row.serviceDate} Uploaded to Corrigo.`);
        } else {
          console.log(`Left ${row.serviceDate} pending.`);
        }
      }

      if (osSearch && index < rows.length - 1) {
        await closeCorrigoPopup(closePosition);
      }
    }
  } finally {
    if (browser?.context) {
      const close = await ask("Close the Corrigo browser window? Type YES to close: ");
      if (close.toUpperCase() === "YES") await browser.context.close();
    }
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});

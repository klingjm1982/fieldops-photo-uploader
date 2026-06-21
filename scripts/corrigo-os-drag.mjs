import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const positionPath = path.join(rootDir, "corrigo-drag-positions.json");

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function hasArg(name) {
  return process.argv.includes(`--${name}`);
}

function safePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

async function ask(message) {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
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

function readSavedPositions() {
  if (!existsSync(positionPath)) return null;
  const parsed = JSON.parse(readFileSync(positionPath, "utf8"));
  if (!parsed?.end?.x || !parsed?.end?.y) return null;
  return parsed;
}

function savePositions(start, end) {
  writeFileSync(positionPath, JSON.stringify({ start, end, savedAt: new Date().toISOString() }, null, 2));
}

async function countdownPosition(label) {
  await ask(`Press Enter, then move your mouse to ${label}. I will capture the position in 5 seconds.`);
  for (const seconds of [5, 4, 3, 2, 1]) {
    console.log(`${seconds}...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return mousePosition();
}

function preparedFiles(workOrder, serviceDate) {
  const preparedDir = path.join(
    rootDir,
    "corrigo-test-downloads",
    `${safePathPart(serviceDate)}_${safePathPart(workOrder)}`
  );

  if (!existsSync(preparedDir)) {
    throw new Error(`Prepared folder not found: ${preparedDir}`);
  }

  const files = readdirSync(preparedDir)
    .filter((name) => name.includes(serviceDate))
    .filter((name) => /\.(jpe?g|png|heic|webp)$/i.test(name))
    .sort();

  if (files.length === 0) {
    throw new Error(`No date-stamped files found in: ${preparedDir}`);
  }

  return { preparedDir, files };
}

async function selectFinderFiles(preparedDir, files) {
  const script = `
    set folderPath to POSIX file "${preparedDir.replaceAll('"', '\\"')}" as alias
    set fileNames to {${files.map((name) => `"${name.replaceAll('"', '\\"')}"`).join(", ")}}
    tell application "Finder"
      activate
      open folderPath
      delay 0.5
      set selectedItems to {}
      repeat with fileName in fileNames
        set end of selectedItems to item fileName of folder folderPath
      end repeat
      select selectedItems
    end tell
  `;
  await run("osascript", ["-e", script]);
}

async function closeFrontFinderWindow() {
  const script = `
    tell application "Finder"
      if (count of Finder windows) > 0 then
        close front window
      end if
    end tell
  `;
  await run("osascript", ["-e", script]);
}

async function finderSelectedStartPosition() {
  const script = `
    tell application "Finder"
      activate
      delay 0.2
    end tell
    tell application "System Events"
      tell process "Finder"
        set selectedItems to selected of front window
        if selectedItems is {} then error "No Finder files are selected."
        set itemPosition to position of item 1 of selectedItems
        set itemSize to size of item 1 of selectedItems
        return ((item 1 of itemPosition) + ((item 1 of itemSize) div 2)) & "," & ((item 2 of itemPosition) + ((item 2 of itemSize) div 2))
      end tell
    end tell
  `;
  const stdout = await run("osascript", ["-e", script]);
  const match = stdout.match(/(\d+),\s*(\d+)/);
  if (!match) throw new Error(`Could not read selected Finder file position from: ${stdout}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

async function selectedFinderStartPosition() {
  try {
    return await finderSelectedStartPosition();
  } catch (error) {
    console.log(`Finder did not report a selected file position: ${error?.message ?? error}`);
    console.log("Falling back to a one-time mouse capture for the selected files.");
    return countdownPosition("the selected files in Finder");
  }
}

async function main() {
  const workOrder = argValue("work-order");
  const serviceDate = argValue("service-date");
  const useLast = hasArg("use-last");
  const finderSelectedStart = hasArg("finder-selected-start");
  const autoDrag = hasArg("auto-drag");
  const closeFinderAfterDrag = hasArg("close-finder-after-drag");
  const closeFinderDelayMs = Number(argValue("close-finder-delay-ms") || "5000");
  const chunkSize = Number(argValue("chunk-size") || "0");
  const chunkIndex = Number(argValue("chunk-index") || "0");

  if (!workOrder || !serviceDate) {
    throw new Error("Usage: npm run corrigo:os-drag -- --work-order=309230038 --service-date=2026-06-03");
  }

  const { preparedDir, files: allFiles } = preparedFiles(workOrder, serviceDate);
  const startIndex = chunkSize > 0 ? chunkIndex * chunkSize : 0;
  const files = chunkSize > 0 ? allFiles.slice(startIndex, startIndex + chunkSize) : allFiles;
  if (files.length === 0) {
    throw new Error(`No files found for chunk ${chunkIndex + 1} of ${serviceDate}.`);
  }

  console.log(`Prepared folder: ${preparedDir}`);
  if (chunkSize > 0) {
    const chunkCount = Math.ceil(allFiles.length / chunkSize);
    console.log(`Chunk ${chunkIndex + 1} of ${chunkCount} (${files.length} of ${allFiles.length} file(s)).`);
  }
  console.log(`Files selected for ${serviceDate}:`);
  for (const file of files) console.log(`- ${file}`);

  await selectFinderFiles(preparedDir, files);

  console.log("\nFinder should now be open with the correct files selected.");
  console.log("Keep Corrigo visible beside Finder, like your video.");
  const saved = useLast ? readSavedPositions() : null;
  let start;
  let end;
  if (saved) {
    end = saved.end;
    console.log(`Using saved drop position: ${end.x},${end.y}`);
    if (finderSelectedStart) {
      start = await selectedFinderStartPosition();
      console.log(`Using selected Finder file position: ${start.x},${start.y}`);
    } else {
      start = saved.start;
      if (!start?.x || !start?.y) {
        start = await countdownPosition("one of the selected files in Finder");
      }
      console.log(`Using saved start position: ${start.x},${start.y}`);
    }
  } else {
    if (useLast) console.log("No saved drag positions found. Capturing new positions.");
    if (finderSelectedStart) {
      start = await selectedFinderStartPosition();
      console.log(`Using selected Finder file position: ${start.x},${start.y}`);
    } else {
      start = await countdownPosition("one of the selected files in Finder");
      console.log(`Start position: ${start.x},${start.y}`);
    }

    end = await countdownPosition("Corrigo's 'Type your message or drag and drop files' box");
    console.log(`Drop position: ${end.x},${end.y}`);
    savePositions(start, end);
    console.log("Saved these drag positions for future --use-last runs.");
  }

  if (autoDrag) {
    console.log(`Auto-dragging ${files.length} file(s) for ${serviceDate}.`);
  } else {
    const confirm = await ask(`Type DRAG to drag ${files.length} file(s) for ${serviceDate} into Corrigo: `);
    if (confirm.toUpperCase() !== "DRAG") {
      console.log("Cancelled. No drag was performed.");
      return;
    }
  }

  const mid1 = { x: Math.round(start.x + (end.x - start.x) * 0.25), y: Math.round(start.y + (end.y - start.y) * 0.25) };
  const mid2 = { x: Math.round(start.x + (end.x - start.x) * 0.5), y: Math.round(start.y + (end.y - start.y) * 0.5) };
  const mid3 = { x: Math.round(start.x + (end.x - start.x) * 0.75), y: Math.round(start.y + (end.y - start.y) * 0.75) };

  await run("cliclick", [
    "-e",
    "12",
    "-w",
    "100",
    "m:" + start.x + "," + start.y,
    "w:300",
    "dd:" + start.x + "," + start.y,
    "w:1000",
    "dm:" + mid1.x + "," + mid1.y,
    "w:300",
    "dm:" + mid2.x + "," + mid2.y,
    "w:300",
    "dm:" + mid3.x + "," + mid3.y,
    "w:300",
    "dm:" + end.x + "," + end.y,
    "w:900",
    "du:" + end.x + "," + end.y,
  ]);

  console.log("Drag completed. Check Corrigo for the photo bubbles before changing queue status.");
  if (closeFinderAfterDrag) {
    console.log(`Waiting ${Math.round(closeFinderDelayMs / 1000)} second(s) before closing Finder.`);
    await new Promise((resolve) => setTimeout(resolve, closeFinderDelayMs));
    await closeFrontFinderWindow();
    console.log("Closed the Finder upload window.");
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});

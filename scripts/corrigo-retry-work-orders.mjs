import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const localApi = process.env.CORRIGO_SYNC_API_URL || "http://127.0.0.1:3000/api/corrigo-sync";
const defaultProgressPath = path.join(process.cwd(), "corrigo-upload-progress.json");

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function apiGet(month) {
  const res = await fetch(`${localApi}?month=${encodeURIComponent(month)}`, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? `Queue load failed with ${res.status}`);
  return json;
}

async function updateStatus(queueId, status, lastError = "") {
  const res = await fetch(localApi, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "updateQueueStatus", queueId, status, lastError }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? `Status update failed with ${res.status}`);
}

function removeFromLocalProgress(queueIds, progressPath) {
  if (!existsSync(progressPath)) return 0;

  const progress = JSON.parse(readFileSync(progressPath, "utf8"));
  const retryIds = new Set(queueIds);
  const before = Array.isArray(progress.completedQueueIds) ? progress.completedQueueIds.length : 0;

  progress.completedQueueIds = (progress.completedQueueIds ?? []).filter((id) => !retryIds.has(String(id)));
  progress.failedQueueIds = (progress.failedQueueIds ?? []).filter((id) => !retryIds.has(String(id)));
  progress.events = [
    ...(Array.isArray(progress.events) ? progress.events : []).slice(-200),
    ...queueIds.map((queueId) => ({
      at: new Date().toISOString(),
      queueId,
      status: "retry-requested",
      message: "Reset to Pending Corrigo Upload for manual retry.",
    })),
  ];
  progress.updatedAt = new Date().toISOString();

  writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  return before - progress.completedQueueIds.length;
}

async function main() {
  const month = argValue("month") || currentMonth();
  const workOrders = argValue("work-orders")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const progressPath = argValue("progress") || defaultProgressPath;

  if (workOrders.length === 0) {
    throw new Error(
      "Usage: npm run corrigo:retry -- --month=2026-09 --work-orders=303980201,302090177,302020179"
    );
  }

  const wanted = new Set(workOrders);
  const state = await apiGet(month);
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const matches = queue.filter((row) => wanted.has(String(row.workOrderNumber ?? "").trim()));

  console.log(`Found ${matches.length} queue row(s) for ${workOrders.length} requested work order(s).`);
  const foundWorkOrders = new Set(matches.map((row) => String(row.workOrderNumber ?? "").trim()));

  for (const workOrder of workOrders) {
    if (!foundWorkOrders.has(workOrder)) {
      console.log(`WARNING: WO ${workOrder} was not found in the ${month} queue.`);
    }
  }

  for (const row of matches) {
    await updateStatus(row.queueId, "Pending Corrigo Upload", "Manual retry requested after incomplete Corrigo photo upload.");
    console.log(`Reset WO ${row.workOrderNumber}, ${row.serviceDate} -> Pending Corrigo Upload.`);
  }

  const removed = removeFromLocalProgress(matches.map((row) => String(row.queueId)), progressPath);
  console.log(`Removed ${removed} completed queue id(s) from ${progressPath}.`);
  console.log("Retry reset complete.");
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});

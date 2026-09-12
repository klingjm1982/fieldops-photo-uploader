import { isValidWorkOrderValue, workOrderColumnIndex } from "@/app/lib/siteSubCompanyOverrides";

export type SandboxUploadRow = {
  uploadTimestamp?: string;
  serviceDate?: string;
  siteId?: string;
  address?: string;
  driveLinks?: string;
  originalFilenames?: string;
  status?: string;
};

export type SandboxResolvedQueueRow = SandboxUploadRow & {
  month: string;
  workOrderNumber: string;
  ready: boolean;
  reason: string;
};

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function headerIndex(headers: unknown[], names: string[], fallback = -1) {
  const normalized = headers.map(normalizeHeader);
  const wanted = names.map(normalizeHeader);
  const index = normalized.findIndex((header) => wanted.includes(header));
  return index >= 0 ? index : fallback;
}

function cell(row: unknown[], index: number) {
  if (index < 0) return "";
  return String(row[index] ?? "").trim();
}

function monthFromServiceDate(value: string) {
  const match = value.trim().match(/^(20\d{2})-([01]\d)-([0-3]\d)$/);
  if (!match) return "";
  return `${match[1]}-${match[2]}`;
}

/**
 * Sandbox-only resolver.
 *
 * It does not call Google Sheets, write queue rows, launch Corrigo, or mutate
 * production data. It only resolves an Uploads row against an in-memory copy
 * of `Site List W/WO's` rows.
 */
export function resolveSandboxCorrigoWorkOrder(
  upload: SandboxUploadRow,
  siteRows: unknown[][]
): SandboxResolvedQueueRow {
  const serviceDate = String(upload.serviceDate ?? "").trim();
  const month = monthFromServiceDate(serviceDate);

  if (!month) {
    return {
      ...upload,
      month: "",
      workOrderNumber: "",
      ready: false,
      reason: "Missing or invalid serviceDate; expected YYYY-MM-DD.",
    };
  }

  const [headers = [], ...rows] = siteRows;
  const siteIdIdx = headerIndex(headers, ["siteId", "folderId", "addressFolderId", "driveFolderId"]);
  const addressIdx = headerIndex(headers, ["fullAddress", "full address", "address", "siteAddress", "displayName"]);
  const workOrderIdx = workOrderColumnIndex(headers, month);

  if (workOrderIdx < 0) {
    return {
      ...upload,
      month,
      workOrderNumber: "",
      ready: false,
      reason: `No work-order column found for ${month}.`,
    };
  }

  const requestedSiteId = String(upload.siteId ?? "").trim();
  const requestedAddress = normalizeHeader(upload.address ?? "");

  const siteRow = rows.find((row) => {
    const rowSiteId = cell(row, siteIdIdx);
    if (requestedSiteId && rowSiteId === requestedSiteId) return true;

    if (requestedAddress && addressIdx >= 0) {
      return normalizeHeader(cell(row, addressIdx)) === requestedAddress;
    }

    return false;
  });

  if (!siteRow) {
    return {
      ...upload,
      month,
      workOrderNumber: "",
      ready: false,
      reason: "Site was not found on Site List W/WO's.",
    };
  }

  const workOrderNumber = cell(siteRow, workOrderIdx);
  if (!isValidWorkOrderValue(workOrderNumber)) {
    return {
      ...upload,
      month,
      workOrderNumber: "",
      ready: false,
      reason: `Site matched, but ${month} work order is blank or invalid.`,
    };
  }

  return {
    ...upload,
    month,
    workOrderNumber,
    ready: true,
    reason: "Ready for sandbox Corrigo queue.",
  };
}

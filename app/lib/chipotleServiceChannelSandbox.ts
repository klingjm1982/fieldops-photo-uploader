import { isValidWorkOrderValue, workOrderColumnIndex } from "@/app/lib/siteSubCompanyOverrides";

export type ChipotleUploadCandidate = {
  uploadTimestamp?: string;
  serviceDate?: string;
  siteId?: string;
  address?: string;
  driveLinks?: string;
  originalFilenames?: string;
};

export type ChipotleResolvedUpload = ChipotleUploadCandidate & {
  clientName: string;
  month: string;
  workOrderNumber: string;
  route: "servicechannel" | "ignore";
  ready: boolean;
  reason: string;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function headerIndex(headers: unknown[], names: string[], fallback = -1) {
  const normalized = headers.map(normalize);
  const wanted = names.map(normalize);
  const index = normalized.findIndex((header) => wanted.includes(header));
  return index >= 0 ? index : fallback;
}

function cell(row: unknown[], index: number) {
  return index < 0 ? "" : String(row[index] ?? "").trim();
}

function monthFromServiceDate(value: string) {
  const match = value.trim().match(/^(20\d{2})-([01]\d)-([0-3]\d)$/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function isChipotle(clientName: string) {
  return normalize(clientName).includes("chipotle");
}

/**
 * Pure/read-only resolver for the Chipotle -> ServiceChannel sandbox.
 * It does not call ServiceChannel, Google APIs, or mutate any sheet.
 */
export function resolveChipotleServiceChannelUpload(
  upload: ChipotleUploadCandidate,
  siteRows: unknown[][]
): ChipotleResolvedUpload {
  const serviceDate = String(upload.serviceDate ?? "").trim();
  const month = monthFromServiceDate(serviceDate);
  const [headers = [], ...rows] = siteRows;

  if (!month) {
    return {
      ...upload,
      clientName: "",
      month: "",
      workOrderNumber: "",
      route: "ignore",
      ready: false,
      reason: "Missing or invalid serviceDate; expected YYYY-MM-DD.",
    };
  }

  const siteIdIdx = headerIndex(headers, ["siteId", "folderId", "addressFolderId", "driveFolderId"]);
  const addressIdx = headerIndex(headers, ["fullAddress", "full address", "address", "siteAddress", "displayName"]);
  const clientIdx = headerIndex(headers, ["clientName", "client", "customer", "brand"]);
  const workOrderIdx = workOrderColumnIndex(headers, month);

  const requestedSiteId = String(upload.siteId ?? "").trim();
  const requestedAddress = normalize(upload.address ?? "");
  const siteRow = rows.find((row) => {
    if (requestedSiteId && cell(row, siteIdIdx) === requestedSiteId) return true;
    return Boolean(requestedAddress && addressIdx >= 0 && normalize(cell(row, addressIdx)) === requestedAddress);
  });

  if (!siteRow) {
    return {
      ...upload,
      clientName: "",
      month,
      workOrderNumber: "",
      route: "ignore",
      ready: false,
      reason: "Site was not found on Site List W/WO's.",
    };
  }

  const clientName = cell(siteRow, clientIdx);
  if (!isChipotle(clientName)) {
    return {
      ...upload,
      clientName,
      month,
      workOrderNumber: "",
      route: "ignore",
      ready: false,
      reason: `Not a Chipotle site (${clientName || "client blank"}); ServiceChannel route skipped.`,
    };
  }

  if (workOrderIdx < 0) {
    return {
      ...upload,
      clientName,
      month,
      workOrderNumber: "",
      route: "servicechannel",
      ready: false,
      reason: `No work-order column found for ${month}.`,
    };
  }

  const workOrderNumber = cell(siteRow, workOrderIdx);
  if (!isValidWorkOrderValue(workOrderNumber)) {
    return {
      ...upload,
      clientName,
      month,
      workOrderNumber: "",
      route: "servicechannel",
      ready: false,
      reason: `Chipotle site matched, but ${month} work order is blank or invalid.`,
    };
  }

  return {
    ...upload,
    clientName,
    month,
    workOrderNumber,
    route: "servicechannel",
    ready: true,
    reason: "Ready for ServiceChannel sandbox validation.",
  };
}

export function serviceChannelIdempotencyKey(row: ChipotleResolvedUpload, filename: string) {
  return [row.siteId, row.serviceDate, row.workOrderNumber, filename]
    .map((part) => normalize(part))
    .join("__");
}

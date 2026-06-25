"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";

type MonthlyStatus = "OK" | "LOW" | "MISSING";

type MonthlyServiceRow = {
  month: string;
  siteId: string;
  workOrderNumber?: string;
  address: string;
  clientName: string;
  subCompany: string;
  subEmail?: string;
  expectedServices: number;
  completedServices: number;
  missingServices: number;
  subPrice?: number;
  invoiceAmount?: number;
  lastUploadDate: string;
  status: MonthlyStatus;
};

type ReportResponse = {
  month: string;
  months: string[];
  summary: MonthlyServiceRow[];
};

type ReminderProperty = {
  address: string;
  workOrderNumber: string;
  month: string;
  status: MonthlyStatus;
  expectedServices: number;
  completedServices: number;
  missingServices: number;
};

type ReminderGroup = {
  to: string;
  subCompany: string;
  month: string;
  properties: ReminderProperty[];
  totalExpectedServices: number;
  totalCompletedServices: number;
  totalMissingServices: number;
};

const US_STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);

const statusColors: Record<MonthlyStatus, { bg: string; text: string }> = {
  OK: { bg: "#dcfce7", text: "#166534" },
  LOW: { bg: "#fde68a", text: "#92400e" },
  MISSING: { bg: "#fee2e2", text: "#991b1b" },
};

const metricColors: Record<string, { bg: string; border: string; text: string }> = {
  "OK Properties": { bg: "#f0fdf4", border: "#86efac", text: "#166534" },
  "LOW Properties": { bg: "#fffbeb", border: "#fbbf24", text: "#92400e" },
  "MISSING Properties": { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b" },
  "Missing Services": { bg: "#fff7ed", border: "#fdba74", text: "#9a3412" },
};

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function stateFromAddress(address: string) {
  const matches = address.toUpperCase().matchAll(/,\s*([A-Z]{2})(?=\s*,|\s+\d{5}\b)/g);
  let state = "";
  for (const match of matches) {
    if (US_STATE_CODES.has(match[1])) state = match[1];
  }
  return state;
}

function csvValue(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function money(value: number) {
  return value.toFixed(2);
}

function rowKey(row: MonthlyServiceRow) {
  return [row.month, row.siteId, row.workOrderNumber || row.address].join("::");
}

function groupReminderRows(rows: MonthlyServiceRow[]) {
  const groups = new Map<string, ReminderGroup>();

  for (const row of rows) {
    const to = String(row.subEmail || "").trim();
    const address = String(row.address || "").trim();
    if (!to || !address) continue;

    const subCompany = row.subCompany || "Subcontractor";
    const key = [to.toLowerCase(), subCompany.toLowerCase()].join("::");
    const current =
      groups.get(key) ??
      {
        to,
        subCompany,
        month: row.month,
        properties: [],
        totalExpectedServices: 0,
        totalCompletedServices: 0,
        totalMissingServices: 0,
      };

    current.properties.push({
      address,
      workOrderNumber: row.workOrderNumber || "",
      month: row.month,
      status: row.status,
      expectedServices: Number(row.expectedServices) || 0,
      completedServices: Number(row.completedServices) || 0,
      missingServices: Number(row.missingServices) || 0,
    });
    current.totalExpectedServices += Number(row.expectedServices) || 0;
    current.totalCompletedServices += Number(row.completedServices) || 0;
    current.totalMissingServices += Number(row.missingServices) || 0;
    groups.set(key, current);
  }

  return Array.from(groups.values()).sort(
    (a, b) => a.subCompany.localeCompare(b.subCompany) || a.to.localeCompare(b.to)
  );
}

export default function MonthlyReportPage() {
  const [rows, setRows] = useState<MonthlyServiceRow[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState("");
  const [state, setState] = useState("");
  const [clientName, setClientName] = useState("");
  const [subCompany, setSubCompany] = useState("");
  const [status, setStatus] = useState("");
  const [workOrderSearch, setWorkOrderSearch] = useState("");
  const [serviceRate, setServiceRate] = useState("");
  const [expectedServicesOverride, setExpectedServicesOverride] = useState("");
  const [savingExpectedServices, setSavingExpectedServices] = useState(false);
  const [refreshingSheets, setRefreshingSheets] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedReminderKeys, setSelectedReminderKeys] = useState<string[]>([]);
  const [selectedReminderSubCompanies, setSelectedReminderSubCompanies] = useState<string[]>([]);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [reminderPreview, setReminderPreview] = useState("");

  const loadReport = useCallback(async (requestedMonth?: string, cancelled?: () => boolean) => {
      try {
        setLoading(true);
        setError(null);
        const path = requestedMonth
          ? `/api/monthly-report?month=${encodeURIComponent(requestedMonth)}`
          : "/api/monthly-report";
        const res = await fetch(path, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as Partial<ReportResponse> & {
          message?: string;
        };
        if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);

        const nextRows = Array.isArray(json.summary) ? json.summary : [];
        const nextMonths = Array.isArray(json.months) ? json.months : unique(nextRows.map((r) => r.month));

        if (!cancelled?.()) {
          setRows(nextRows);
          setMonths(nextMonths);
          setMonth(requestedMonth || json.month || nextMonths[0] || "");
        }
      } catch (e: unknown) {
        console.error("monthly report fetch failed:", e);
        if (!cancelled?.()) setError(errorMessage(e) || "Failed to load monthly report");
      } finally {
        if (!cancelled?.()) setLoading(false);
      }
    }, []);

  useEffect(() => {
    let cancelled = false;

    loadReport(undefined, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadReport]);

  const clientNames = useMemo(() => unique(rows.map((r) => r.clientName)), [rows]);
  const subCompanies = useMemo(() => unique(rows.map((r) => r.subCompany)), [rows]);
  const states = useMemo(() => unique(rows.map((r) => stateFromAddress(r.address))), [rows]);

  const filteredRows = useMemo(() => {
    const normalizedWorkOrderSearch = workOrderSearch.trim().toLowerCase();
    return rows.filter((row) => {
      return (
        (!month || row.month === month) &&
        (!state || stateFromAddress(row.address) === state) &&
        (!clientName || row.clientName === clientName) &&
        (!subCompany || row.subCompany === subCompany) &&
        (!status || row.status === status) &&
        (!normalizedWorkOrderSearch ||
          String(row.workOrderNumber ?? "").toLowerCase().includes(normalizedWorkOrderSearch))
      );
    });
  }, [rows, month, state, clientName, subCompany, status, workOrderSearch]);

  const selectedReminderRows = useMemo(() => {
    const selected = new Set(selectedReminderKeys);
    const selectedSubs = new Set(selectedReminderSubCompanies);
    return filteredRows.filter(
      (row) =>
        selected.has(rowKey(row)) &&
        (selectedSubs.size === 0 || selectedSubs.has(row.subCompany))
    );
  }, [filteredRows, selectedReminderKeys, selectedReminderSubCompanies]);

  const reminderSubCompanies = useMemo(
    () => unique(filteredRows.map((row) => row.subCompany)),
    [filteredRows]
  );

  const reminderSelectableRows = useMemo(() => {
    if (selectedReminderSubCompanies.length === 0) return filteredRows;
    const selectedSubs = new Set(selectedReminderSubCompanies);
    return filteredRows.filter((row) => selectedSubs.has(row.subCompany));
  }, [filteredRows, selectedReminderSubCompanies]);

  const selectedReminderGroups = useMemo(
    () => groupReminderRows(selectedReminderRows),
    [selectedReminderRows]
  );

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.expected += Number(row.expectedServices) || 0;
        acc.completed += Number(row.completedServices) || 0;
        acc.missing += Number(row.missingServices) || 0;
        acc.extra += Math.max((Number(row.completedServices) || 0) - (Number(row.expectedServices) || 0), 0);
        if (row.status === "OK") acc.ok += 1;
        if (row.status === "LOW") acc.low += 1;
        if (row.status === "MISSING") acc.missingSites += 1;
        return acc;
      },
      { expected: 0, completed: 0, missing: 0, extra: 0, ok: 0, low: 0, missingSites: 0 }
    );
  }, [filteredRows]);

  const invoiceSummary = useMemo(() => {
    const fallbackRate = Number(serviceRate) || 0;
    const grouped = new Map<
      string,
      {
        state: string;
        clientName: string;
        subCompany: string;
        properties: number;
        expectedServices: number;
        completedServices: number;
        missingServices: number;
        invoiceAmount: number;
      }
    >();

    for (const row of filteredRows) {
      const stateCode = stateFromAddress(row.address) || "Unknown";
      const key = [stateCode, row.clientName || "-", row.subCompany || "-"].join("::");
      const current =
        grouped.get(key) ??
        {
          state: stateCode,
          clientName: row.clientName || "-",
          subCompany: row.subCompany || "-",
          properties: 0,
          expectedServices: 0,
          completedServices: 0,
          missingServices: 0,
          invoiceAmount: 0,
        };

      current.properties += 1;
      current.expectedServices += Number(row.expectedServices) || 0;
      current.completedServices += Number(row.completedServices) || 0;
      current.missingServices += Number(row.missingServices) || 0;
      current.invoiceAmount +=
        (Number(row.completedServices) || 0) *
        ((Number(row.subPrice) || 0) || fallbackRate);
      grouped.set(key, current);
    }

    return Array.from(grouped.values()).sort(
      (a, b) =>
        a.state.localeCompare(b.state) ||
        a.clientName.localeCompare(b.clientName) ||
        a.subCompany.localeCompare(b.subCompany)
    );
  }, [filteredRows, serviceRate]);

  function exportInvoiceSummary() {
    downloadCsv(`${month || "monthly"}-invoice-summary-by-state.csv`, [
      [
        "month",
        "state",
        "clientName",
        "subCompany",
        "properties",
        "expectedServices",
        "completedServices",
        "missingServices",
        "rateSource",
        "invoiceAmount",
      ],
      ...invoiceSummary.map((row) => [
        month,
        row.state,
        row.clientName,
        row.subCompany,
        row.properties,
        row.expectedServices,
        row.completedServices,
        row.missingServices,
        serviceRate ? `fallback ${Number(serviceRate) || 0}` : "site Sub Price",
        row.invoiceAmount.toFixed(2),
      ]),
    ]);
  }

  function exportInvoiceDetail() {
    downloadCsv(`${month || "monthly"}-invoice-detail.csv`, [
      [
        "month",
        "state",
        "workOrderNumber",
        "address",
        "clientName",
        "subCompany",
        "subEmail",
        "expectedServices",
        "completedServices",
        "missingServices",
        "subPrice",
        "invoiceAmount",
        "lastUploadDate",
        "status",
        "siteId",
      ],
      ...filteredRows.map((row) => [
        row.month,
        stateFromAddress(row.address) || "Unknown",
        row.workOrderNumber || "",
        row.address,
        row.clientName,
        row.subCompany,
        row.subEmail || "",
        row.expectedServices,
        row.completedServices,
        row.missingServices,
        Number(row.subPrice) || 0,
        money(Number(row.invoiceAmount) || ((Number(row.completedServices) || 0) * (Number(row.subPrice) || 0))),
        row.lastUploadDate,
        row.status,
        row.siteId,
      ]),
    ]);
  }

  function reminderPayload(rowsToSend = selectedReminderRows) {
    const reminderGroups = groupReminderRows(rowsToSend);
    return {
      month,
      generatedAt: new Date().toISOString(),
      uploadLink: "https://fieldops-photo-uploader.vercel.app/",
      reminderGroups,
    };
  }

  function previewReminderBatch(rowsToPreview = selectedReminderRows) {
    const payload = reminderPayload(rowsToPreview);
    setReminderPreview(JSON.stringify(payload, null, 2));
    setMessage(`Prepared ${payload.reminderGroups.length} subcontractor summary email(s) for review.`);
  }

  async function copyReminderPayload() {
    const payloadText = JSON.stringify(reminderPayload(), null, 2);
    await navigator.clipboard.writeText(payloadText);
    setReminderPreview(payloadText);
    setMessage("Reminder payload copied.");
  }

  async function sendReminders() {
    try {
      setSendingReminders(true);
      setError(null);
      setMessage(null);
      const payload = reminderPayload();
      const res = await fetch("/api/photo-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
      setReminderPreview(JSON.stringify(json, null, 2));
      setMessage(json.configured ? "Reminder request sent." : "Reminder sender is not configured yet.");
    } catch (e: unknown) {
      setError(errorMessage(e) || "Failed to send reminders");
    } finally {
      setSendingReminders(false);
    }
  }

  function toggleReminder(row: MonthlyServiceRow) {
    const key = rowKey(row);
    setSelectedReminderKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  }

  async function saveMonthlyExpectedServices() {
    try {
      setSavingExpectedServices(true);
      setError(null);
      setMessage(null);
      const res = await fetch("/api/monthly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setMonthlyExpectedServices",
          month,
          siteId: "all",
          expectedServices: Number(expectedServicesOverride),
          notes: "Default for all active properties this month",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<ReportResponse> & {
        message?: string;
      };
      if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);

      const nextRows = Array.isArray(json.summary) ? json.summary : [];
      const nextMonths = Array.isArray(json.months) ? json.months : unique(nextRows.map((r) => r.month));
      setRows(nextRows);
      setMonths(nextMonths);
      setMessage(`Expected services for ${month} saved as ${expectedServicesOverride}.`);
    } catch (e: unknown) {
      setError(errorMessage(e) || "Failed to save expected services");
    } finally {
      setSavingExpectedServices(false);
    }
  }

  async function refreshGoogleSummaryTabs() {
    try {
      setRefreshingSheets(true);
      setError(null);
      setMessage(null);
      const res = await fetch("/api/monthly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "refreshSheets",
          month,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<ReportResponse> & {
        message?: string;
      };
      if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);

      const nextRows = Array.isArray(json.summary) ? json.summary : [];
      const nextMonths = Array.isArray(json.months) ? json.months : unique(nextRows.map((r) => r.month));
      setRows(nextRows);
      setMonths(nextMonths);
      setMessage(`Google summary tabs refreshed for ${month}.`);
    } catch (e: unknown) {
      setError(errorMessage(e) || "Failed to refresh Google summary tabs");
    } finally {
      setRefreshingSheets(false);
    }
  }

  const controlStyle: React.CSSProperties = {
    minWidth: 160,
    flex: "1 1 160px",
    padding: "10px 12px",
    border: "1px solid #d7dce2",
    borderRadius: 8,
    background: "#fff",
  };

  return (
    <main style={{ minHeight: "100vh", background: "#f6f8fb", color: "#172033" }}>
      <div style={{ maxWidth: 1220, margin: "0 auto", padding: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <Image
            src="/logo.png"
            alt="FIELD OPS"
            width={170}
            height={67}
            priority
            style={{ maxWidth: "48vw", height: "auto", display: "block" }}
          />
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Monthly Service Report</h1>
            <div style={{ color: "#64748b", fontSize: 13, marginTop: 3 }}>
              Service completion by property and month
            </div>
          </div>
        </div>
        <Link href="/" style={{ color: "#2563eb", fontSize: 14, fontWeight: 700 }}>
          Back to uploader
        </Link>
      </div>

      {loading && <p>Refreshing monthly service summary from Google Sheets...</p>}
      {!loading && message && <p style={{ color: "#166534", fontWeight: 800 }}>{message}</p>}
      {!loading && error && <p style={{ color: "crimson" }}>Error loading report: {error}</p>}

      {!loading && !error && (
        <>
          <section
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              margin: "16px 0",
              padding: 12,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
            }}
          >
            <select
              value={month}
              onChange={(e) => {
                const nextMonth = e.target.value;
                setMonth(nextMonth);
                loadReport(nextMonth);
              }}
              style={controlStyle}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <input
              value={workOrderSearch}
              onChange={(e) => setWorkOrderSearch(e.target.value)}
              placeholder="Search work order"
              aria-label="Search work order"
              inputMode="numeric"
              style={{
                ...controlStyle,
                flex: "1 1 220px",
                minWidth: 220,
                fontWeight: 700,
              }}
            />

            <select value={state} onChange={(e) => setState(e.target.value)} style={controlStyle}>
              <option value="">All states</option>
              {states.map((stateCode) => (
                <option key={stateCode} value={stateCode}>
                  {stateCode}
                </option>
              ))}
            </select>

            <select
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              style={controlStyle}
            >
              <option value="">All clients</option>
              {clientNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>

            <select
              value={subCompany}
              onChange={(e) => setSubCompany(e.target.value)}
              style={controlStyle}
            >
              <option value="">All sub-companies</option>
              {subCompanies.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>

            <select value={status} onChange={(e) => setStatus(e.target.value)} style={controlStyle}>
              <option value="">All statuses</option>
              <option value="OK">OK</option>
              <option value="LOW">LOW</option>
              <option value="MISSING">MISSING</option>
            </select>
          </section>

          <section
            style={{
              marginBottom: 16,
              padding: 12,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
            }}
          >
            <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
              <div>
                <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Photo Reminder Emails</h2>
                <div style={{ color: "#64748b", fontSize: 13 }}>
                  Select subs and rows below, then send one summary email per subcontractor through the FIELD OPS Gmail Apps Script.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setSelectedReminderKeys(reminderSelectableRows.map(rowKey))}
                  style={controlStyle}
                >
                  Select filtered subs
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedReminderKeys(
                      reminderSelectableRows
                        .filter((row) => (row.status === "LOW" || row.status === "MISSING") && row.subEmail)
                        .map(rowKey)
                    )
                  }
                  style={controlStyle}
                >
                  Select LOW/MISSING
                </button>
                <button type="button" onClick={() => setSelectedReminderKeys([])} style={controlStyle}>
                  Clear selected
                </button>
              </div>
            </div>
            <div
              style={{
                marginTop: 12,
                padding: 10,
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                background: "#f8fafc",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 800 }}>Send only to selected subs</div>
                  <div style={{ color: "#64748b", fontSize: 13 }}>
                    Leave blank to use all subs in the current report filters.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setSelectedReminderSubCompanies(reminderSubCompanies)}
                    style={{ ...controlStyle, flex: "0 1 140px", minWidth: 120 }}
                  >
                    All subs
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedReminderSubCompanies([])}
                    style={{ ...controlStyle, flex: "0 1 140px", minWidth: 120 }}
                  >
                    Clear subs
                  </button>
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 8,
                  maxHeight: 140,
                  overflowY: "auto",
                  marginTop: 10,
                  paddingRight: 4,
                }}
              >
                {reminderSubCompanies.map((name) => (
                  <label
                    key={name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      background: "#fff",
                      fontSize: 13,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedReminderSubCompanies.includes(name)}
                      onChange={() =>
                        setSelectedReminderSubCompanies((current) =>
                          current.includes(name)
                            ? current.filter((item) => item !== name)
                            : [...current, name]
                        )
                      }
                    />
                    <span>{name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 10, color: "#475569", fontSize: 13 }}>
              {selectedReminderRows.length} selected location(s),{" "}
              {selectedReminderRows.filter((row) => row.subEmail).length} with email,{" "}
              {selectedReminderGroups.length} summary email(s).
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button type="button" onClick={() => previewReminderBatch()} style={controlStyle}>
                Preview Selected
              </button>
              <button type="button" onClick={copyReminderPayload} style={controlStyle}>
                Copy Apps Script Payload
              </button>
              <button
                type="button"
                onClick={sendReminders}
                disabled={sendingReminders || selectedReminderRows.length === 0}
                style={controlStyle}
              >
                Send Selected Reminders
              </button>
            </div>
            {reminderPreview && (
              <textarea
                value={reminderPreview}
                readOnly
                rows={8}
                style={{
                  width: "100%",
                  marginTop: 10,
                  padding: 10,
                  border: "1px solid #d7dce2",
                  borderRadius: 8,
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              />
            )}
          </section>

          <section
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 16,
              padding: 12,
              background: "#fff",
              border: "1px solid #dbeafe",
              borderRadius: 8,
            }}
          >
            <div style={{ flex: "1 1 260px" }}>
              <div style={{ fontWeight: 900 }}>Monthly Expected Services</div>
              <div style={{ color: "#64748b", fontSize: 13 }}>
                Sets the default expected services for all active properties in {month}.
              </div>
            </div>
            <input
              value={expectedServicesOverride}
              onChange={(e) => setExpectedServicesOverride(e.target.value)}
              placeholder="Example: 3"
              inputMode="numeric"
              style={{ ...controlStyle, flex: "0 1 140px", minWidth: 140 }}
            />
            <button
              type="button"
              onClick={saveMonthlyExpectedServices}
              disabled={savingExpectedServices || !month || expectedServicesOverride === ""}
              style={{ ...controlStyle, flex: "0 1 230px", fontWeight: 800, cursor: "pointer" }}
            >
              Save Expected For Month
            </button>
            <button
              type="button"
              onClick={refreshGoogleSummaryTabs}
              disabled={refreshingSheets || !month}
              style={{ ...controlStyle, flex: "0 1 230px", fontWeight: 800, cursor: "pointer" }}
            >
              {refreshingSheets ? "Refreshing Sheets..." : "Refresh Google Tabs"}
            </button>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {[
              ["Properties", filteredRows.length],
              ["Expected Services", totals.expected],
              ["Completed Services", totals.completed],
              ["Missing Services", totals.missing],
              ["Extra Services", totals.extra],
              ["OK Properties", totals.ok],
              ["LOW Properties", totals.low],
              ["MISSING Properties", totals.missingSites],
            ].map(([label, value]) => {
              const colors = metricColors[String(label)] ?? {
                bg: "#fff",
                border: "#e5e7eb",
                text: "#172033",
              };
              return (
              <div
                key={label}
                style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, background: colors.bg }}
              >
                <div style={{ fontSize: 12, color: "#667085", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: colors.text }}>{value}</div>
              </div>
              );
            })}
          </section>

          <section
            style={{
              marginBottom: 16,
              padding: 12,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Invoice Export By State</h2>
                <div style={{ color: "#64748b", fontSize: 13 }}>
                  Uses the current filters and totals completed services by state, client, and sub-company.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  value={serviceRate}
                  onChange={(e) => setServiceRate(e.target.value)}
                  placeholder="Rate per service"
                  inputMode="decimal"
                  style={{ ...controlStyle, minWidth: 150, flex: "0 1 150px" }}
                />
                <button type="button" onClick={exportInvoiceSummary} style={controlStyle}>
                  Export State Summary CSV
                </button>
                <button type="button" onClick={exportInvoiceDetail} style={controlStyle}>
                  Export Detail CSV
                </button>
              </div>
            </div>

            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["State", "Client", "Sub-company", "Properties", "Expected", "Completed", "Missing", "Invoice"].map(
                      (heading) => (
                        <th key={heading} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>
                          {heading}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {invoiceSummary.map((row) => (
                    <tr key={`${row.state}-${row.clientName}-${row.subCompany}`}>
                      <td style={{ padding: 8, borderBottom: "1px solid #eef2f7", fontWeight: 800 }}>{row.state}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #eef2f7" }}>{row.clientName}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #eef2f7" }}>{row.subCompany}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #eef2f7" }}>{row.properties}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #eef2f7" }}>{row.expectedServices}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #eef2f7" }}>{row.completedServices}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #eef2f7" }}>{row.missingServices}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #eef2f7" }}>
                        ${row.invoiceAmount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1260 }}>
              <thead>
                <tr style={{ background: "#eaf1f8" }}>
                  {[
                    "Send",
                    "Month",
                    "Status",
                    "Work Order",
                    "Address",
                    "Client",
                    "Sub-company",
                    "Email",
                    "Expected",
                    "Completed",
                    "Missing",
                    "Last upload",
                    "Site ID",
                  ].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        textAlign: "left",
                        padding: "10px 12px",
                        borderBottom: "1px solid #e5e7eb",
                        fontSize: 13,
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const colors = statusColors[row.status];
                  const key = rowKey(row);
                  return (
                    <tr key={key}>
                      <td style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
                        <input
                          type="checkbox"
                          checked={selectedReminderKeys.includes(key)}
                          onChange={() => toggleReminder(row)}
                          aria-label={`Select reminder for ${row.address}`}
                        />
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>{row.month}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
                        <span
                          style={{
                            display: "inline-block",
                            minWidth: 70,
                            textAlign: "center",
                            borderRadius: 999,
                            padding: "4px 8px",
                            background: colors.bg,
                            color: colors.text,
                            fontWeight: 800,
                            fontSize: 12,
                          }}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #eef2f7", color: "#667085" }}>
                        {row.workOrderNumber || "-"}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #eef2f7", fontWeight: 700 }}>
                        {row.address}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
                        {row.clientName || "-"}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
                        {row.subCompany || "-"}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
                        {row.subEmail || "-"}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
                        {row.expectedServices}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
                        {row.completedServices}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
                        {row.missingServices}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid #eef2f7" }}>
                        {row.lastUploadDate || "-"}
                      </td>
                      <td
                        style={{
                          padding: 12,
                          borderBottom: "1px solid #eef2f7",
                          maxWidth: 180,
                          overflowWrap: "anywhere",
                          fontSize: 12,
                        }}
                      >
                        {row.siteId}
                      </td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={13} style={{ padding: 18, textAlign: "center", color: "#667085" }}>
                      No properties match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      </div>
    </main>
  );
}

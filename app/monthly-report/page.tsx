"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

type MonthlyStatus = "OK" | "LOW" | "MISSING";

type MonthlyServiceRow = {
  month: string;
  siteId: string;
  workOrderNumber?: string;
  address: string;
  clientName: string;
  subCompany: string;
  expectedServices: number;
  completedServices: number;
  missingServices: number;
  lastUploadDate: string;
  status: MonthlyStatus;
};

type ReportResponse = {
  months: string[];
  summary: MonthlyServiceRow[];
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

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/monthly-report", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as Partial<ReportResponse> & {
          message?: string;
        };
        if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);

        const nextRows = Array.isArray(json.summary) ? json.summary : [];
        const nextMonths = Array.isArray(json.months) ? json.months : unique(nextRows.map((r) => r.month));

        if (!cancelled) {
          setRows(nextRows);
          setMonths(nextMonths);
          setMonth(nextMonths[0] ?? "");
        }
      } catch (e: unknown) {
        console.error("monthly report fetch failed:", e);
        if (!cancelled) setError(errorMessage(e) || "Failed to load monthly report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadReport();
    return () => {
      cancelled = true;
    };
  }, []);

  const clientNames = useMemo(() => unique(rows.map((r) => r.clientName)), [rows]);
  const subCompanies = useMemo(() => unique(rows.map((r) => r.subCompany)), [rows]);
  const states = useMemo(() => unique(rows.map((r) => stateFromAddress(r.address))), [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      return (
        (!month || row.month === month) &&
        (!state || stateFromAddress(row.address) === state) &&
        (!clientName || row.clientName === clientName) &&
        (!subCompany || row.subCompany === subCompany) &&
        (!status || row.status === status)
      );
    });
  }, [rows, month, state, clientName, subCompany, status]);

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
            <select value={month} onChange={(e) => setMonth(e.target.value)} style={controlStyle}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

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

          <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
              <thead>
                <tr style={{ background: "#eaf1f8" }}>
                  {[
                    "Month",
                    "Status",
                    "Work Order",
                    "Address",
                    "Client",
                    "Sub-company",
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
                  return (
                    <tr key={`${row.month}-${row.siteId}`}>
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
                    <td colSpan={11} style={{ padding: 18, textAlign: "center", color: "#667085" }}>
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

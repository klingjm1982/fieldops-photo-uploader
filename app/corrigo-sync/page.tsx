"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";

type CorrigoWorkOrder = {
  month: string;
  siteId: string;
  address: string;
  workOrderNumber: string;
  active: boolean;
  notes: string;
};

type CorrigoQueueRow = {
  queueId: string;
  month: string;
  siteId: string;
  address: string;
  serviceDate: string;
  workOrderNumber: string;
  uploadTimestamp: string;
  photoCount: number;
  driveLinks: string;
  originalFilenames: string;
  status: string;
  attempts: number;
  lastError: string;
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
};

type CorrigoState = {
  month: string;
  workOrders: CorrigoWorkOrder[];
  queue: CorrigoQueueRow[];
  uploadGroupCount: number;
  queueCandidateCount: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes <= 0) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #d7dce2",
  borderRadius: 8,
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 14px",
  border: "1px solid #d7dce2",
  borderRadius: 8,
  background: "#fff",
  cursor: "pointer",
  fontWeight: 700,
};

export default function CorrigoSyncPage() {
  const [month, setMonth] = useState(currentMonth());
  const [state, setState] = useState<CorrigoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    siteId: "",
    address: "",
    workOrderNumber: "",
    notes: "",
  });
  const [emailForm, setEmailForm] = useState({
    subject: "",
    emailBody: "",
  });

  const load = useCallback(async (nextMonth = month) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/corrigo-sync?month=${encodeURIComponent(nextMonth)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
      setState(json);
    } catch (err: unknown) {
      console.error("Corrigo sync load failed:", err);
      setError(errorMessage(err) || "Failed to load Corrigo sync state");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load(month);
  }, [load, month]);

  const workOrdersForMonth = useMemo(
    () => (state?.workOrders ?? []).filter((row) => row.month === month),
    [state, month]
  );

  const queueForMonth = useMemo(
    () => (state?.queue ?? []).filter((row) => row.month === month),
    [state, month]
  );

  const pendingQueueForMonth = useMemo(
    () => queueForMonth.filter((row) => row.status === "Pending Corrigo Upload"),
    [queueForMonth]
  );

  const monthOptions = useMemo(() => {
    const months = new Set<string>([month, currentMonth()]);
    for (const row of state?.workOrders ?? []) if (row.month) months.add(row.month);
    for (const row of state?.queue ?? []) if (row.month) months.add(row.month);
    return Array.from(months).sort().reverse();
  }, [month, state]);

  const batchEstimate = useMemo(() => {
    const services = pendingQueueForMonth.length;
    const photos = pendingQueueForMonth.reduce((sum, row) => sum + Math.min(Number(row.photoCount) || 0, 10), 0);
    const estimatedSeconds = Math.ceil(services * 14 + photos * 0.4);
    return {
      services,
      photos,
      duration: formatDuration(estimatedSeconds),
    };
  }, [pendingQueueForMonth]);

  const batchUploadCommand = useMemo(() => {
    return (
      `cd /Users/johnkling/fieldops-app && ` +
      `npm run corrigo:upload-queue -- --month=${month} --all-pending --instant --os-search --use-last-drag --auto-drag --continuous --upload-settle-ms=4000 --close-finder-after-drag --close-finder-delay-ms=5000 --max-photos-per-drag=10`
    );
  }, [month]);

  const recalibrateBatchUploadCommand = useMemo(() => {
    return (
      `cd /Users/johnkling/fieldops-app && ` +
      `npm run corrigo:upload-queue -- --month=${month} --all-pending --os-search --use-last-drag --finder-selected-start --auto-drag --continuous --upload-settle-ms=4000 --close-finder-after-drag --close-finder-delay-ms=5000 --recalibrate-drag --max-photos-per-drag=10`
    );
  }, [month]);

  async function copyCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setMessage("Upload command copied. Paste it into Terminal to start.");
    } catch {
      setError("Could not copy command. Select and copy it manually.");
    }
  }

  async function updateQueueStatus(queueId: string, status: string) {
    try {
      setSaving(true);
      setMessage(null);
      setError(null);
      const res = await fetch("/api/corrigo-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateQueueStatus", queueId, status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
      setMessage(`Queue row marked ${status}.`);
      await load(month);
    } catch (err: unknown) {
      setError(errorMessage(err) || "Failed to update queue status");
    } finally {
      setSaving(false);
    }
  }

  async function addWorkOrder(evt: React.FormEvent) {
    evt.preventDefault();
    try {
      setSaving(true);
      setMessage(null);
      setError(null);
      const res = await fetch("/api/corrigo-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addWorkOrder",
          month,
          siteId: form.siteId,
          address: form.address,
          workOrderNumber: form.workOrderNumber,
          notes: form.notes,
          active: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
      setForm({ siteId: "", address: "", workOrderNumber: "", notes: "" });
      setMessage("Work order mapping added.");
      await load(month);
    } catch (err: unknown) {
      setError(errorMessage(err) || "Failed to add work order");
    } finally {
      setSaving(false);
    }
  }

  async function buildQueue() {
    try {
      setSaving(true);
      setMessage(null);
      setError(null);
      const res = await fetch("/api/corrigo-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "buildQueue", month }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
      setMessage(`Created ${json.created ?? 0} Corrigo queue row(s).`);
      await load(month);
    } catch (err: unknown) {
      setError(errorMessage(err) || "Failed to build Corrigo queue");
    } finally {
      setSaving(false);
    }
  }

  async function rebuildQueue() {
    try {
      setSaving(true);
      setMessage(null);
      setError(null);
      const res = await fetch("/api/corrigo-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rebuildQueue", month }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
      setMessage(`Rebuilt queue and created ${json.created ?? 0} pending row(s).`);
      await load(month);
    } catch (err: unknown) {
      setError(errorMessage(err) || "Failed to rebuild Corrigo queue");
    } finally {
      setSaving(false);
    }
  }

  async function parseEmail(evt: React.FormEvent) {
    evt.preventDefault();
    try {
      setSaving(true);
      setMessage(null);
      setError(null);
      const res = await fetch("/api/corrigo-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "parseEmail",
          subject: emailForm.subject,
          emailBody: emailForm.emailBody,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
      setMessage(
        `Parsed WO ${json.parsed?.workOrderNumber ?? ""} and matched ${json.site?.address ?? "site"}.`
      );
      setEmailForm({ subject: "", emailBody: "" });
      await load(json.parsed?.month ?? month);
      if (json.parsed?.month) setMonth(json.parsed.month);
    } catch (err: unknown) {
      setError(errorMessage(err) || "Failed to parse Corrigo email");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={{ padding: 18, maxWidth: 1180, margin: "0 auto", color: "#172033" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Corrigo Sync Tester</h1>
        <Link href="/" style={{ color: "#2563eb", fontSize: 14 }}>
          Back to uploader
        </Link>
        <Link href="/monthly-report" style={{ color: "#2563eb", fontSize: 14 }}>
          Monthly report
        </Link>
      </div>

      <section style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "16px 0" }}>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ ...inputStyle, maxWidth: 180 }}
        >
          {monthOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => load(month)} disabled={loading || saving} style={buttonStyle}>
          Refresh
        </button>
        <button type="button" onClick={buildQueue} disabled={loading || saving} style={buttonStyle}>
          Build Queue
        </button>
        <button type="button" onClick={rebuildQueue} disabled={loading || saving} style={buttonStyle}>
          Rebuild Queue Dates
        </button>
      </section>

      {loading && <p>Loading Corrigo sync data...</p>}
      {message && <p style={{ color: "#166534", fontWeight: 700 }}>{message}</p>}
      {error && <p style={{ color: "crimson", fontWeight: 700 }}>Error: {error}</p>}

      {!loading && (
        <>
          <section
            style={{
              position: "sticky",
              top: 0,
              zIndex: 5,
              border: "1px solid #bfdbfe",
              borderRadius: 8,
              padding: 12,
              background: "#eff6ff",
              marginBottom: 16,
              boxShadow: "0 4px 10px rgba(15, 23, 42, 0.08)",
            }}
          >
            <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
              <div>
                <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Instant Corrigo Batch</h2>
                <div style={{ color: "#475569", fontSize: 13 }}>
                  {batchEstimate.services} pending service(s), up to {batchEstimate.photos} photo(s), estimated {batchEstimate.duration}.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => copyCommand(batchUploadCommand)} style={buttonStyle}>
                  Copy Instant Command
                </button>
                <button type="button" onClick={() => copyCommand(recalibrateBatchUploadCommand)} style={buttonStyle}>
                  Copy Recalibrate Command
                </button>
              </div>
            </div>
            <code
              style={{
                display: "block",
                marginTop: 10,
                padding: 10,
                background: "#fff",
                borderRadius: 8,
                overflowWrap: "anywhere",
                fontSize: 12,
              }}
            >
              {batchUploadCommand}
            </code>
          </section>

          <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, margin: "0 0 10px" }}>Parse Corrigo Email</h2>
            <form onSubmit={parseEmail} style={{ display: "grid", gap: 10 }}>
              <input
                value={emailForm.subject}
                onChange={(e) => setEmailForm((current) => ({ ...current, subject: e.target.value }))}
                placeholder='Subject: The new Scheduled work order #309250085 received from Driven Brands'
                required
                style={inputStyle}
              />
              <textarea
                value={emailForm.emailBody}
                onChange={(e) => setEmailForm((current) => ({ ...current, emailBody: e.target.value }))}
                placeholder="Paste the Corrigo email body here. It must include Site Address and Problem = Landscape."
                required
                rows={8}
                style={{ ...inputStyle, fontFamily: "Arial, Helvetica, sans-serif" }}
              />
              <button type="submit" disabled={saving} style={{ ...buttonStyle, maxWidth: 180 }}>
                Parse Email
              </button>
            </form>
          </section>

          <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, margin: "0 0 10px" }}>Add Test Work Order</h2>
            <form
              onSubmit={addWorkOrder}
              style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}
            >
              <input
                value={form.siteId}
                onChange={(e) => setForm((current) => ({ ...current, siteId: e.target.value }))}
                placeholder="siteId"
                required
                style={inputStyle}
              />
              <input
                value={form.workOrderNumber}
                onChange={(e) => setForm((current) => ({ ...current, workOrderNumber: e.target.value }))}
                placeholder="Corrigo work order number"
                required
                style={inputStyle}
              />
              <input
                value={form.address}
                onChange={(e) => setForm((current) => ({ ...current, address: e.target.value }))}
                placeholder="Address"
                style={inputStyle}
              />
              <input
                value={form.notes}
                onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
                placeholder="Notes"
                style={inputStyle}
              />
              <button type="submit" disabled={saving} style={buttonStyle}>
                Add Mapping
              </button>
            </form>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {[
              ["Work orders", workOrdersForMonth.length],
              ["Upload groups", state?.uploadGroupCount ?? 0],
              ["Ready to queue", state?.queueCandidateCount ?? 0],
              ["Pending", pendingQueueForMonth.length],
              ["Est. remaining", batchEstimate.duration],
              ["Queued total", queueForMonth.length],
            ].map(([label, value]) => (
              <div key={label} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: "#667085", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
              </div>
            ))}
          </section>

          <section style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Selected Work Orders</h2>
            <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
              <table style={{ width: "100%", minWidth: 780, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Month", "Work Order", "Address", "Site ID", "Active", "Notes"].map((heading) => (
                      <th key={heading} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb" }}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {workOrdersForMonth.map((row) => (
                    <tr key={`${row.month}-${row.siteId}-${row.workOrderNumber}`}>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>{row.month}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7", fontWeight: 800 }}>
                        {row.workOrderNumber}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>{row.address || "-"}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7", overflowWrap: "anywhere" }}>
                        {row.siteId}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>{row.active ? "Y" : "N"}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>{row.notes || "-"}</td>
                    </tr>
                  ))}
                  {workOrdersForMonth.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 14, textAlign: "center", color: "#667085" }}>
                        Add a work order mapping for selected test addresses.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Corrigo Upload Queue</h2>
            <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
              <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Status", "Change Status", "Service Date", "Work Order", "Address", "Photos", "Site ID", "Created"].map(
                      (heading) => (
                        <th key={heading} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb" }}>
                          {heading}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {queueForMonth.map((row) => (
                    <tr key={row.queueId}>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7", fontWeight: 800 }}>
                        {row.status}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>
                        {row.status === "Pending Corrigo Upload" ? (
                          <button
                            type="button"
                            onClick={() => updateQueueStatus(row.queueId, "Already Uploaded")}
                            disabled={saving}
                            style={{ ...buttonStyle, padding: "7px 10px", whiteSpace: "nowrap" }}
                          >
                            Mark already uploaded
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => updateQueueStatus(row.queueId, "Pending Corrigo Upload")}
                            disabled={saving}
                            style={{ ...buttonStyle, padding: "7px 10px", whiteSpace: "nowrap" }}
                          >
                            Reopen
                          </button>
                        )}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>{row.serviceDate}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>{row.workOrderNumber}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>{row.address}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>{row.photoCount}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7", overflowWrap: "anywhere" }}>
                        {row.siteId}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>{row.createdAt}</td>
                    </tr>
                  ))}
                  {queueForMonth.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ padding: 14, textAlign: "center", color: "#667085" }}>
                        No queued Corrigo uploads yet. Add work order mappings, then build the queue.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

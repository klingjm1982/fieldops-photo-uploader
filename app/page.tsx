"use client";

import Image from "next/image";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { markRouteStopComplete } from "@/app/lib/routeCompletion";

type Site = {
  siteId: string;
  displayName: string;
  address?: string;
  folderId?: string; // Drive folder id
  propertySize?: string;
};

// Vercel rejects oversized request bodies before the upload handler can run.
// One prepared photo per request keeps multi-photo selections reliable on phones.
const MAX_FILES_PER_UPLOAD_REQUEST = 1;
const MAX_PREPARED_FILE_BYTES = 3_500_000;
const IMAGE_PREP_TIMEOUT_MS = 20000;
const HEIC_EXT_RE = /\.(heic|heif)$/i;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function todayInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function isHeicFile(file: File) {
  const type = file.type.toLowerCase();
  return type.includes("heic") || type.includes("heif") || HEIC_EXT_RE.test(file.name);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function normalizeLookup(value: string | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

function sameLookupValue(left: string, right: string) {
  if (!left || !right) return false;
  if (left === right) return true;
  return left.length > 12 && right.length > 12 && (left.includes(right) || right.includes(left));
}

export default function Page() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Site | null>(null);
  const [serviceDate, setServiceDate] = useState(todayInputValue);

  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const [uploadedCount, setUploadedCount] = useState(0);
  const [totalToUpload, setTotalToUpload] = useState(0);
  const [stage, setStage] = useState<"idle" | "preparing" | "uploading">("idle");
  const [routeReturnUrl, setRouteReturnUrl] = useState("");
  const [routeCompletion, setRouteCompletion] = useState<{ crewId: string; date: string; stopKey: string } | null>(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);

  // ---------- Load sites ----------
  useEffect(() => {
    let cancelled = false;

    async function loadSites() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/sites", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        const sitesArray: Site[] = Array.isArray(json) ? json : (json.sites ?? []);

        if (!cancelled) {
          setSites(sitesArray);
          const params = new URLSearchParams(window.location.search);
          const linkedSiteId = params.get("siteId")?.trim();
          const linkedAddress = params.get("address")?.trim();
          const linkedServiceDate = params.get("serviceDate")?.trim();
          const returnTo = params.get("returnTo")?.trim() ?? "";
          const routeCrewId = params.get("routeCrewId")?.trim() ?? "";
          const routeDate = params.get("routeDate")?.trim() ?? "";
          const linkedRouteStopKey = params.get("routeStopKey")?.trim() ?? "";
          const linkedSiteIdKey = normalizeLookup(linkedSiteId);
          const linkedAddressKey = normalizeLookup(linkedAddress);
          const linkedSite = sitesArray.find((site) => {
            const siteIdKey = normalizeLookup(site.siteId);
            const folderIdKey = normalizeLookup(site.folderId);
            const addressKey = normalizeLookup(site.address);
            const displayNameKey = normalizeLookup(site.displayName);

            return (
              (linkedSiteIdKey && (siteIdKey === linkedSiteIdKey || folderIdKey === linkedSiteIdKey)) ||
              sameLookupValue(addressKey, linkedAddressKey) ||
              sameLookupValue(displayNameKey, linkedAddressKey)
            );
          });
          if (linkedSite) {
            setSelected(linkedSite);
            setQuery(linkedSite.displayName);
          } else if (linkedAddress) {
            setQuery(linkedAddress);
            setUploadMsg("Route address loaded, but it did not match an active upload site. Check the route site ID/address.");
          }
          if (linkedServiceDate && /^\d{4}-\d{2}-\d{2}$/.test(linkedServiceDate)) {
            setServiceDate(linkedServiceDate);
          }
          if (returnTo.startsWith("/crew-route")) setRouteReturnUrl(returnTo);
          if (routeCrewId && /^\d{4}-\d{2}-\d{2}$/.test(routeDate) && linkedRouteStopKey) {
            setRouteCompletion({ crewId: routeCrewId, date: routeDate, stopKey: linkedRouteStopKey });
          }
        }
      } catch (err: unknown) {
        console.error("sites fetch failed:", err);
        if (!cancelled) setError(errorMessage(err) || "Failed to load sites");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSites();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- Filter suggestions ----------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return sites
      .filter((s) => (s.displayName ?? "").toLowerCase().includes(q))
      .slice(0, 10);
  }, [query, sites]);

  // ---------- Reset workflow ----------
  function resetForm() {
    setSelected(null);
    setQuery("");
    setServiceDate(todayInputValue());
    setUploadMsg(null);
    setUploadedCount(0);
    setTotalToUpload(0);
    setStage("idle");
  }

  // ---------- Client-side compression ----------
  async function compressImage(file: File, maxW = 1600, quality = 0.72): Promise<File> {
    if (!file.type.startsWith("image/")) return file;
    if (isHeicFile(file)) return file;

    await waitForNextFrame();

    const img = document.createElement("img");
    const url = URL.createObjectURL(file);

    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`Could not prepare ${file.name || "photo"}`));
          img.src = url;
        }),
        IMAGE_PREP_TIMEOUT_MS,
        `Phone took too long preparing ${file.name || "photo"}. Try fewer photos at once.`
      );
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }

    const scale = Math.min(1, maxW / img.width);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return file;
    }

    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);

    const blob: Blob | null = await withTimeout(
      new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality)),
      IMAGE_PREP_TIMEOUT_MS,
      `Phone took too long compressing ${file.name || "photo"}. Try fewer photos at once.`
    );

    if (!blob) return file;

    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  }

  async function uploadChunk(files: File[], onPrepared: () => void) {
    const form = new FormData();

    for (const f of files) {
      let optimized = await compressImage(f, 1400, 0.68);
      if (optimized.size > MAX_PREPARED_FILE_BYTES && !isHeicFile(optimized)) {
        optimized = await compressImage(optimized, 1200, 0.55);
      }
      if (optimized.size > MAX_PREPARED_FILE_BYTES) {
        throw new Error(
          `${f.name || "This photo"} is too large to upload. Try taking it again with a lower camera resolution or use Most Compatible camera format.`
        );
      }
      form.append("files", optimized);
      onPrepared();
    }

    form.append("siteId", selected?.siteId ?? "");
    form.append("folderId", selected?.folderId ?? "");
    form.append("displayName", selected?.displayName ?? "");
    form.append("serviceDate", serviceDate);

    setStage("uploading");

    const res = await fetch("/api/upload", {
      method: "POST",
      body: form,
    });

    const json = await res.json().catch(() => ({}));
    if (res.status === 413) {
      throw new Error("This photo is too large to upload. Try a lower-resolution photo or use Most Compatible camera format.");
    }
    if (!res.ok) throw new Error(json?.message ?? `Upload failed (HTTP ${res.status})`);

    return Number(json.count ?? files.length);
  }

  // ---------- Upload many selected files in Android-friendly chunks ----------
  async function handleBatchUpload(files: File[]) {
    if (!selected?.folderId) {
      setUploadMsg("Select a site first.");
      return;
    }

    setUploading(true);
    setUploadMsg(`Preparing ${files.length} photo(s). Keep this page open.`);
    setUploadedCount(0);
    setTotalToUpload(files.length);
    setStage("preparing");

    try {
      let uploadedTotal = 0;

      for (let i = 0; i < files.length; i += MAX_FILES_PER_UPLOAD_REQUEST) {
        const chunk = files.slice(i, i + MAX_FILES_PER_UPLOAD_REQUEST);
        const uploadedInChunk = await uploadChunk(chunk, () => {
          setUploadedCount((c) => c + 1);
          setUploadMsg("Preparing photos. Keep this page open.");
        });
        uploadedTotal += uploadedInChunk;
      }

      setUploadMsg(`✅ Uploaded ${uploadedTotal} photo(s)`);
      if (routeCompletion) {
        markRouteStopComplete(routeCompletion.crewId, routeCompletion.date, routeCompletion.stopKey);
        const progressBody = JSON.stringify({
          date: routeCompletion.date,
          stopKey: routeCompletion.stopKey,
          status: "completed",
          photoCount: uploadedTotal,
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(
            "/api/route-progress",
            new Blob([progressBody], { type: "application/json" })
          );
        } else {
          void fetch("/api/route-progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: progressBody,
            keepalive: true,
          }).catch(() => undefined);
        }
      }
    } catch (e: unknown) {
      console.error(e);
      setUploadMsg(`❌ ${errorMessage(e) || "Upload failed"}`);
    } finally {
      setUploading(false);
      setStage("idle");

      // Clear inputs so selecting the same images twice triggers change
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (libraryInputRef.current) libraryInputRef.current.value = "";
    }
  }

  async function onPickFiles(evt: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(evt.target.files ?? []);
    if (files.length === 0) return;

    // Clear inputs so selecting same photos again works
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (libraryInputRef.current) libraryInputRef.current.value = "";

    await handleBatchUpload(files);
  }

  const actionDisabled = !selected || uploading;
  const pickerLabelStyle: React.CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${actionDisabled ? "#cbd5e1" : "#334155"}`,
    background: actionDisabled ? "#f8fafc" : "#172033",
    color: actionDisabled ? "#475569" : "#fff",
    cursor: actionDisabled ? "not-allowed" : "pointer",
    fontWeight: 800,
    opacity: 1,
    overflow: "hidden",
    minHeight: 44,
  };
  const fileInputStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    opacity: 0,
    cursor: actionDisabled ? "not-allowed" : "pointer",
  };

  return (
    <main style={{ minHeight: "100vh", background: "#f6f8fb", color: "#172033" }}>
      <div style={{ padding: 16, maxWidth: 720, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 18,
          padding: "12px 0",
        }}
      >
        <Image
          src="/logo.png"
          alt="FIELD OPS"
          width={170}
          height={67}
          priority
          style={{ maxWidth: "58vw", height: "auto", display: "block" }}
        />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "#172033" }}>
            Photo Uploader
          </h1>
          <div style={{ color: "#64748b", fontSize: 13, marginTop: 3 }}>
            Upload site photos to the correct property folder
          </div>
        </div>
      </header>

      {loading && <p>Loading sites…</p>}

      {!loading && error && <p style={{ color: "crimson" }}>Error loading sites: {error}</p>}

      {!loading && !error && (
        <>
          <label style={{ display: "block", fontWeight: 800, marginBottom: 6, color: "#1f2937" }}>
            Site / Address
          </label>

          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            placeholder="Start typing an address…"
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #9ca3af",
              background: "#fff",
              color: "#111827",
              fontSize: 16,
              fontWeight: 700,
            }}
          />

          {query.trim() !== "" && filtered.length > 0 && (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 10,
                marginTop: 8,
                overflow: "hidden",
                background: "#fff",
                boxShadow: "0 8px 18px rgba(15, 23, 42, 0.08)",
              }}
            >
              {filtered.map((s) => (
                <button
                  key={s.siteId}
                  type="button"
                  onClick={() => {
                    setSelected(s);
                    setQuery(s.displayName);
                    setUploadMsg(null);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: 12,
                    border: "none",
                    borderBottom: "1px solid #d1d5db",
                    background: "white",
                    color: "#111827",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{s.displayName}</div>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div
              style={{
                marginTop: 8,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #bbf7d0",
                background: "#f0fdf4",
                color: "#14532d",
                fontWeight: 800,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span>Selected: {selected.displayName}</span>
                {selected.propertySize && (
                  <span
                    style={{
                      flexShrink: 0,
                      borderRadius: 999,
                      padding: "4px 9px",
                      background:
                        selected.propertySize.toLowerCase() === "large"
                          ? "#fee2e2"
                          : selected.propertySize.toLowerCase() === "medium"
                            ? "#fef3c7"
                            : "#dbeafe",
                      color:
                        selected.propertySize.toLowerCase() === "large"
                          ? "#991b1b"
                          : selected.propertySize.toLowerCase() === "medium"
                            ? "#92400e"
                            : "#1e40af",
                      fontSize: 12,
                      fontWeight: 900,
                      textTransform: "uppercase",
                    }}
                  >
                    {selected.propertySize}
                  </span>
                )}
              </div>
            </div>
          )}

          <label
            style={{
              display: "block",
              fontWeight: 800,
              marginTop: 14,
              marginBottom: 6,
              color: "#1f2937",
            }}
          >
            Service Date
          </label>

          <input
            type="date"
            value={serviceDate}
            onChange={(e) => setServiceDate(e.target.value)}
            max={todayInputValue()}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #9ca3af",
              background: "#fff",
              color: "#111827",
              fontSize: 16,
              fontWeight: 700,
            }}
          />
          <div style={{ color: "#475569", fontSize: 13, marginTop: 6 }}>
            Use the actual day the service was performed, even if photos are uploaded later.
          </div>

          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: "1px solid #d1d5db",
              borderRadius: 10,
              background: "#fff",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 10, color: "#1f2937" }}>Upload Photos</div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <label style={pickerLabelStyle}>
                📷 Camera
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  disabled={actionDisabled}
                  onChange={onPickFiles}
                  style={fileInputStyle}
                />
              </label>

              <label style={pickerLabelStyle}>
                🖼️ Photo Library (multi)
                <input
                  ref={libraryInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={actionDisabled}
                  onChange={onPickFiles}
                  style={fileInputStyle}
                />
              </label>
            </div>

            <p style={{ margin: "10px 0 0", color: "#374151", fontSize: 13 }}>
              On Android, use Photo Library to select several saved photos at once. Camera usually
              captures one new photo at a time.
            </p>

            {!selected && (
              <p style={{ margin: "10px 0 0", color: "#9a3412", fontSize: 13, fontWeight: 700 }}>
                Tap an address from the dropdown before choosing photos.
              </p>
            )}

            {uploading && totalToUpload > 0 && (
              <p style={{ marginTop: 10 }}>
                {stage === "preparing" ? "Preparing…" : "Uploading…"} {uploadedCount}/{totalToUpload}
              </p>
            )}

            {uploadMsg && (
              <div style={{ marginTop: 10 }}>
                <p>{uploadMsg}</p>

                {!uploading && (
                  <button
                    type="button"
                    onClick={() => {
                      if (routeReturnUrl && uploadMsg.startsWith("✅")) window.location.assign(routeReturnUrl);
                      else resetForm();
                    }}
                    style={{
                      marginTop: 8,
                      padding: "10px 16px",
                      borderRadius: 10,
                      border: "1px solid #ddd",
                      background: "white",
                      cursor: "pointer",
                    }}
                  >
                    {routeReturnUrl && uploadMsg.startsWith("✅") ? "Go to next route stop" : "Continue"}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
      </div>
    </main>
  );
}

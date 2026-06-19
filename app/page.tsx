"use client";

import Image from "next/image";
import React, { useEffect, useMemo, useRef, useState } from "react";

type Site = {
  siteId: string;
  displayName: string;
  address?: string;
  folderId?: string; // Drive folder id
};

const MAX_FILES_PER_UPLOAD_REQUEST = 5;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function Page() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Site | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const [uploadedCount, setUploadedCount] = useState(0);
  const [totalToUpload, setTotalToUpload] = useState(0);
  const [stage, setStage] = useState<"idle" | "preparing" | "uploading">("idle");

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

        if (!cancelled) setSites(sitesArray);
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
    setUploadMsg(null);
    setUploadedCount(0);
    setTotalToUpload(0);
    setStage("idle");
  }

  // ---------- Client-side compression ----------
  async function compressImage(file: File, maxW = 1600, quality = 0.72): Promise<File> {
    if (!file.type.startsWith("image/")) return file;

    const img = document.createElement("img");
    const url = URL.createObjectURL(file);

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });

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

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
    );

    if (!blob) return file;

    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  }

  async function uploadChunk(files: File[], onPrepared: () => void) {
    const form = new FormData();

    for (const f of files) {
      const optimized = await compressImage(f);
      form.append("files", optimized);
      onPrepared();
    }

    form.append("siteId", selected?.siteId ?? "");
    form.append("folderId", selected?.folderId ?? "");
    form.append("displayName", selected?.displayName ?? "");

    setStage("uploading");

    const res = await fetch("/api/upload", {
      method: "POST",
      body: form,
    });

    const json = await res.json().catch(() => ({}));
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
    setUploadMsg(null);
    setUploadedCount(0);
    setTotalToUpload(files.length);
    setStage("preparing");

    try {
      let uploadedTotal = 0;

      for (let i = 0; i < files.length; i += MAX_FILES_PER_UPLOAD_REQUEST) {
        const chunk = files.slice(i, i + MAX_FILES_PER_UPLOAD_REQUEST);
        const uploadedInChunk = await uploadChunk(chunk, () => {
          setUploadedCount((c) => c + 1);
        });
        uploadedTotal += uploadedInChunk;
      }

      setUploadMsg(`✅ Uploaded ${uploadedTotal} photo(s)`);
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

  return (
    <main style={{ minHeight: "100vh", background: "#f6f8fb" }}>
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
          <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
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
              border: "1px solid #ddd",
            }}
          />

          {query.trim() !== "" && filtered.length > 0 && (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 10,
                marginTop: 8,
                overflow: "hidden",
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
                    borderBottom: "1px solid #f2f2f2",
                    background: "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{s.displayName}</div>
                </button>
              ))}
            </div>
          )}

          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: "1px solid #eee",
              borderRadius: 10,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Upload Photos</div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={!selected || uploading}
                onClick={() => cameraInputRef.current?.click()}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: !selected || uploading ? "#f3f3f3" : "white",
                  cursor: !selected || uploading ? "not-allowed" : "pointer",
                }}
              >
                📷 Camera
              </button>

              <button
                type="button"
                disabled={!selected || uploading}
                onClick={() => libraryInputRef.current?.click()}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: !selected || uploading ? "#f3f3f3" : "white",
                  cursor: !selected || uploading ? "not-allowed" : "pointer",
                }}
              >
                🖼️ Photo Library (multi)
              </button>
            </div>

            <p style={{ margin: "10px 0 0", color: "#666", fontSize: 13 }}>
              On Android, use Photo Library to select several saved photos at once. Camera usually
              captures one new photo at a time.
            </p>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={onPickFiles}
              style={{ display: "none" }}
            />

            <input
              ref={libraryInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onPickFiles}
              style={{ display: "none" }}
            />

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
                    onClick={resetForm}
                    style={{
                      marginTop: 8,
                      padding: "10px 16px",
                      borderRadius: 10,
                      border: "1px solid #ddd",
                      background: "white",
                      cursor: "pointer",
                    }}
                  >
                    Continue
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

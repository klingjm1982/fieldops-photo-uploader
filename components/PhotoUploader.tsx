"use client";

import { useRef, useState } from "react";
import { ensureSignedIn } from "../lib/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../lib/firebase";

type Site = {
  id: string;
  address: string;
  folderId: string;
  active: boolean;
};

export function PhotoUploader({ site }: { site: Site }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const functions = getFunctions(app, "us-central1");
  const createSignedUploadUrl = httpsCallable(
    functions,
    "createSignedUploadUrl"
  );
  const registerUploadMetadata = httpsCallable(
    functions,
    "registerUploadMetadata"
  );

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setBusy(true);
    setMsg("");

    try {
      await ensureSignedIn();

      for (const file of Array.from(files)) {
        // 1) Request signed upload URL
        const res1: any = await createSignedUploadUrl({
  siteId: site.id,
  originalName: file.name,
  contentType: file.type || "application/octet-stream",
});

        const { uploadUrl, objectPath } = res1.data;

        // 2) Upload directly to Cloud Storage
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "image/jpeg",
          },
          body: file,
        });

        if (!put.ok) {
          throw new Error(`Upload failed (${put.status})`);
        }

        // 3) Register metadata in Firestore
        await registerUploadMetadata({
          siteId: site.id,
          objectPath,
        });
      }

      setMsg("Upload successful ✅");
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Upload error");
    } finally {
      setBusy(false);
    }
  }
return (
  <div style={{ marginTop: 24 }}>
    <label style={{ fontWeight: 600, display: "block", marginBottom: 8 }}>
      Upload photos for:
    </label>

    <div style={{ fontSize: 12, marginBottom: 12 }}>{site.address}</div>

    {/* Hidden input: Camera */}
    <input
      ref={cameraInputRef}
      type="file"
      accept="image/*"
      capture="environment"
      style={{ display: "none" }}
      disabled={busy}
      onChange={(e) => handleFiles(e.target.files)}
    />

    {/* Hidden input: Library */}
    <input
      ref={libraryInputRef}
      type="file"
      accept="image/*"
      multiple
      style={{ display: "none" }}
      disabled={busy}
      onChange={(e) => handleFiles(e.target.files)}
    />

    <div style={{ display: "flex", gap: 10 }}>
      <button
        disabled={busy}
        onClick={() => cameraInputRef.current?.click()}
        style={{
          flex: 1,
          padding: "12px 14px",
          borderRadius: 8,
          background: busy ? "#94a3b8" : "#0f172a",
          color: "#fff",
          border: "none",
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Uploading…" : "Take Photo"}
      </button>

      <button
        disabled={busy}
        onClick={() => libraryInputRef.current?.click()}
        style={{
          flex: 1,
          padding: "12px 14px",
          borderRadius: 8,
          background: "#ffffff",
          color: "#0f172a",
          border: "1px solid #cbd5e1",
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        Choose from Library
      </button>
    </div>

    {msg && <div style={{ marginTop: 10, fontSize: 12 }}>{msg}</div>}

    <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
      Tip: Use “Take Photo” for quick site shots, or “Choose from Library” for
      existing images.
    </div>
  </div>
);
}

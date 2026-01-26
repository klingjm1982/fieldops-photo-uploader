"use client";

import { useSearchParams, useRouter } from "next/navigation";

export default function ReviewPage() {
  const params = useSearchParams();
  const router = useRouter();
  const siteId = params.get("siteId");

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 24 }}>
      <h1>Review Upload</h1>

      <div style={{ marginTop: 12, fontSize: 14 }}>
        <strong>Site ID:</strong> {siteId ?? "(missing)"}
      </div>

      <button
        onClick={() => router.push("/")}
        style={{
          marginTop: 20,
          padding: "12px 16px",
          borderRadius: 8,
          background: "#0f172a",
          color: "#fff",
          border: "none",
          cursor: "pointer",
        }}
      >
        Back
      </button>
    </main>
  );
}

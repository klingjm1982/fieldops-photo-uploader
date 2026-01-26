"use client";

import { useEffect, useState } from "react";
import {
  collection,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";

type Site = {
  id: string;
  address: string;
  folderId: string;
  active: boolean;
};

export function AddressAutocomplete({
  onSelect,
}: {
  onSelect: (site: Site) => void;
}) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<Site[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = text.trim().toLowerCase();
    if (t.length < 2) {
      setSuggestions([]);
      return;
    }

    const run = async () => {
      setLoading(true);
      try {
        const sitesRef = collection(db, "sites");
        const q = query(
          sitesRef,
          where("active", "==", true),
          orderBy("addressNorm"),
          startAt(t),
          endAt(t + "\uf8ff"),
          limit(10)
        );

        const snap = await getDocs(q);
        const rows: Site[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));

        setSuggestions(rows);
      } finally {
        setLoading(false);
      }
    };

    const h = setTimeout(run, 200);
    return () => clearTimeout(h);
  }, [text]);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <label style={{ display: "block", fontSize: 14, marginBottom: 6 }}>
        Address
      </label>

      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Start typing an address..."
        style={{ width: "100%", padding: 10 }}
      />

      {loading && <div style={{ fontSize: 12, marginTop: 6 }}>Searching…</div>}

      {suggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 72,
            left: 0,
            right: 0,
            border: "1px solid #ccc",
            background: "#fff",
            zIndex: 50,
            maxHeight: 260,
            overflow: "auto",
          }}
        >
          {suggestions.map((s) => (
            <div
              key={s.id}
              onClick={() => {
                setText(s.address);
                setSuggestions([]);
                onSelect(s);
              }}
              style={{ padding: 10, cursor: "pointer" }}
            >
              {s.address}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

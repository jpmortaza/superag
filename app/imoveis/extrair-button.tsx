"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";

export default function ExtrairButton({ fonteSlug = "rgi-poa" }: { fonteSlug?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  async function rodar() {
    setMsg(null);
    try {
      const r = await fetch("/api/extracoes/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fonteSlug })
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg(`erro: ${j.error ?? r.status}`);
        return;
      }
      const novos = j.totalNovos ?? 0;
      const total = j.totalEncontrados ?? 0;
      setMsg(
        j.mode === "queued"
          ? "extração enfileirada — o worker vai consumir em breve"
          : `ok: ${novos} novos / ${total} encontrados`
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setMsg(`erro: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        onClick={rodar}
        disabled={pending}
        style={{
          background: "#0a7c3a",
          color: "#fff",
          border: 0,
          padding: "9px 14px",
          borderRadius: 8,
          fontSize: 13,
          cursor: pending ? "wait" : "pointer"
        }}
      >
        {pending ? "Extraindo..." : "Extrair mais imóveis"}
      </button>
      {msg && <span style={{ fontSize: 12, color: "#555" }}>{msg}</span>}
    </div>
  );
}

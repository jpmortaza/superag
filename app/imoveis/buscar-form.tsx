"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

export default function BuscarForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(sp.get("q") ?? "");
  const [tipo, setTipo] = useState(sp.get("tipo") ?? "");
  const [bairro, setBairro] = useState(sp.get("bairro") ?? "");
  const [quartosMin, setQuartosMin] = useState(sp.get("quartos_min") ?? "");
  const [precoMax, setPrecoMax] = useState(sp.get("preco_max") ?? "");

  function aplicar(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (tipo) params.set("tipo", tipo);
    if (bairro.trim()) params.set("bairro", bairro.trim());
    if (quartosMin) params.set("quartos_min", quartosMin);
    if (precoMax) params.set("preco_max", precoMax);
    startTransition(() => {
      router.push(`/imoveis${params.toString() ? "?" + params.toString() : ""}`);
    });
  }

  function limpar() {
    setQ("");
    setTipo("");
    setBairro("");
    setQuartosMin("");
    setPrecoMax("");
    startTransition(() => router.push("/imoveis"));
  }

  return (
    <form
      onSubmit={aplicar}
      style={{
        background: "#fff",
        borderRadius: 12,
        padding: 14,
        marginBottom: 20,
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,.04)"
      }}
    >
      <input
        type="text"
        placeholder="Buscar por título, bairro, cidade..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ ...inputStyle, minWidth: 220, flex: 2 }}
      />
      <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={selectStyle}>
        <option value="">Venda e aluguel</option>
        <option value="sale">Venda</option>
        <option value="rent">Aluguel</option>
      </select>
      <input
        type="text"
        placeholder="Bairro"
        value={bairro}
        onChange={(e) => setBairro(e.target.value)}
        style={{ ...inputStyle, width: 140 }}
      />
      <select
        value={quartosMin}
        onChange={(e) => setQuartosMin(e.target.value)}
        style={selectStyle}
      >
        <option value="">Quartos</option>
        <option value="1">1+</option>
        <option value="2">2+</option>
        <option value="3">3+</option>
        <option value="4">4+</option>
      </select>
      <select
        value={precoMax}
        onChange={(e) => setPrecoMax(e.target.value)}
        style={selectStyle}
      >
        <option value="">Preço máx</option>
        <option value="200000">R$ 200 mil</option>
        <option value="400000">R$ 400 mil</option>
        <option value="600000">R$ 600 mil</option>
        <option value="1000000">R$ 1 mi</option>
        <option value="2000000">R$ 2 mi</option>
      </select>
      <button type="submit" disabled={pending} style={btnPrimario}>
        {pending ? "..." : "Buscar"}
      </button>
      <button type="button" onClick={limpar} style={btnSecundario}>
        Limpar
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #ddd",
  fontSize: 13
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
  background: "#fff"
};

const btnPrimario: React.CSSProperties = {
  background: "#111",
  color: "#fff",
  border: 0,
  padding: "9px 18px",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer"
};

const btnSecundario: React.CSSProperties = {
  background: "#fff",
  color: "#555",
  border: "1px solid #ddd",
  padding: "9px 14px",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer"
};

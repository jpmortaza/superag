// Wrapper fino sobre a Apify REST API.
// Docs: https://docs.apify.com/api/v2

const APIFY_BASE = "https://api.apify.com/v2";

export type ApifyRunResult = {
  id: string;
  status: string;
  defaultDatasetId: string;
  items: unknown[];
};

export async function runApifyActor(
  actorId: string,
  input: unknown,
  opts: { timeoutSecs?: number } = {}
): Promise<ApifyRunResult> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN não configurado");

  // Actor IDs contêm "/" que precisa virar "~" na URL
  const urlActor = actorId.replace("/", "~");

  // run-sync-get-dataset-items: executa o actor e retorna os items direto
  const url = `${APIFY_BASE}/acts/${urlActor}/run-sync-get-dataset-items?token=${token}${
    opts.timeoutSecs ? `&timeout=${opts.timeoutSecs}` : ""
  }`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? {})
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify ${res.status}: ${text.slice(0, 300)}`);
  }

  const items = (await res.json()) as unknown[];

  return {
    id: res.headers.get("x-apify-run-id") ?? "",
    status: "SUCCEEDED",
    defaultDatasetId: res.headers.get("x-apify-run-default-dataset-id") ?? "",
    items
  };
}

/**
 * Normaliza item bruto vindo de um actor de OLX Imóveis para o formato
 * canônico esperado pelo RPC upsert_imovel.
 */
export function normalizarOlx(raw: Record<string, unknown>): Record<string, unknown> | null {
  const url = (raw.url ?? raw.link) as string | undefined;
  const rawId = (raw.id ?? raw.listingId) as string | number | undefined;
  const id = rawId || url?.match(/(\d+)(?:\.html|$)/)?.[1];
  if (!id) return null;

  const price = Number(raw.price ?? raw.priceValue ?? 0) || null;
  const area = Number(raw.area ?? raw.size ?? 0) || null;
  const images = Array.isArray(raw.images)
    ? (raw.images as string[])
    : Array.isArray(raw.imageUrls)
    ? (raw.imageUrls as string[])
    : [];

  return {
    id: `olx-${id}`,
    source: "OLX Imoveis",
    url: url ?? null,
    title: raw.title ?? raw.name ?? null,
    transactionType:
      raw.operation === "rent" || raw.transactionType === "rent" ? "rent" : "sale",
    propertyType: raw.category ?? raw.propertyType ?? null,
    propertySubType: raw.subCategory ?? null,
    price,
    priceFormatted:
      (raw.priceFormatted as string) ??
      (price ? `R$ ${price.toLocaleString("pt-BR")}` : null),
    condominiumFee: (raw.condominiumFee ?? null) as number | null,
    iptu: (raw.iptu ?? null) as number | null,
    pricePerSqm: area && price ? +(price / area).toFixed(2) : null,
    area,
    bedrooms: (raw.bedrooms ?? null) as number | null,
    bathrooms: (raw.bathrooms ?? null) as number | null,
    parkingSpaces: (raw.parkingSpaces ?? null) as number | null,
    amenities: (raw.amenities ?? null) as string | null,
    complexAmenities: (raw.complexAmenities ?? null) as string | null,
    neighborhood: (raw.neighborhood ?? null) as string | null,
    city: (raw.city ?? null) as string | null,
    state: (raw.state ?? null) as string | null,
    images,
    imageCount: images.length,
    publishedAt: (raw.publishedAt ?? raw.createdAt ?? null) as string | null,
    scrapedAt: new Date().toISOString()
  };
}

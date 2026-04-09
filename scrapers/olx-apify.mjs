// Roda um actor da Apify para coletar imóveis da OLX e faz upsert no Supabase.
// Substitua APIFY_ACTOR_ID pelo actor que você escolher (ex: "epctex/olx-scraper").
import { ApifyClient } from "apify-client";
import "dotenv/config";
import { upsertMany } from "./lib/supabase.mjs";

const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || "epctex/olx-scraper";

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const input = {
  startUrls: [
    { url: "https://rs.olx.com.br/imoveis" }
  ],
  maxItems: 200
};

console.log(`Rodando actor ${APIFY_ACTOR_ID}...`);
const run = await client.actor(APIFY_ACTOR_ID).call(input);
const { items } = await client.dataset(run.defaultDatasetId).listItems();

console.log(`Apify retornou ${items.length} itens. Normalizando...`);

const normalizados = items.map((it) => normalizar(it)).filter(Boolean);
const result = await upsertMany(normalizados);
console.log("Resultado:", result);

// ----- normalização: actor -> formato canônico -----
function normalizar(it) {
  if (!it) return null;
  const id = it.id || it.listingId || it.url?.match(/(\d+)(?:\.html|$)/)?.[1];
  if (!id) return null;
  return {
    id: `olx-${id}`,
    source: "OLX Imoveis",
    url: it.url,
    title: it.title,
    transactionType: it.operation === "rent" ? "rent" : "sale",
    propertyType: it.category || it.propertyType,
    propertySubType: it.subCategory || null,
    price: it.price,
    priceFormatted: it.priceFormatted || (it.price ? `R$ ${it.price.toLocaleString("pt-BR")}` : null),
    condominiumFee: it.condominiumFee ?? null,
    iptu: it.iptu ?? null,
    pricePerSqm: it.area && it.price ? +(it.price / it.area).toFixed(2) : null,
    area: it.area ?? null,
    bedrooms: it.bedrooms ?? null,
    bathrooms: it.bathrooms ?? null,
    parkingSpaces: it.parkingSpaces ?? null,
    amenities: it.amenities || null,
    complexAmenities: it.complexAmenities || null,
    neighborhood: it.neighborhood || null,
    city: it.city || null,
    state: it.state || null,
    images: it.images || [],
    imageCount: it.images?.length ?? 0,
    publishedAt: it.publishedAt || null,
    scrapedAt: new Date().toISOString()
  };
}

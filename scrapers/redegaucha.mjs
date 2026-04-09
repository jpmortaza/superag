// Scraper real para https://www.redegauchadeimoveis.com.br/
//
// Estratégia:
//   1. Baixa os sitemaps sitemap-imoveis[-2|-3].xml — juntos listam TODOS os
//      imóveis ativos (~22k URLs).
//   2. Para cada URL, faz GET do HTML e extrai o payload RSC (Next.js App
//      Router) embutido em `self.__next_f.push([1,"..."])`. O payload contém
//      o objeto do imóvel com endereço, preço, áreas, etc.
//   3. Normaliza para o formato canônico de upsert_imovel.
//
// O RSC usa referências tipo `"address":"$41"` — precisamos parsear todos
// os blocos `ID:JSON` do stream e resolver essas referências.
//
// O site NÃO oferece RSS (/imoveis.rss responde HTML do SPA). Sitemaps + RSC
// são o caminho mais limpo e completo.

import { request } from "undici";
import { upsertMany } from "./lib/supabase.mjs";

const BASE = "https://www.redegauchadeimoveis.com.br";
const SITEMAPS = [
  `${BASE}/sitemap-imoveis.xml`,
  `${BASE}/sitemap-imoveis-2.xml`,
  `${BASE}/sitemap-imoveis-3.xml`
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchText(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await request(url, {
        headers: { "user-agent": UA, accept: "text/html,*/*" },
        bodyTimeout: 30_000,
        headersTimeout: 15_000
      });
      if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}`);
      return await res.body.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------
async function collectSitemapUrls() {
  const urls = [];
  for (const sm of SITEMAPS) {
    try {
      const xml = await fetchText(sm);
      const matches = xml.match(/<loc>([^<]+)<\/loc>/g) ?? [];
      for (const m of matches) {
        const u = m.slice(5, -6).trim();
        if (u.includes("/imovel/")) urls.push(u);
      }
    } catch (e) {
      console.warn(`  sitemap ${sm}: ${e.message}`);
    }
  }
  return urls;
}

// ---------------------------------------------------------------------------
// RSC parser
// ---------------------------------------------------------------------------
function extractRscStream(html) {
  // O conteúdo é uma string JSON escapada. JSON.parse resolve tudo,
  // inclusive utf-8 (o payload usa \xHH para bytes utf-8 — mas o RSC usa
  // escape JSON padrão, então \uXXXX ou literais utf-8 direto).
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let out = "";
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      out += JSON.parse(`"${m[1]}"`);
    } catch {
      /* ignora bloco malformado */
    }
  }
  return out;
}

function scanJsonEnd(s, start) {
  // Scan balanceado a partir de s[start]. Retorna índice *após* o fim.
  const first = s[start];
  if (first === '"') {
    // string
    let j = start + 1;
    let e = false;
    for (; j < s.length; j++) {
      const c = s[j];
      if (e) {
        e = false;
        continue;
      }
      if (c === "\\") {
        e = true;
        continue;
      }
      if (c === '"') return j + 1;
    }
    return -1;
  }
  if (first !== "{" && first !== "[") return -1;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function parseRscDefs(stream) {
  // Definições no formato `<hex>:<valorJson>` concatenadas.
  const defs = {};
  const headerRe = /([0-9a-f]+):/g;
  let m;
  while ((m = headerRe.exec(stream)) !== null) {
    const start = m.index + m[0].length;
    if (start >= stream.length) break;
    const ch = stream[start];
    if (ch !== "{" && ch !== "[" && ch !== '"') continue;
    const end = scanJsonEnd(stream, start);
    if (end < 0) continue;
    const raw = stream.slice(start, end);
    try {
      defs[m[1]] = JSON.parse(raw);
      headerRe.lastIndex = end;
    } catch {
      continue;
    }
  }
  return defs;
}

function resolveRefs(value, defs, seen = new Set(), depth = 0) {
  if (depth > 12) return value;
  if (typeof value === "string" && value.startsWith("$") && value.length > 1) {
    const key = value.slice(1);
    if (seen.has(key)) return null;
    if (defs[key] !== undefined) {
      seen.add(key);
      const resolved = resolveRefs(defs[key], defs, seen, depth + 1);
      seen.delete(key);
      return resolved;
    }
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveRefs(v, defs, seen, depth + 1));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveRefs(v, defs, seen, depth + 1);
    }
    return out;
  }
  return value;
}

function findPropertyObject(defs) {
  for (const v of Object.values(defs)) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      "code" in v &&
      "address" in v &&
      "contracts" in v &&
      "bedrooms" in v
    ) {
      return v;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------
function moneyToNumber(m) {
  // { currency: "R$", value: 23320000 } — value em centavos
  if (!m || typeof m !== "object") return null;
  if (m.value == null || m.value === 0) return null;
  return Number(m.value) / 100;
}

function areaToNumber(a) {
  if (!a || typeof a !== "object") return null;
  return a.value != null ? Number(a.value) : null;
}

function formatEndereco(addr) {
  if (!addr) return null;
  const parts = [addr.street, addr.number, addr.neighborhood, addr.city, addr.state]
    .filter((s) => s && String(s).trim().length > 0);
  return parts.length ? parts.join(", ") : null;
}

function normalizarImagens(images) {
  if (!Array.isArray(images)) return [];
  const urls = [];
  for (const img of images) {
    if (!img || typeof img !== "object") continue;
    const src = img.src || img.url || img.image;
    if (typeof src === "string" && src.startsWith("http")) urls.push(src);
  }
  return urls;
}

function normalizarImovel(prop, url) {
  const code = prop.code || String(prop.id ?? "");
  const address = prop.address ?? {};
  const coord = address.coordinate ?? {};
  const contracts = Array.isArray(prop.contracts) ? prop.contracts : [];

  const primary =
    contracts.find((c) => c && c.price && c.price.value) ?? contracts[0] ?? null;

  let transactionType = null;
  if (primary?.id === 1) transactionType = "sale";
  else if (primary?.id === 2) transactionType = "rent";

  const price = primary ? moneyToNumber(primary.price) : null;
  const totalPrice = primary ? moneyToNumber(primary.totalPrice) : null;

  const area =
    areaToNumber(prop.privateArea) ??
    areaToNumber(prop.usefulArea) ??
    areaToNumber(prop.totalArea);
  const iptuMes = moneyToNumber(prop.iptu);
  const condoMes = moneyToNumber(prop.condominiumValue);

  return {
    id: `rgi-${code}`,
    source: "Rede Gaucha de Imoveis",
    url,
    title: prop.title ?? prop.shortTitle ?? "",
    transactionType,
    propertyType: prop.type ?? null,
    propertySubType: null,

    price,
    priceFormatted:
      price != null
        ? `R$ ${price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
        : null,
    condominiumFee: condoMes,
    iptu: iptuMes,
    pricePerSqm: price && area ? Number((price / area).toFixed(2)) : null,

    area,
    bedrooms: prop.bedrooms ?? null,
    bathrooms: prop.bathrooms ?? null,
    parkingSpaces: prop.garage ?? null,

    endereco: formatEndereco(address),
    enderecoNumero: address.number ?? null,
    complemento: address.complement ?? null,
    cep: address.zipCode ?? null,
    latitude: coord.latitude != null ? Number(coord.latitude) : null,
    longitude: coord.longitude != null ? Number(coord.longitude) : null,

    neighborhood: address.neighborhood ?? null,
    city: address.city ?? null,
    state: address.state ?? null,

    images: normalizarImagens(prop.images),
    imageCount: Array.isArray(prop.images) ? prop.images.length : 0,

    totalPrice,
    scrapedAt: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------
export function parsePropertyHtml(html, url) {
  const stream = extractRscStream(html);
  if (!stream) return null;
  const defs = parseRscDefs(stream);
  const main = findPropertyObject(defs);
  if (!main) return null;
  const resolved = resolveRefs(main, defs);
  return normalizarImovel(resolved, url);
}

async function fetchAndParse(url) {
  const html = await fetchText(url);
  const item = parsePropertyHtml(html, url);
  if (!item) throw new Error("sem payload RSC reconhecível");
  return item;
}

/**
 * Executa o scraper. Opções:
 *   config.maxItems    → limite total (default: 50)
 *   config.concurrency → requisições paralelas (default: 4)
 *   config.urls        → lista fixa de URLs (ignora sitemap)
 */
export async function run(config = {}) {
  const maxItems = Number(config.maxItems ?? 50);
  const concurrency = Math.max(1, Number(config.concurrency ?? 4));

  let urls;
  if (Array.isArray(config.urls) && config.urls.length > 0) {
    urls = config.urls;
  } else {
    console.log("Coletando URLs dos sitemaps...");
    urls = await collectSitemapUrls();
    console.log(`  ${urls.length} URLs encontradas`);
  }
  if (maxItems > 0 && urls.length > maxItems) urls = urls.slice(0, maxItems);

  const results = [];
  let cursor = 0;
  let done = 0;
  let errs = 0;

  async function worker() {
    while (cursor < urls.length) {
      const idx = cursor++;
      const url = urls[idx];
      try {
        const item = await fetchAndParse(url);
        results.push(item);
        done++;
        if (done % 25 === 0) {
          console.log(`  ${done}/${urls.length} ok, ${errs} erros`);
        }
      } catch (e) {
        errs++;
        if (errs <= 5) console.warn(`  ✗ ${url}: ${e.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`Total: ${results.length} imóveis coletados (${errs} erros)`);
  return results;
}

// Execução standalone (node redegaucha.mjs)
if (import.meta.url === `file://${process.argv[1]}`) {
  const itens = await run({ maxItems: Number(process.env.MAX_ITEMS ?? 20) });
  const result = await upsertMany(itens);
  console.log("Resultado:", result);
}

// Worker: consome extracoes em status "queued" e executa o scraper
// adequado para cada fonte (por enquanto: custom_http via scraper dedicado).
// Uso:
//   node worker.mjs              # processa todas as queued
//   node worker.mjs <fonte-slug> # processa só as da fonte informada
import "dotenv/config";
import { supabase, upsertMany } from "./lib/supabase.mjs";

const filterSlug = process.argv[2];

async function fetchQueued() {
  let q = supabase
    .from("extracoes")
    .select("id, fonte_id, params, fontes(slug, nome, tipo, url_base, config)")
    .eq("status", "queued")
    .order("triggered_at", { ascending: true });

  const { data, error } = await q;
  if (error) throw error;

  if (!filterSlug) return data ?? [];
  return (data ?? []).filter((e) => e.fontes?.slug === filterSlug);
}

async function marcarRunning(id) {
  await supabase
    .from("extracoes")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", id);
}

async function marcarResultado(id, r) {
  await supabase
    .from("extracoes")
    .update({
      status: r.ok ? "ok" : "error",
      finished_at: new Date().toISOString(),
      duracao_ms: r.duracaoMs,
      total_encontrados: r.totalEncontrados ?? 0,
      total_novos: r.totalNovos ?? 0,
      total_atualizados: r.totalAtualizados ?? 0,
      total_erros: r.totalErros ?? 0,
      erro_msg: r.erro ?? null,
      log: r.log ?? null
    })
    .eq("id", id);
}

async function rodarCustomHttp(fonte) {
  // dispatch por slug — cada scraper custom é um módulo próprio
  if (fonte.slug === "rgi-poa") {
    const mod = await import("./redegaucha.mjs");
    return await mod.run?.(fonte.config ?? {});
  }
  throw new Error(`Nenhum scraper custom_http cadastrado para slug "${fonte.slug}"`);
}

async function main() {
  const jobs = await fetchQueued();
  console.log(`${jobs.length} jobs queued`);

  for (const job of jobs) {
    const fonte = job.fontes;
    if (!fonte) continue;
    console.log(`→ ${fonte.slug} (${fonte.tipo})  job=${job.id}`);

    const start = Date.now();
    await marcarRunning(job.id);

    try {
      let items = [];
      if (fonte.tipo === "custom_http") {
        items = await rodarCustomHttp(fonte);
      } else {
        throw new Error(`tipo ${fonte.tipo} não suportado pelo worker`);
      }

      const up = await upsertMany(items);
      await marcarResultado(job.id, {
        ok: true,
        duracaoMs: Date.now() - start,
        totalEncontrados: items.length,
        totalNovos: up.ok,
        totalErros: up.fail
      });
      console.log(`  ✓ ${items.length} items  (ok=${up.ok} fail=${up.fail})`);
    } catch (e) {
      console.error(`  ✗ ${e.message}`);
      await marcarResultado(job.id, {
        ok: false,
        duracaoMs: Date.now() - start,
        erro: e.message
      });
    }
  }

  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

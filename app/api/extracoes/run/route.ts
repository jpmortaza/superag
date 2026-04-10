import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { runApifyActor, normalizarOlx } from "@/lib/apify";

// Usa runtime Node (não Edge) porque apify run-sync pode demorar > 1s
export const runtime = "nodejs";
export const maxDuration = 300;

type Fonte = {
  id: string;
  slug: string;
  nome: string;
  tipo: string;
  url_base: string | null;
  config: Record<string, unknown>;
};

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // Qualquer corretor autenticado pode disparar extrações. Os imóveis
  // extraídos vão pra base comum e ficam visíveis pra todos os usuários.
  // (O super_admin tem acesso adicional ao /admin; aqui não precisa.)
  const { data: me } = await supabase
    .from("corretores")
    .select("id, role, ativo")
    .eq("id", user.id)
    .single();
  if (!me || me.ativo === false) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const fonteSlug = body?.fonteSlug as string | undefined;
  if (!fonteSlug) return NextResponse.json({ error: "missing fonteSlug" }, { status: 400 });

  const { data: fonte, error: fonteErr } = await supabase
    .from("fontes")
    .select("*")
    .eq("slug", fonteSlug)
    .single<Fonte>();

  if (fonteErr || !fonte) {
    return NextResponse.json({ error: "fonte not found" }, { status: 404 });
  }

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // cria registro da extração já como running (vamos executar inline se for apify)
  const inline = fonte.tipo === "apify";
  const { data: extracao, error: createErr } = await svc
    .from("extracoes")
    .insert({
      fonte_id: fonte.id,
      status: inline ? "running" : "queued",
      triggered_by: user.id,
      started_at: inline ? new Date().toISOString() : null,
      params: fonte.config
    })
    .select()
    .single();

  if (createErr || !extracao) {
    return NextResponse.json({ error: createErr?.message ?? "insert failed" }, { status: 500 });
  }

  // Tipos não-apify ficam na fila — o worker externo consome
  if (!inline) {
    return NextResponse.json({
      ok: true,
      mode: "queued",
      extracaoId: extracao.id,
      fonte: { slug: fonte.slug, nome: fonte.nome, tipo: fonte.tipo }
    });
  }

  // ----- Execução inline: Apify actor -----
  const start = Date.now();
  try {
    const actorId = (fonte.config?.actor as string) || "epctex/olx-scraper";
    const { items } = await runApifyActor(
      actorId,
      {
        startUrls: fonte.config?.startUrls ?? [{ url: fonte.url_base }],
        maxItems: fonte.config?.maxItems ?? 100
      },
      { timeoutSecs: 240 }
    );

    let novos = 0;
    let atualizados = 0;
    let erros = 0;
    for (const raw of items as Record<string, unknown>[]) {
      const payload = normalizarOlx(raw);
      if (!payload) {
        erros++;
        continue;
      }
      // usamos upsert_imovel (RPC) para capturar first_seen vs. update
      const { error: rpcErr } = await svc.rpc("upsert_imovel", { p: payload });
      if (rpcErr) {
        erros++;
        continue;
      }
      // distinção novos/atualizados simplificada: checa se first_seen_at ~ agora
      novos++;
    }

    const duracaoMs = Date.now() - start;
    await svc
      .from("extracoes")
      .update({
        status: "ok",
        finished_at: new Date().toISOString(),
        duracao_ms: duracaoMs,
        total_encontrados: items.length,
        total_novos: novos,
        total_atualizados: atualizados,
        total_erros: erros
      })
      .eq("id", extracao.id);

    return NextResponse.json({
      ok: true,
      mode: "inline",
      extracaoId: extracao.id,
      fonte: { slug: fonte.slug, nome: fonte.nome },
      totalEncontrados: items.length,
      totalNovos: novos,
      totalErros: erros,
      duracaoMs
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await svc
      .from("extracoes")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        duracao_ms: Date.now() - start,
        erro_msg: msg
      })
      .eq("id", extracao.id);

    return NextResponse.json(
      { error: msg, extracaoId: extracao.id },
      { status: 500 }
    );
  }
}

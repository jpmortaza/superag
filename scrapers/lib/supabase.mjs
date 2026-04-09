import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

/**
 * Faz upsert de um imóvel via RPC public.upsert_imovel(jsonb).
 * Espera o payload já no formato camelCase descrito em registro.md.
 */
export async function upsertImovel(payload) {
  const { data, error } = await supabase.rpc("upsert_imovel", { p: payload });
  if (error) throw error;
  return data;
}

export async function upsertMany(items) {
  let ok = 0;
  let fail = 0;
  for (const item of items) {
    try {
      await upsertImovel(item);
      ok++;
    } catch (e) {
      fail++;
      console.error("upsert fail", item.id, e.message);
    }
  }
  return { ok, fail, total: items.length };
}

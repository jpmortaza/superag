// Job diário: chama public.distribuir_imoveis_do_dia() no Supabase.
// Pode ser agendado em cron / GitHub Actions / Vercel cron.
import { supabase } from "./lib/supabase.mjs";

const dia = process.argv[2] || new Date().toISOString().slice(0, 10);

console.log(`Distribuindo imóveis do dia ${dia}...`);
const { data, error } = await supabase.rpc("distribuir_imoveis_do_dia", { p_dia: dia });

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(`OK — ${data} imóveis distribuídos.`);

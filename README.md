# ImovelMap

Plataforma de agenciamento de imóveis: mapa público com os imóveis disponíveis na cidade e ferramentas para corretores encontrarem o proprietário e oferecerem agenciamento.

Site: https://imovelmap.com

## Stack
- Next.js 14 (App Router) + TypeScript
- Supabase (Auth + Postgres + RLS)
- Deploy: Vercel

## Setup local
```bash
cp .env.local.example .env.local
npm install
npm run dev
```

## Banco de dados
Rodar o arquivo `../supabase/schema.sql` no SQL Editor do Supabase
(projeto `wtpbewcneuxicnxyoppj`).

## Variáveis de ambiente
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (somente backend / scraper)

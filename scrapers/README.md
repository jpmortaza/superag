# Scrapers — ImovelMap

Scripts Node.js que populam a tabela `imoveis` no Supabase.

## Setup
```bash
cp .env.example .env
# preencha SUPABASE_SERVICE_ROLE_KEY e APIFY_TOKEN
npm install
```

## Rodando

### OLX (via Apify)
```bash
npm run olx:apify
```
Define o actor da Apify em `APIFY_ACTOR_ID` (ex: `epctex/olx-scraper`).

### Rede Gaúcha de Imóveis (custom)
```bash
npm run redegaucha
```
Lê os sitemaps `sitemap-imoveis[-2|-3].xml` (~22k URLs) e extrai o payload
RSC do Next.js (`self.__next_f.push`) de cada página — endereço, CEP,
lat/long, preço, áreas e imagens. Variável `MAX_ITEMS` controla o limite.

### Distribuição diária
```bash
npm run distribuir            # distribui imóveis do dia atual
npm run distribuir 2026-04-09 # ou de uma data específica
```
Roda a função `public.distribuir_imoveis_do_dia()` no Supabase, que aloca
os imóveis novos do dia entre os corretores ativos via round-robin. Os
imóveis ficam como `pending` na tabela `distribuicoes`. O frontend, ao
chamar `get_lease_atual()`, promove `pending` → `leased` em lotes de 2.
```

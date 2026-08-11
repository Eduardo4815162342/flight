# ✈️ BSB Price Track

Monitora passagens aéreas, tendências de preço e notícias de milhas, com bot Telegram multiusuário, dashboard web, assinatura/trial e relatórios inteligentes. O bot roda 24/7 via webhook no Railway, enquanto os rastreadores e relatórios agendados rodam via GitHub Actions.

## Funcionalidades

- 🔍 **Múltiplos destinos** — busca BSB→GRU, BSB→SDL, BSB→FOR de uma vez
- 🔁 **Múltiplas origens** — `ORIGINS=BSB,GRU` varre todas as combinações nos dois sentidos (útil para quem viajou e quer monitorar a volta)
- 🗓️ **Intervalo de datas** — varre N dias a partir da data de saída e alerta a data mais barata
- 📅 **Offset de data** — `DEPARTURE_DATE_OFFSET=7` busca sempre "daqui 7 dias", sem precisar atualizar manualmente
- ✈️ **Somente ida ou ida e volta** — configurável por variável de ambiente
- 👥 **Configuração de passageiros** — suporte a múltiplos adultos e crianças
- 🔄 **Retry com backoff & Rotação de Tokens** — tenta Apify até 3x e rotaciona entre até 5 tokens se os créditos acabarem
- 💾 **Histórico Turso** — salva cada busca no banco libSQL/Turso com pruning automático configurável
- 📊 **Relatório Semanal** — resumo automático dos melhores preços da semana enviado aos domingos
- 🧠 **Inteligência diária** — relatório Markdown/JSON com score de oportunidade, recomendação de compra/espera e rotas com dados insuficientes
- 🤖 **Bot Interativo (Webhook)** — comandos para busca em tempo real e consulta de histórico
- 🧳 **Concierge IA (`/perguntar`)** — responde se vale comprar agora usando histórico real, busca ao vivo e OpenRouter
- 🧮 **Calculadora de CPM (`/cpm`)** — compara passagem cash vs. milhas usando preço informado ou busca ao vivo
- 👥 **Multiusuário + autorização inline** — novos usuários ficam pendentes e o admin autoriza/recusa por botões no Telegram
- 💳 **Trial, assinatura e Cakto** — usuários autorizados ganham teste grátis; pagamentos/renovações/cancelamentos podem ser sincronizados por webhook da Cakto
- 🛡️ **Anti-spam configurável** — só envia alerta se o preço cair ≥ X% (padrão 5%, configurável via `PRICE_DROP_THRESHOLD`)
- ⚙️ **Filtros Avançados** — filtre por companhias aéreas, máximo de escalas e duração do voo
- 💵 **Conversão Dinâmica** — converte preços de USD/outras moedas para BRL em tempo real via API
- 📰 **Notícias de Milhas com IA** — monitora feeds (Passageiro de Primeira) e usa **IA (Claude via OpenRouter)** para resumir os artigos automaticamente
- 🏷️ **Ofertas do Dia** — busca ofertas de passagens e pacotes no feed "Quero Viajar na Faixa"
- 💚 **Health check diário** — envia uma mensagem no Telegram confirmando que o tracker rodou
- 🔒 **Webhook seguro** — comandos aceitos apenas do `TELEGRAM_CHAT_ID` autorizado
- 📊 **Gráficos Inline no Telegram** — O comando `/tendencia` gera e envia imagens interativas de linhas via QuickChart.io mapeando o histórico dos últimos 30 dias de preços.
- 🚨 **Detector de Erro de Tarifa (Glitch)** — Interceptador estatístico para quedas de preços extremas, contornando tetos configurados para não perder passagens promocionais e bugs.
- 🎨 **SaaS Dashboard (Google Blog Style)** — Painel web moderno, responsivo e baseado nas diretrizes visuais do *Google Keyword Blog* (Material Design 3) com suporte a tema Claro e Escuro persistente.
- 🔒 **Autenticação HMAC Telegram & Cookies** — Validação criptográfica HMAC-SHA256 direta das credenciais assinadas pelo Telegram e segurança de sessão por cookies `HttpOnly`/`SameSite`.
- 📡 **Radar inteligente personalizado** — resumo diário por usuário com recomendação para comprar, esperar, monitorar, ajustar alerta ou agir rápido em possível erro de tarifa.
- 🧪 **Testes com cobertura** — CI roda typecheck e Jest com thresholds definidos em `package.json`

---

## Stack

- **Node.js 22 + TypeScript**
- **APIs**: Apify (primária) → RapidAPI/Skyscanner (fallback)
- **IA**: OpenRouter para resumos de notícias e concierge de viagem
- **Persistência**: Turso/libSQL para usuários, alertas, histórico, notícias vistas, uso de IA e assinaturas
- **Notificações**: Telegram Bot
- **Servidor 24/7**: Railway webhook (`src/webhook.ts`)
- **CI/CD**: GitHub Actions — rastreadores, relatórios, dashboard e testes

---

## Setup

### 1. Clone e instale

```bash
git clone https://github.com/seu-usuario/bsb-price-track.git
cd bsb-price-track
npm install
```

### 2. Configure o `.env`

```bash
cp .env.example .env
```

Edite o `.env` com suas credenciais (veja a tabela abaixo).

### 3. Rode localmente

```bash
npm run dev
```

### 4. Rode os testes

```bash
npm test              # apenas testes
npm test -- --coverage  # testes + relatório de cobertura
```

> **Requisito**: Node.js 22 ou superior.

---

## Variáveis de Ambiente

### Obrigatórias

| Variável | Descrição |
|---|---|
| `APIFY_API_TOKEN_1` | Token primário da API do Apify |
| `RAPIDAPI_KEY` | Chave da RapidAPI (fallback) |
| `TELEGRAM_BOT_TOKEN` | Token do bot no Telegram |
| `TELEGRAM_CHAT_ID` | ID do chat/grupo para receber alertas |
| `TURSO_DATABASE_URL` | URL do banco Turso/libSQL |
| `TURSO_AUTH_TOKEN` | Token de autenticação do Turso |
| `DESTINATIONS` | Destinos separados por vírgula (ex: `GRU,SDL,FOR`) |
| `OPENROUTER_API_KEY` | (Opcional) Chave da OpenRouter para resumos de notícias com IA |
| `CAKTO_WEBHOOK_SECRET` | (Opcional, recomendado) Segredo para validar chamadas da Cakto em `/webhooks/cakto` |

### Opcionais

| Variável | Padrão | Descrição |
|---|---|---|
| `DEPARTURE_DATE` | — | Data de ida fixa no formato `YYYY-MM-DD`. Tem prioridade sobre `DEPARTURE_DATE_OFFSET`. |
| `DEPARTURE_DATE_OFFSET` | `0` | Dias a partir de hoje para calcular a data de ida automaticamente. Ex: `7` = sempre daqui 7 dias. |
| `ORIGIN` | `BSB` | Código IATA de origem (única) |
| `ORIGINS` | — | Múltiplas origens separadas por vírgula (ex: `BSB,GRU`). Tem prioridade sobre `ORIGIN`. Varre todas as combinações origem→destino nos dois sentidos, ignorando pares onde origem = destino. |
| `TRIP_TYPE` | `one-way` | Tipo de viagem: `one-way` ou `round-trip` |
| `RETURN_DATE` | — | Data de volta `YYYY-MM-DD` (**obrigatório** se `TRIP_TYPE=round-trip`) |
| `DATE_RANGE_DAYS` | `1` | Quantos dias varrer a partir da data de partida |
| `ADULTS` | `1` | Número de passageiros adultos |
| `CHILDREN` | `0` | Número de passageiros crianças |
| `MAX_PRICE_BRL` | `300` | Threshold máximo em reais |
| `PRICE_DROP_THRESHOLD` | `0.95` | Fator de queda para acionar o alerta (0.95 = queda de 5%). Ex: `0.90` para alertar só com queda ≥ 10%. |
| `PRICE_ERROR_THRESHOLD` | `0.45` | Queda mínima vs. média recente para destacar possível erro de tarifa no tracker e no radar personalizado. |
| `HISTORY_RETENTION_DAYS` | `365` | Quantos dias de histórico manter. Entradas mais antigas são removidas automaticamente. |
| `WEBHOOK_PORT` | `3000` | Porta para o servidor de webhook do bot |
| `TRIAL_DAYS` | `7` | Duração do teste grátis ao autorizar um usuário |
| `CAKTO_ACCESS_DAYS` | `30` | Dias liberados por compra/renovação da Cakto quando o payload não informar duração |
| `AI_DAILY_LIMIT` | `10` | Limite de perguntas ao concierge IA por usuário nas últimas 24h |
| `AIRLINES_WHITELIST` | — | Lista de companhias (ex: `LATAM,GOL`) |
| `MAX_STOPS` | — | Máximo de escalas (0 = direto) |
| `MAX_DURATION_HOURS`| — | Duração máxima do voo em horas |
| `APIFY_API_TOKEN_2..5`| — | Tokens adicionais para rotação (opcional) |
| `APIFY_ACTOR_ID` | `johnvc~google-flights...` | Actor ID do Apify |
| `RAPIDAPI_HOST` | `sky-scrapper.p.rapidapi.com` | Host da RapidAPI |

### Data de partida — precedência

```
DEPARTURE_DATE definido  →  usa essa data
DEPARTURE_DATE_OFFSET=7  →  busca sempre daqui 7 dias (recalculado em cada run)
nenhum dos dois          →  busca para hoje
```

### Exemplo de `.env`

```env
APIFY_API_TOKEN_1=apify_api_xxxxx
RAPIDAPI_KEY=xxxxx
TELEGRAM_BOT_TOKEN=123456:ABC-xxxxx
TELEGRAM_CHAT_ID=-100xxxxxxxx
TURSO_DATABASE_URL=libsql://seu-banco.turso.io
TURSO_AUTH_TOKEN=seu-token
OPENROUTER_API_KEY=sk-or-v1-xxxxx

ORIGIN=BSB
DESTINATIONS=GRU,SDL,FOR
DEPARTURE_DATE_OFFSET=7
TRIP_TYPE=round-trip
RETURN_DATE=2026-07-20
DATE_RANGE_DAYS=7
MAX_PRICE_BRL=400
PRICE_DROP_THRESHOLD=0.90
HISTORY_RETENTION_DAYS=180
```

---

## GitHub Actions

### Monitor gratuito para a viagem de Marselha

O workflow `free-flight-tracker.yml` usa a biblioteca open source `fast-flights` para consultar o Google Flights sem Apify, RapidAPI ou outro serviço pago. Ele roda duas vezes ao dia no GitHub Actions, salva o histórico em `data/free-flight-history.json` e envia alertas pelo Telegram.

Configure em **Settings → Secrets and variables → Actions**:

- Secrets: `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`.
- Variables opcionais: `FLIGHT_ORIGINS`, `FLIGHT_ARRIVAL_AIRPORTS`, `FLIGHT_RETURN_AIRPORTS` e `FLIGHT_MAX_PRICE_BRL`.

Os padrões já estão preparados para a viagem: `GRU,VCP`, chegada e retorno por `MRS,NCE,LYS,BCN,MAD,LIS,OPO,CDG,ORY`, ida de 2 a 7 de janeiro de 2027 e volta de 16 a 19 de janeiro de 2027. A consulta é não-oficial e pode precisar de manutenção se o Google alterar o formato dos resultados. Para Barcelona, Madrid, Lisboa, Porto e Paris, confira o deslocamento terrestre até Marselha antes de comprar.

### Secrets necessários

Vá em **Settings → Secrets and variables → Actions → Secrets** e adicione:

| Secret | Obrigatório |
|---|---|
| `APIFY_API_TOKEN_1` | ✅ |
| `RAPIDAPI_KEY` | ✅ |
| `TELEGRAM_BOT_TOKEN` | ✅ |
| `TELEGRAM_CHAT_ID` | ✅ |
| `TURSO_DATABASE_URL` | ✅ |
| `TURSO_AUTH_TOKEN` | ✅ |
| `OPENROUTER_API_KEY` | recomendado |
| `CAKTO_WEBHOOK_SECRET` | se usar Cakto |

### Variables necessárias

Vá em **Settings → Secrets and variables → Actions → Variables** e adicione:

| Variable | Obrigatório | Exemplo |
|---|---|---|
| `DESTINATIONS` | ✅ | `GRU,SDL,FOR` |
| `DEPARTURE_DATE_OFFSET` | recomendado | `7` |
| `DEPARTURE_DATE` | opcional (fixo) | `2026-07-10` |
| `TRIP_TYPE` | opcional | `one-way` |
| `RETURN_DATE` | se round-trip | `2026-07-20` |
| `DATE_RANGE_DAYS` | opcional | `7` |
| `MAX_PRICE_BRL` | opcional | `400` |
| `ORIGIN` | opcional | `BSB` |
| `ORIGINS` | opcional | `BSB,GRU` |
| `PRICE_DROP_THRESHOLD` | opcional | `0.90` |
| `PRICE_ERROR_THRESHOLD` | opcional | `0.45` |
| `HISTORY_RETENTION_DAYS` | opcional | `365` |
| `APIFY_ACTOR_ID` | opcional | — |
| `RAPIDAPI_HOST` | opcional | — |

### Workflows

| Workflow | Gatilho | O que faz |
|---|---|---|
| `ci.yml` | Push e Pull Request | Roda typecheck + testes com coverage |
| `check-flights.yml` | Cron 08h/20h BRT + manual | Busca voos, envia alertas e salva histórico no Turso |
| `check-news.yml` | Cron 3x ao dia | Monitora notícias de milhas e pontos |
| `check-offers.yml` | Cron a cada 2 horas | Busca novas ofertas de passagens/viagens |
| `intelligence-report.yml` | Manual | Gera relatório de inteligência em Markdown/JSON quando acionado manualmente |
| `personalized-radar.yml` | Cron diário 09:15 BRT + manual | Envia um radar personalizado para cada usuário com alertas ativos |
| `deploy-dashboard.yml` | Cron diário 00:00 BRT + push em landing/dashboard | Gera dashboard estático e publica no GitHub Pages |
| `test-summarize.yml` | Manual | Smoke test da sumarização OpenRouter |

> Todos os workflows usam **Node.js 22**.

---

## Estrutura do Projeto

```
bsb-price-track/
├── src/
│   ├── index.ts                  # Entry point (Flight Tracker)
│   ├── index-news.ts             # Entry point (News/Miles)
│   ├── index-offers.ts           # Entry point (Offers)
│   ├── config.ts                 # Leitura e validação de env vars
│   ├── types.ts                  # Tipos TypeScript (Flight, SearchParams, etc.)
│   ├── apis/
│   │   ├── apify.ts              # Integração Apify (Google Flights scraper)
│   │   └── rapidapi.ts           # Integração RapidAPI/Skyscanner (fallback)
│   ├── services/
│   │   ├── tracker.ts            # Lógica principal: busca, retry, alertas
│   │   ├── news.ts               # Lógica de fetch e filtro de RSS (Milhas/Notícias)
│   │   ├── intelligence.ts       # Score de oportunidade, recomendação e relatórios diários
│   │   ├── personalizedRadar.ts  # Radar personalizado por usuário/alerta
│   │   ├── aiConcierge.ts        # /perguntar com histórico real + busca ao vivo + OpenRouter
│   │   ├── subscription.ts       # Trial, assinatura manual e acesso pago
│   │   ├── caktoWebhook.ts       # Webhook Cakto para ativação/cancelamento
│   │   ├── telegram.ts           # Envio de mensagens no Telegram
│   │   ├── currency.ts           # Conversão de moeda para BRL
│   │   ├── history.ts            # Leitura/escrita do histórico no Turso
│   │   ├── healthCheck.ts        # Health check diário no Telegram
│   │   ├── webhook.ts            # Lógica do servidor de webhook
│   │   └── weeklyReport.ts       # Geração de relatório semanal
│   ├── scripts/
│   │   ├── generate-dashboard.ts         # Gera HTML estático do dashboard
│   │   ├── generate-intelligence-report.ts # Gera relatórios Markdown/JSON
│   │   └── send-personalized-radar.ts    # Envia radar personalizado
│   ├── utils/
│   │   ├── retry.ts              # withRetry — backoff exponencial genérico
│   │   ├── dates.ts              # generateDateRange — gera intervalo de datas
│   │   ├── priceHistory.ts       # Tendência e melhor dia histórico
│   │   ├── cpm.ts                # Cálculo de centavo por milha
│   │   └── liveSearchCache.ts    # Cache TTL de buscas ao vivo
│   └── __tests__/                # Testes unitários (Jest)
├── data/
│   ├── history.db                # Legado local; produção usa Turso
│   ├── health.json               # Controle de health check diário
│   └── offers-seen.json          # Controle legado/local de ofertas já enviadas
├── landing/
│   ├── index.html                # Landing page
│   └── dashboard.html            # Dashboard autenticado com Telegram Login
├── .github/
│   └── workflows/
│       ├── ci.yml                # CI — testes em todo push/PR
│       ├── check-flights.yml     # Tracker de voos — cron 2x ao dia
│       ├── check-news.yml        # Tracker de notícias — cron 3x ao dia
│       ├── check-offers.yml      # Tracker de ofertas — cron a cada 2h
│       ├── intelligence-report.yml # Relatório diário de inteligência
│       ├── personalized-radar.yml  # Radar personalizado por usuário
│       └── deploy-dashboard.yml  # Deploy do dashboard no GitHub Pages
├── .gitattributes                # Marca *.db como binário (evita diff de texto no SQLite)
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Mensagens no Telegram

### Alerta de passagem barata (one-way)

```
✈️ Passagem barata encontrada!

🛫 BSB → GRU
🏷️ ✈️ Somente Ida
📅 Ida: 15/07/2026
🏢 LATAM
💰 R$ 249,90

🔗 Ver passagem
_Fonte: apify_
```

### Alerta de passagem barata (round-trip)

```
✈️ Passagem barata encontrada!

🛫 BSB → GRU
🏷️ 🔄 Ida e Volta
📅 Ida: 15/07/2026
📅 Volta: 22/07/2026
🏢 GOL
💰 R$ 589,00

🔗 Ver passagem
_Fonte: rapidapi_
```

### Resumo de intervalo de datas

```
🗓️ BSB→GRU (✈️ Somente Ida) — 7 data(s) verificada(s).
💰 Melhor: R$ 249,90 em 18/07/2026 (LATAM)
```

### Health check diário

```
💚 Tracker ativo — 25/03/2026, 08:05:12
```

### Relatório Semanal

Enviado automaticamente aos domingos, compara os preços atuais com os da semana anterior.

```
📊 Relatório Semanal de Passagens
📅 29/03/2026, 09:00:00

✈️ BSB → GRU
💰 Menor preço esta semana: R$ 249,90
📊 Semana anterior: R$ 270,00
📉 Variação: -7.4% (-R$ 20,10)

✈️ BSB → FOR
💰 Menor preço esta semana: R$ 450,00
📊 Semana anterior: sem dados
➡️ Tendência: sem dados suficientes para comparar

_14 verificação(ões) realizadas esta semana_
```

---

## Bot Interativo (Webhook)

O projeto conta com um servidor de webhook para responder a comandos diretamente no Telegram. O bot é privado, ignora grupos/supergrupos/canais e usa autorização multiusuário: o admin (`TELEGRAM_CHAT_ID`) é autoautorizado, novos usuários ficam pendentes e recebem liberação via botões inline.

### Comandos disponíveis

- `/start` — Cadastra o usuário, inicia o fluxo de aprovação e mostra comandos disponíveis.
- `/meuid` — Mostra o chat ID do Telegram.
- `/alerta ORIGEM DESTINO DATA PRECO` — Cria alerta de ida. Ex: `/alerta BSB GRU 20/07/2026 350`.
- `/alerta ORIGEM DESTINO DATA_IDA DATA_VOLTA PRECO` — Cria alerta ida e volta.
- `/meusalertas` — Lista alertas ativos, incluindo avisos de alertas expirados.
- `/editar ID NOVO_PRECO` — Atualiza o teto de preço de um alerta.
- `/remover ID` — Remove um alerta.
- `/buscar DESTINO`, `/buscar ORIGEM DESTINO` ou `/buscar ORIGEM DESTINO DATA` — Busca on-demand com `ignoreMaxPrice`, exibindo os voos mais baratos.
- `/tendencia ORIGEM DESTINO [DATA]` — Realiza uma análise estatística avançada e plota a evolução de preços dos últimos 30 registros da rota como um gráfico de linhas em formato Slate-800 Premium via **QuickChart.io**. A resposta é entregue em um balão integrado (gráfico + legenda) contendo:
  - **Direção e Variação**: Determina estatisticamente se a tendência é de alta, queda ou estabilidade nos últimos 7 dias.
  - **Preços Extremos**: Mostra o menor preço já capturado no histórico e o último preço monitorado.
  - **Dia Ideal de Compra**: Identifica o dia da semana estatisticamente mais barato para a rota com base na média aritmética histórica.
  - **Mecanismo de Resiliência**: Caso a API do QuickChart falhe ou estoure o timeout, o bot automaticamente faz fallback dinâmico para uma notificação baseada em texto.
- `/perguntar BSB GRU vale a pena comprar agora?` — Concierge IA que combina histórico, tendência, busca ao vivo, cache e OpenRouter para dar recomendação prática.
- `/cpm ORIGEM DESTINO MILHAS [PRECO_CASH]` — Calcula centavo por milha usando preço informado ou menor tarifa ao vivo.
- `/noticias` ou `/ofertas` — Liga/desliga recebimento de notícias e ofertas.
- `/assinatura` — Mostra status do trial/assinatura.
- `/status` — Mostra status do servidor (admin).
- `/autorizar ID`, `/ativar ID DIAS`, `/cancelar ID` — Administração de acesso e assinatura (admin).

### Como rodar o Bot

1. Configure a `WEBHOOK_PORT` no `.env` (padrão é 3000).
2. Exponha sua porta local (use `ngrok`, `cloudflare tunnel` ou deploy em servidor).
3. Configure o Webhook no Telegram:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<SUA_URL>`
4. Inicie o servidor:
   ```bash
   npm run webhook
   ```

---

## Filtros Avançados

Você pode refinar sua busca utilizando variáveis de ambiente para evitar alertas de voos indesejados.

- **Companhias Específicas**: Use `AIRLINES_WHITELIST=LATAM,GOL` para receber alertas apenas dessas empresas.
- **Voos Diretos**: Configure `MAX_STOPS=0` para ignorar voos com escalas.
- **Duração do Voo**: Use `MAX_DURATION_HOURS=5` para filtrar voos muito longos.

### Anti-Spam Configurável

Um novo alerta só é disparado para uma mesma rota e data se o preço atual for pelo menos X% menor que o menor preço encontrado na busca anterior. O percentual é configurável:

```env
PRICE_DROP_THRESHOLD=0.95   # alerta se cair ≥ 5% (padrão)
PRICE_DROP_THRESHOLD=0.90   # alerta só se cair ≥ 10%
PRICE_DROP_THRESHOLD=1.00   # sempre alerta (sem filtro)
```

---

## SaaS Web Dashboard & API REST

O projeto integra uma plataforma web completa baseada no design do *Google Blog (The Keyword)* (Material Design 3) alimentada por um microsserviço REST API nativo em Node.js.

### Arquitetura de Servidor Web Nativo
- **Zero-Dependency**: O servidor HTTP é implementado nativamente utilizando o módulo integrado `node:http`. Sem Express, Fastify ou dependências externas, garantindo tempos de inicialização nulos e altíssima eficiência de recursos em execuções serverless ou em containers leves.
- **Persistência Integrada**: Integração direta com Turso/libSQL para histórico, alertas, usuários, assinaturas, notícias vistas e uso do concierge IA.

### Segurança e Autenticação Criptográfica
- **Autenticação HMAC Telegram**: O fluxo de login é integrado com o widget oficial do Telegram. A autenticação das credenciais fornecidas no frontend (`id`, `first_name`, `username`, `auth_date`, `hash`) é checada no backend calculando o HMAC-SHA256 dos parâmetros ordenados alfabeticamente usando a chave derivada do `TELEGRAM_BOT_TOKEN` via hash SHA-256.
- **Tokens de Sessão Stateless (Sem Estado)**: Em vez de armazenar sessões em banco de dados, o servidor emite tokens autossuficientes e criptograficamente assinados. O token contém `id:firstName:username:timestamp` e uma assinatura HMAC-SHA256 baseada no `TELEGRAM_BOT_TOKEN`.
- **Cookies de Sessão Seguros**: O token é injetado via cabeçalho `Set-Cookie` com diretivas de restrição rigorosas: `HttpOnly` (impede interceptação por scripts e ataques XSS), `SameSite=Lax` (protege contra CSRF) e validade padrão de 30 dias.

### Endpoints da API REST
O backend mapeia rotas HTTP nativas baseadas no token de sessão recuperado dos cookies do cabeçalho da requisição:
- `GET /` — Serve a Landing Page interativa.
- `GET /dashboard` — Renderiza a página administrativa de controle de alertas do usuário autenticado.
- `GET /api/stats` — Agrega estatísticas gerais do Turso (`totalChecks`, menor preço, rotas ativas, usuários autorizados).
- `GET /api/history` — Retorna o histórico serializado de preços da rota filtrada para preenchimento de gráficos locais.
- `GET /api/alerts` — Lista todas as regras de monitoramento registradas para o usuário logado (com base no Telegram Chat ID extraído da sessão).
- `POST /api/alerts` — Cria um novo gatilho de monitoramento (`origin`, `destination`, `max_price_brl`, `departure_date`, `return_date`).
- `POST /api/alerts/update` — Atualiza os parâmetros (ex: teto máximo de preço) de um monitoramento ativo.
- `DELETE /api/alerts` — Exclui definitivamente um monitoramento cadastrado.
- `GET /api/auth/telegram` — Callback para validação criptográfica do widget de autenticação do Telegram.
- `GET /api/auth/logout` — Limpa o cookie de sessão do navegador.
- `POST /webhooks/cakto` — Recebe eventos da Cakto, valida segredo opcional e ativa/cancela assinaturas.

### UI Google Blog Style (Material 3) & Reatividade
- **CSS Avançado e Modular**: Layout inteiramente responsivo (Desktop/Mobile), com tipografia sofisticada importada via Google Fonts (Outfit & Inter), bordas suaves com blur (`backdrop-filter`), sombras elevadas e gradientes elegantes.
- **Prevenção de Flash de Estilo (FOUC)**: Script de validação de preferência de cores (`dark` vs `light` theme) injetado diretamente no `<head>` usando dados do `localStorage`, garantindo carregamento instantâneo do tema apropriado com zero flashes indesejados de luz.
- **Visualização Dinâmica com Chart.js**: Gráficos de linha do histórico renderizados de forma totalmente reativa. O tema do gráfico altera suas cores e paleta (eixos, linhas de grade translúcidas, tooltips e preenchimento de gradientes lineares) dinamicamente no cliente ao alternar o modo claro/escuro.

---

## Detector de Erro de Tarifa (Glitch Detector)

O tracker incorpora um algoritmo estatístico para identificar anomalias extremas nos preços de passagens aéreas, comumente conhecidas como "tarifas bugadas" ou bugs de sistema de emissão.

### Funcionamento do Algoritmo
1. **Coleta de Amostras Específicas**: Para cada voo localizado, o sistema consulta no Turso o histórico para a rota exata na data de partida solicitada (`getRoutePriceHistory(origin, destination, departure_date)`).
2. **Fallback por Amostragem Insuficiente**: O detector estatístico exige no mínimo $N \ge 3$ registros históricos para calcular a média. Se a data específica não contiver amostragem suficiente, o algoritmo automaticamente faz fallback para o histórico completo da rota (`getRoutePriceHistory(origin, destination)`).
3. **Cálculo de Desvio e Disparo**: Se houver dados suficientes ($\ge 3$), calcula a média aritmética simples (`avgPrice`). Um "Glitch" de preço é disparado caso:
   $$\text{Preço Atual BRL} \le \text{avgPrice} \times (1 - \text{PRICE\_ERROR\_THRESHOLD})$$
   O threshold padrão `PRICE_ERROR_THRESHOLD` é regulado via variável de ambiente em `0.45` (indicando queda superior a 45% sobre a média histórica).

### Mecanismo de Bypass de Regras (Priorização de Alerta)
Quando uma passagem é catalogada como Glitch, as restrições padrão de envio de notificações são alteradas dinamicamente:
- **Bypass de Teto de Preço**: O bot envia o alerta mesmo se o valor estiver acima do `max_price_brl` estipulado pelo usuário. Isso garante o monitoramento de passagens caras que normalmente estariam fora das configurações do usuário, mas que apresentaram descontos anômalos imperdíveis (ex: passagem de R$ 6.000,00 despencando para R$ 700,00).
- **Controle Anti-Spam Exclusivo**: Para não spamar buscas subsequentes que ainda apresentem o preço sob efeito do erro, o alerta de Glitch só será disparado novamente se o preço for estritamente menor do que a última tarifa anomalógica registrada.

---

## Inteligência e Radar Personalizado

Além dos alertas imediatos, o app gera inteligência sobre o histórico acumulado:

- `npm run intelligence` gera `reports/daily-intelligence.md` e `reports/daily-intelligence.json` com score de 0-100, recomendação (`comprar`, `monitorar`, `esperar`), média 30d, menor histórico, tendência 7d e rotas com dados insuficientes.
- `npm run radar` lê alertas ativos, cruza com o histórico da mesma rota/data e envia um resumo personalizado no Telegram para cada usuário elegível.
- O radar classifica cada alerta como `Comprar agora`, `Esperar`, `Monitorar`, `Criar/ajustar alerta` ou `Erro de tarifa provável`.
- Para usuários comuns, o radar respeita autorização + trial/assinatura ativa. Para o admin, alertas ativos são incluídos mesmo sem registro em `subscriptions`.
- O radar não chama Apify/RapidAPI; ele usa apenas dados já salvos no Turso, evitando custo extra de API.

---

## Fluxo de Busca

```
Para cada origem em ORIGINS:
  Para cada destino em DESTINATIONS (ignorando origem = destino):
    ├── Calcula data de partida (DEPARTURE_DATE > DEPARTURE_DATE_OFFSET > hoje)
    ├── Gera intervalo de datas (DATE_RANGE_DAYS)
    │
    ├── Se apenas 1 data:
    │   ├── Tenta Apify (até 3x com retry, rotação de tokens se 402/403)
    │   ├── Se falhar → tenta RapidAPI
    │   ├── Aplica filtros avançados
    │   ├── Salva no histórico Turso (pruning automático)
    │   └── Se abaixo do threshold E queda ≥ PRICE_DROP_THRESHOLD → envia alerta
    │
    └── Se múltiplas datas:
        ├── Para cada data: busca → filtra → salva
        ├── Encontra a data com o voo mais barato
        ├── Se abaixo do threshold E queda ≥ PRICE_DROP_THRESHOLD → envia alerta
        └── Envia resumo do intervalo
```

---

## Desenvolvimento

### Comandos úteis

```bash
npm run dev          # Executa o tracker de voos uma vez
npm run news         # Executa o tracker de notícias de milhas
npm run offers       # Executa o tracker de ofertas
npm run webhook      # Inicia o bot interativo via webhook
npm run dashboard    # Gera dist-pages/index.html para o dashboard estático
npm run intelligence # Gera relatórios diários Markdown/JSON em reports/
npm run radar        # Envia radar personalizado pelo Telegram
npm run typecheck    # Verifica tipos TypeScript
npm test             # Roda todos os testes
npm test -- --coverage  # Testes + relatório de cobertura
npm run build        # Compila TypeScript para dist/
npm run start:webhook # Inicia o bot compilado (production)
```

### Adicionando um novo destino

Basta adicionar o código IATA na variável `DESTINATIONS` (ou na Variable do GitHub):

```env
DESTINATIONS=GRU,SDL,FOR,CNF,VCP
```

### Configurando busca dinâmica de datas

```env
# Sempre busca daqui 14 dias, varrendo 7 dias
DEPARTURE_DATE_OFFSET=14
DATE_RANGE_DAYS=7
```

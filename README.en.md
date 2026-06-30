# ✈️ BSB Price Track

Monitors airfare, price trends, and miles news with a multi-user Telegram bot, web dashboard, trial/subscription access, and intelligent reports. The bot runs 24/7 as a Railway webhook, while scheduled trackers and reports run via GitHub Actions.

## Features

- 🔍 **Multiple Destinations** — Search BSB→GRU, BSB→SDL, BSB→FOR all at once.
- 🔁 **Multiple Origins** — `ORIGINS=BSB,GRU` scans all combinations in both directions (useful for return trip monitoring).
- 🗓️ **Date Range** — Scans N days from the departure date and alerts the cheapest date found.
- 📅 **Date Offset** — `DEPARTURE_DATE_OFFSET=7` always searches "7 days from now", no manual updates needed.
- ✈️ **One-way or Round-trip** — Configurable via environment variables.
- 👥 **Passenger Configuration** — Support for multiple adults and children.
- 🔄 **Retry with Backoff & Token Rotation** — Retries Apify up to 3 times and rotates between up to 5 tokens if credits run out.
- 💾 **Turso History** — Saves every search in the libSQL/Turso database with configurable automatic pruning.
- 📊 **Weekly Report** — Automatic summary of the best prices of the week sent on Sundays.
- 🧠 **Daily Intelligence** — Markdown/JSON report with opportunity score, buy/wait recommendation, and insufficient-data routes.
- 🤖 **Interactive Bot (Webhook)** — Commands for real-time search and history consultation.
- 🧳 **AI Concierge (`/perguntar`)** — Answers whether it is worth buying now using real history, live search, and OpenRouter.
- 🧮 **CPM Calculator (`/cpm`)** — Compares cash fares vs. miles using a provided cash price or live search.
- 👥 **Multi-user Authorization** — New users remain pending until the admin approves/rejects them with inline Telegram buttons.
- 💳 **Trial, Subscription, and Cakto** — Authorized users receive a free trial; Cakto webhooks can activate, renew, or cancel access.
- 🛡️ **Configurable Anti-spam** — Only sends an alert if the price drops ≥ X% (default 5%, configurable via `PRICE_DROP_THRESHOLD`).
- ⚙️ **Advanced Filters** — Filter by airlines, maximum stops, and flight duration.
- 💵 **Dynamic Conversion** — Converts prices from USD/other currencies to BRL in real-time via API.
- 📰 **AI-Powered Miles News** — Monitors feeds (Passageiro de Primeira) and uses **AI (Claude via OpenRouter)** to automatically summarize articles.
- 🏷️ **Daily Offers** — Searches for flight and travel deals in the "Quero Viajar na Faixa" feed.
- 💚 **Daily Health Check** — Sends a Telegram message confirming the tracker ran successfully.
- 🔒 **Secure Webhook** — Commands accepted only from the authorized `TELEGRAM_CHAT_ID`.
- 📊 **Telegram Inline Charts** — The `/tendencia` command generates and sends interactive line charts via QuickChart.io mapping the price history of the last 30 entries.
- 🚨 **Price Glitch Detector** — Statistical anomaly interceptor for extreme price drops, bypassing configured ceilings and thresholds to ensure promotion or bug airfares are not missed.
- 🎨 **SaaS Dashboard (Google Blog Style)** — Modern, responsive web dashboard based on the visual guidelines of *Google Blog (The Keyword)* (Material Design 3) with persistent Light and Dark theme support.
- 🔒 **HMAC Telegram Auth & Cookies** — Secure HMAC-SHA256 direct validation of credentials signed by Telegram and session persistence using `HttpOnly`/`SameSite` secure cookies.
- 📡 **Personalized Smart Radar** — Daily per-user summary recommending buy, wait, monitor, adjust alert, or act fast on likely fare glitches.
- 🧪 **Tests with Coverage** — CI runs typecheck and Jest with thresholds defined in `package.json`.

---

## Stack

- **Node.js 22 + TypeScript**
- **APIs**: Apify (Primary) → RapidAPI/Skyscanner (Fallback)
- **AI**: OpenRouter for news summaries and the travel concierge.
- **Persistence**: Turso/libSQL for users, alerts, history, seen news, AI usage, and subscriptions.
- **Notifications**: Telegram Bot
- **24/7 Server**: Railway webhook (`src/webhook.ts`)
- **CI/CD**: GitHub Actions — trackers, reports, dashboard, and tests

---

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/your-username/bsb-price-track.git
cd bsb-price-track
npm install
```

### 2. Configure `.env`

```bash
cp .env.example .env
```

Edit `.env` with your credentials (see table below).

### 3. Run Locally

```bash
npm run dev
```

### 4. Run Tests

```bash
npm test              # Tests only
npm test -- --coverage  # Tests + coverage report
```

> **Requirement**: Node.js 22 or higher.

---

## Environment Variables

### Mandatory

| Variable | Description |
|---|---|
| `APIFY_API_TOKEN_1` | Primary Apify API Token |
| `RAPIDAPI_KEY` | RapidAPI Key (fallback) |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | Telegram Chat/Group ID for alerts |
| `TURSO_DATABASE_URL` | Turso/libSQL database URL |
| `TURSO_AUTH_TOKEN` | Turso auth token |
| `DESTINATIONS` | Comma-separated destinations (e.g., `GRU,SDL,FOR`) |
| `OPENROUTER_API_KEY` | (Optional) OpenRouter Key for AI-powered news summaries |
| `CAKTO_WEBHOOK_SECRET` | (Optional, recommended) Secret used to validate Cakto calls on `/webhooks/cakto` |

### Optional

| Variable | Default | Description |
|---|---|---|
| `DEPARTURE_DATE` | — | Fixed departure date in `YYYY-MM-DD` format. Takes priority over `DEPARTURE_DATE_OFFSET`. |
| `DEPARTURE_DATE_OFFSET` | `0` | Days from today to automatically calculate the departure date. E.g.: `7` = always 7 days from now. |
| `ORIGIN` | `BSB` | Origin IATA code (single) |
| `ORIGINS` | — | Multiple origins separated by comma (e.g., `BSB,GRU`). Takes priority over `ORIGIN`. Scans all origin→destination combinations, skipping pairs where origin = destination. |
| `TRIP_TYPE` | `one-way` | Trip type: `one-way` or `round-trip` |
| `RETURN_DATE` | — | Return date `YYYY-MM-DD` (**mandatory** if `TRIP_TYPE=round-trip`) |
| `DATE_RANGE_DAYS` | `1` | Number of days to scan starting from the departure date |
| `ADULTS` | `1` | Number of adult passengers |
| `CHILDREN` | `0` | Number of child passengers |
| `MAX_PRICE_BRL` | `300` | Maximum price threshold in BRL |
| `PRICE_DROP_THRESHOLD` | `0.95` | Drop factor to trigger an alert (0.95 = 5% drop). E.g.: `0.90` to alert only on ≥ 10% drop. |
| `PRICE_ERROR_THRESHOLD` | `0.45` | Minimum drop vs. recent average to flag likely fare glitches in the tracker and personalized radar. |
| `HISTORY_RETENTION_DAYS` | `365` | How many days of history to keep. Older entries are removed automatically. |
| `WEBHOOK_PORT` | `3000` | Port for the bot's webhook server |
| `TRIAL_DAYS` | `7` | Free-trial duration when a user is authorized |
| `CAKTO_ACCESS_DAYS` | `30` | Access days granted by Cakto purchase/renewal when payload omits duration |
| `AI_DAILY_LIMIT` | `10` | Max AI concierge questions per user in the last 24h |
| `AIRLINES_WHITELIST` | — | Comma-separated airlines (e.g., `LATAM,GOL`) |
| `MAX_STOPS` | — | Maximum number of stops (0 = direct) |
| `MAX_DURATION_HOURS`| — | Maximum flight duration in hours |
| `APIFY_API_TOKEN_2..5`| — | Additional tokens for rotation (optional) |
| `APIFY_ACTOR_ID` | `johnvc~google-flights...` | Apify Actor ID |
| `RAPIDAPI_HOST` | `sky-scrapper.p.rapidapi.com` | RapidAPI Host |

### Departure date — precedence

```
DEPARTURE_DATE set       →  uses that fixed date
DEPARTURE_DATE_OFFSET=7  →  always searches 7 days from now (recalculated on each run)
neither set              →  searches for today
```

### Example `.env`

```env
APIFY_API_TOKEN_1=apify_api_xxxxx
RAPIDAPI_KEY=xxxxx
TELEGRAM_BOT_TOKEN=123456:ABC-xxxxx
TELEGRAM_CHAT_ID=-100xxxxxxxx
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-token
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

### Required Secrets

Go to **Settings → Secrets and variables → Actions → Secrets** and add:

| Secret | Mandatory |
|---|---|
| `APIFY_API_TOKEN_1` | ✅ |
| `RAPIDAPI_KEY` | ✅ |
| `TELEGRAM_BOT_TOKEN` | ✅ |
| `TELEGRAM_CHAT_ID` | ✅ |
| `TURSO_DATABASE_URL` | ✅ |
| `TURSO_AUTH_TOKEN` | ✅ |
| `OPENROUTER_API_KEY` | recommended |
| `CAKTO_WEBHOOK_SECRET` | if using Cakto |

### Required Variables

Go to **Settings → Secrets and variables → Actions → Variables** and add:

| Variable | Mandatory | Example |
|---|---|---|
| `DESTINATIONS` | ✅ | `GRU,SDL,FOR` |
| `DEPARTURE_DATE_OFFSET` | recommended | `7` |
| `DEPARTURE_DATE` | optional (fixed) | `2026-07-10` |
| `TRIP_TYPE` | optional | `one-way` |
| `RETURN_DATE` | if round-trip | `2026-07-20` |
| `DATE_RANGE_DAYS` | optional | `7` |
| `MAX_PRICE_BRL` | optional | `400` |
| `ORIGIN` | optional | `BSB` |
| `ORIGINS` | optional | `BSB,GRU` |
| `PRICE_DROP_THRESHOLD` | optional | `0.90` |
| `PRICE_ERROR_THRESHOLD` | optional | `0.45` |
| `HISTORY_RETENTION_DAYS` | optional | `365` |
| `APIFY_ACTOR_ID` | optional | — |
| `RAPIDAPI_HOST` | optional | — |

### Workflows

| Workflow | Trigger | Description |
|---|---|---|
| `ci.yml` | Push and Pull Request | Runs typecheck + tests with coverage |
| `check-flights.yml` | Cron 08:00/20:00 BRT + manual | Scans flights, sends alerts, and stores history in Turso |
| `check-news.yml` | Cron 3x daily | Monitors miles and points news |
| `check-offers.yml` | Cron every 2 hours | Scans for new travel offers |
| `intelligence-report.yml` | Manual | Generates the intelligence report as Markdown/JSON when manually triggered |
| `personalized-radar.yml` | Daily 09:15 BRT cron + manual | Sends personalized radar summaries to users with active alerts |
| `deploy-dashboard.yml` | Daily 00:00 BRT cron + landing/dashboard push | Generates the static dashboard and deploys GitHub Pages |
| `test-summarize.yml` | Manual | Smoke test for OpenRouter summarization |

> All workflows use **Node.js 22**.

---

## Project Structure

```
bsb-price-track/
├── src/
│   ├── index.ts                  # Entry point (Flight Tracker)
│   ├── index-news.ts             # Entry point (News/Miles)
│   ├── index-offers.ts           # Entry point (Offers)
│   ├── config.ts                 # Env var reading and validation
│   ├── types.ts                  # TypeScript types (Flight, SearchParams, etc.)
│   ├── apis/
│   │   ├── apify.ts              # Apify integration (Google Flights scraper)
│   │   └── rapidapi.ts           # RapidAPI/Skyscanner integration (fallback)
│   ├── services/
│   │   ├── tracker.ts            # Main logic: search, retry, alerts
│   │   ├── news.ts               # RSS fetch and keyword filter logic (Miles/News)
│   │   ├── intelligence.ts       # Opportunity score, recommendation, daily reports
│   │   ├── personalizedRadar.ts  # Per-user/per-alert smart radar
│   │   ├── aiConcierge.ts        # /perguntar with real history + live search + OpenRouter
│   │   ├── subscription.ts       # Trial, manual subscription, paid access
│   │   ├── caktoWebhook.ts       # Cakto webhook for activation/cancellation
│   │   ├── telegram.ts           # Telegram message sending
│   │   ├── currency.ts           # Currency conversion to BRL
│   │   ├── history.ts            # Turso history read/write
│   │   ├── healthCheck.ts        # Daily health check on Telegram
│   │   ├── webhook.ts            # Webhook server logic
│   │   └── weeklyReport.ts       # Weekly report generation
│   ├── scripts/
│   │   ├── generate-dashboard.ts          # Generates static dashboard HTML
│   │   ├── generate-intelligence-report.ts # Generates Markdown/JSON reports
│   │   └── send-personalized-radar.ts     # Sends personalized radar
│   ├── utils/
│   │   ├── retry.ts              # withRetry — generic exponential backoff
│   │   ├── dates.ts              # generateDateRange — date range generator
│   │   ├── priceHistory.ts       # Trend and best historical weekday
│   │   ├── cpm.ts                # Centavo por milha calculation
│   │   └── liveSearchCache.ts    # TTL cache for live searches
│   └── __tests__/                # Unit tests (Jest)
├── data/
│   ├── history.db                # Legacy local file; production uses Turso
│   ├── health.json               # Daily health check control
│   └── offers-seen.json          # Legacy/local sent-offers control
├── landing/
│   ├── index.html                # Landing page
│   └── dashboard.html            # Telegram Login authenticated dashboard
├── .github/
│   └── workflows/
│       ├── ci.yml                # CI — tests on push/PR
│       ├── check-flights.yml     # Flight Tracker — cron 2x daily
│       ├── check-news.yml        # News Tracker — cron 3x daily
│       ├── check-offers.yml      # Offers Tracker — cron every 2h
│       ├── intelligence-report.yml # Daily intelligence report
│       ├── personalized-radar.yml  # Per-user personalized radar
│       └── deploy-dashboard.yml  # GitHub Pages dashboard deploy
├── .gitattributes                # Marks *.db as binary (prevents text diff on SQLite)
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Telegram Messages

### Cheap Flight Alert (one-way)

```
✈️ Cheap flight found!

🛫 BSB → GRU
🏷️ ✈️ One-way
📅 Date: 2026-07-15
🏢 LATAM
💰 R$ 249,90

🔗 View flight
_Source: apify_
```

### Cheap Flight Alert (round-trip)

```
✈️ Cheap flight found!

🛫 BSB → GRU
🏷️ 🔄 Round-trip
📅 Departure: 2026-07-15
📅 Return: 2026-07-22
🏢 GOL
💰 R$ 589,00

🔗 View flight
_Source: rapidapi_
```

### Date Range Summary

```
🗓️ BSB→GRU (✈️ One-way) — 7 date(s) checked.
💰 Best: R$ 249,90 on 2026-07-18 (LATAM)
```

### Daily Health Check

```
💚 Tracker active — 2026-03-25, 08:05:12
```

### Weekly Report

Sent automatically on Sundays, comparing current prices with the previous week.

```
📊 Weekly Flight Report
📅 2026-03-29, 09:00:00

✈️ BSB → GRU
💰 Lowest price this week: R$ 249,90
📊 Previous week: R$ 270,00
📉 Change: -7.4% (-R$ 20,10)

✈️ BSB → FOR
💰 Lowest price this week: R$ 450,00
📊 Previous week: no data
➡️ Trend: not enough data to compare

_14 checks performed this week_
```

---

## Interactive Bot (Webhook)

The project includes a webhook server to respond to commands directly via Telegram. The bot is private, ignores groups/supergroups/channels, and uses multi-user authorization: the admin (`TELEGRAM_CHAT_ID`) is automatically authorized, new users remain pending, and the admin approves/rejects them with inline Telegram buttons.

### Available Commands

- `/start` — Registers the user, starts the approval flow, and shows available commands.
- `/meuid` — Shows the Telegram chat ID.
- `/alerta ORIGIN DESTINATION DATE PRICE` — Creates a one-way alert. Example: `/alerta BSB GRU 20/07/2026 350`.
- `/alerta ORIGIN DESTINATION DEPARTURE_DATE RETURN_DATE PRICE` — Creates a round-trip alert.
- `/meusalertas` — Lists active alerts, including expired-alert warnings.
- `/editar ID NEW_PRICE` — Updates an alert price ceiling.
- `/remover ID` — Removes an alert.
- `/buscar DESTINATION`, `/buscar ORIGIN DESTINATION`, or `/buscar ORIGIN DESTINATION DATE` — On-demand search with `ignoreMaxPrice`, showing the cheapest flights.
- `/tendencia ORIGIN DESTINATION [DATE]` — Performs advanced statistical analysis and plots price trends from the last 30 entries of the route as an interactive line chart in Slate-800 Premium format via **QuickChart.io**. The response is delivered as an integrated balloon (chart + legend) containing:
  - **Direction and Variation**: Statistically determines if the price trend is up, down, or stable over the last 7 days.
  - **Extremes**: Displays the lowest price ever recorded in the database history and the latest tracked price.
  - **Ideal Buying Day**: Identifies the day of the week that is statistically cheapest for the route based on arithmetic historical averages.
  - **Resiliency Mechanism**: If the QuickChart API fails or times out, the bot dynamically falls back to a clean, text-based notification balloon.
- `/perguntar BSB GRU vale a pena comprar agora?` — AI concierge combining history, trend, live search, cache, and OpenRouter to provide practical recommendations.
- `/cpm ORIGIN DESTINATION MILES [CASH_PRICE]` — Calculates cents per mile using a provided cash price or the live lowest fare.
- `/noticias` or `/ofertas` — Toggles news and offers notifications.
- `/assinatura` — Shows trial/subscription status.
- `/status` — Shows server status (admin).
- `/autorizar ID`, `/ativar ID DAYS`, `/cancelar ID` — Access and subscription administration (admin).

### How to Run the Bot

1. Configure `WEBHOOK_PORT` in `.env` (default is 3000).
2. Expose your local port (using `ngrok`, `cloudflare tunnel`, or server deployment).
3. Configure the Webhook in Telegram:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<YOUR_URL>`
4. Start the server:
   ```bash
   npm run webhook
   ```

---

## Advanced Filters

You can refine your search using environment variables to avoid unwanted flight alerts.

- **Specific Airlines**: Use `AIRLINES_WHITELIST=LATAM,GOL` to receive alerts only from these companies.
- **Direct Flights**: Set `MAX_STOPS=0` to ignore flights with layovers.
- **Flight Duration**: Use `MAX_DURATION_HOURS=5` to filter out long flights.

### Configurable Anti-Spam

A new alert is only triggered for the same route and date if the current price is at least X% lower than the lowest price found in the previous search. The threshold is configurable:

```env
PRICE_DROP_THRESHOLD=0.95   # alert on ≥ 5% drop (default)
PRICE_DROP_THRESHOLD=0.90   # alert only on ≥ 10% drop
PRICE_DROP_THRESHOLD=1.00   # always alert (no filter)
```

---

## SaaS Web Dashboard & API REST

The project integrates a complete web platform based on the design of *Google Blog (The Keyword)* (Material Design 3), powered by a native Node.js REST API microservice.

### Native Web Server Architecture
- **Zero-Dependency**: The HTTP server is implemented natively using the integrated `node:http` module. No Express, Fastify, or external dependencies, ensuring zero cold-start times and high resource efficiency in serverless or lightweight container deployments.
- **Integrated Persistence**: Direct Turso/libSQL integration for history, alerts, users, subscriptions, seen news, and AI concierge usage.

### Cryptographic Security & Authentication
- **HMAC Telegram Authentication**: The login flow is integrated with the official Telegram Login Widget. The authentication of frontend credentials (`id`, `first_name`, `username`, `auth_date`, `hash`) is verified on the backend by recalculating the HMAC-SHA256 of alphabetically sorted parameters using a key derived from `TELEGRAM_BOT_TOKEN` via a SHA-256 hash.
- **Stateless Session Tokens**: Instead of storing sessions in a database, the server issues self-contained, cryptographically signed tokens. The token contains `id:firstName:username:timestamp` and an HMAC-SHA256 signature keyed by the `TELEGRAM_BOT_TOKEN`.
- **Secure Session Cookies**: The token is injected via the `Set-Cookie` header with strict restriction directives: `HttpOnly` (prevents interception by client scripts and XSS attacks), `SameSite=Lax` (protects against CSRF), and a default validity of 30 days.

### REST API Endpoints
The backend maps native HTTP routes based on the session token retrieved from the request headers:
- `GET /` — Serves the interactive Landing Page.
- `GET /dashboard` — Renders the administrative dashboard control page for the authenticated user's alerts.
- `GET /api/stats` — Aggregates global Turso statistics (`totalChecks`, cheapest price, active routes, authorized users).
- `GET /api/history` — Returns the serialized price history for the filtered route to populate client-side charts.
- `GET /api/alerts` — Lists all monitoring rules registered for the logged-in user (based on the Telegram Chat ID extracted from the session).
- `POST /api/alerts` — Creates a new monitoring trigger (`origin`, `destination`, `max_price_brl`, `departure_date`, `return_date`).
- `POST /api/alerts/update` — Updates the parameters (e.g., maximum price threshold) of an active monitoring trigger.
- `DELETE /api/alerts` — Permanently deletes a registered alert.
- `GET /api/auth/telegram` — Callback endpoint for cryptographic validation of the Telegram Login Widget.
- `GET /api/auth/logout` — Clears the browser session cookie.
- `POST /webhooks/cakto` — Receives Cakto events, validates the optional secret, and activates/cancels subscriptions.

### UI Google Blog Style (Material 3) & Reactivity
- **Advanced & Modular CSS**: Fully responsive layout (Desktop/Mobile) featuring clean typography imported via Google Fonts (Outfit & Inter), soft borders with blur (`backdrop-filter`), elevated shadows, and elegant gradients.
- **Flash of Unstyled Content (FOUC) Prevention**: A lightweight color preference script (`dark` vs `light` theme) injected directly into the `<head>` using `localStorage`, ensuring instantaneous loading of the correct theme with zero flash.
- **Dynamic Visualization with Chart.js**: Line charts rendering history in a fully reactive manner. The chart theme dynamically adapts its colors (axes, grid lines, tooltips, and linear gradient fills) on the client side whenever the user toggles light/dark mode.

---

## Price Glitch Detector

The tracker incorporates a statistical algorithm to identify extreme anomalies in airfare prices, commonly known as "fare glitches" or pricing bugs.

### Algorithm Mechanics
1. **Specific Sample Collection**: For each identified flight, the system queries Turso history for the exact route on the specific departure date (`getRoutePriceHistory(origin, destination, departure_date)`).
2. **Insufficient Sample Fallback**: The statistical detector requires a minimum of $N \ge 3$ historical records to compute averages. If the specific date lacks sufficient records, the algorithm automatically falls back to the complete route history (`getRoutePriceHistory(origin, destination)`).
3. **Deviation Calculation & Trigger**: If sufficient historical data is present ($\ge 3$), the system calculates the simple arithmetic mean (`avgPrice`). A price "Glitch" is flagged if:
   $$\text{Current Price BRL} \le \text{avgPrice} \times (1 - \text{PRICE\_ERROR\_THRESHOLD})$$
   The default `PRICE_ERROR_THRESHOLD` is set to `0.45` (representing a price drop of over 45% compared to the historical average).

### Rule Bypass Mechanism (Alert Prioritization)
When a flight is classified as a Glitch, the standard alert notification rules are dynamically modified:
- **Price Cap Bypass**: The bot triggers the alert even if the price exceeds the user's custom `max_price_brl` threshold. This ensures users do not miss massive price drops on premium or long-haul tickets that would otherwise be filtered out (e.g., a R$ 6,000.00 ticket plummeting to R$ 700.00).
- **Exclusive Anti-Spam Control**: To avoid spamming subsequent searches that capture the same active glitch, subsequent glitch alerts are only triggered if the current price is *strictly lower* than the last registered glitch price.

---

## Intelligence and Personalized Radar

In addition to immediate alerts, the app generates intelligence from accumulated history:

- `npm run intelligence` generates `reports/daily-intelligence.md` and `reports/daily-intelligence.json` with a 0-100 score, recommendation (`buy`, `monitor`, `wait`), 30-day average, historical low, 7-day trend, and insufficient-data routes.
- `npm run radar` reads active alerts, joins them with same-route/same-date history, and sends a personalized Telegram summary to each eligible user.
- The radar classifies each alert as `Buy now`, `Wait`, `Monitor`, `Create/adjust alert`, or `Likely fare glitch`.
- For regular users, the radar respects authorization + active trial/subscription. For the admin, active alerts are included even without a `subscriptions` row.
- The radar does not call Apify/RapidAPI; it only uses data already stored in Turso, avoiding extra API cost.

---

## Search Flow

```
For each origin in ORIGINS:
  For each destination in DESTINATIONS (skipping origin = destination):
    ├── Calculate departure date (DEPARTURE_DATE > DEPARTURE_DATE_OFFSET > today)
    ├── Generate date range (DATE_RANGE_DAYS)
    │
    ├── If only 1 date:
    │   ├── Try Apify (up to 3x with retry, token rotation on 402/403)
    │   ├── If it fails → try RapidAPI
    │   ├── Apply advanced filters
    │   ├── Save to Turso history (automatic pruning)
    │   └── If below threshold AND drop ≥ PRICE_DROP_THRESHOLD → send alert
    │
    └── If multiple dates:
        ├── For each date: search → filter → save
        ├── Find the date with the cheapest flight
        ├── If below threshold AND drop ≥ PRICE_DROP_THRESHOLD → send alert
        └── Send range summary
```

---

## Development

### Useful Commands

```bash
npm run dev          # Run the flight tracker once
npm run news         # Run the miles news tracker
npm run offers       # Run the travel offers tracker
npm run webhook      # Start the interactive bot via webhook
npm run dashboard    # Generate dist-pages/index.html for the static dashboard
npm run intelligence # Generate daily Markdown/JSON reports in reports/
npm run radar        # Send personalized Telegram radar
npm run typecheck    # Run TypeScript type checking
npm test             # Run all tests
npm test -- --coverage  # Tests + coverage report
npm run build        # Compile TypeScript to dist/
npm run start:webhook # Run compiled bot (production)
```

### Adding a New Destination

Simply add the IATA code to the `DESTINATIONS` variable (or GitHub Variable):

```env
DESTINATIONS=GRU,SDL,FOR,CNF,VCP
```

### Dynamic Date Search

```env
# Always searches 14 days from now, scanning a 7-day window
DEPARTURE_DATE_OFFSET=14
DATE_RANGE_DAYS=7
```

# ✈️ BSB Price Track

Monitors airfare departing from Brasília (BSB) and sends Telegram alerts when prices are below the configured threshold. Runs automatically via GitHub Actions twice a day.

## Features

- 🔍 **Multiple Destinations** — Search BSB→GRU, BSB→SDL, BSB→FOR all at once.
- 🔁 **Multiple Origins** — `ORIGINS=BSB,GRU` scans all combinations in both directions (useful for return trip monitoring).
- 🗓️ **Date Range** — Scans N days from the departure date and alerts the cheapest date found.
- 📅 **Date Offset** — `DEPARTURE_DATE_OFFSET=7` always searches "7 days from now", no manual updates needed.
- ✈️ **One-way or Round-trip** — Configurable via environment variables.
- 👥 **Passenger Configuration** — Support for multiple adults and children.
- 🔄 **Retry with Backoff & Token Rotation** — Retries Apify up to 3 times and rotates between up to 5 tokens if credits run out.
- 💾 **SQLite History** — Saves every search in `data/history.db` (automatically committed) with configurable automatic pruning.
- 📊 **Weekly Report** — Automatic summary of the best prices of the week sent on Sundays.
- 🤖 **Interactive Bot (Webhook)** — Commands for real-time search and history consultation.
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
- 🧪 **Tests with Coverage** — CI blocks PRs with coverage below 80%.

---

## Stack

- **Node.js 22 + TypeScript** (native `node:sqlite` usage)
- **APIs**: Apify (Primary) → RapidAPI/Skyscanner (Fallback)
- **AI**: OpenRouter (Claude/Alpha) for automatic article summaries
- **Persistence**: SQLite (history) and JSON (seen news/offers)
- **Notifications**: Telegram Bot
- **CI/CD**: GitHub Actions — scheduled runs and automatic Git persistence

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

> **Requirement**: Node.js 22 or higher (required for `node:sqlite`).

---

## Environment Variables

### Mandatory

| Variable | Description |
|---|---|
| `APIFY_API_TOKEN_1` | Primary Apify API Token |
| `RAPIDAPI_KEY` | RapidAPI Key (fallback) |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | Telegram Chat/Group ID for alerts |
| `DESTINATIONS` | Comma-separated destinations (e.g., `GRU,SDL,FOR`) |
| `OPENROUTER_API_KEY` | (Optional) OpenRouter Key for AI-powered news summaries |

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
| `HISTORY_RETENTION_DAYS` | `365` | How many days of history to keep. Older entries are removed automatically. |
| `WEBHOOK_PORT` | `3000` | Port for the bot's webhook server |
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
| `HISTORY_RETENTION_DAYS` | optional | `365` |
| `APIFY_ACTOR_ID` | optional | — |
| `RAPIDAPI_HOST` | optional | — |

### Workflows

| Workflow | Trigger | Description |
|---|---|---|
| `ci.yml` | Push and Pull Request | Runs tests + coverage (blocks if < 80%) |
| `check-flights.yml` | Cron 08:00/20:00 BRT + manual | Scans flights, sends alerts, commits `history.db` and `health.json` |
| `check-news.yml` | Cron 3x daily | Monitors miles and points news |
| `check-offers.yml` | Cron every 2 hours | Scans for new travel offers |

> All workflows use **Node.js 22** (required for `node:sqlite`).

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
│   │   ├── telegram.ts           # Telegram message sending
│   │   ├── currency.ts           # Currency conversion to BRL
│   │   ├── history.ts            # SQLite history read/write (history.db)
│   │   ├── healthCheck.ts        # Daily health check on Telegram
│   │   ├── webhook.ts            # Webhook server logic
│   │   └── weeklyReport.ts       # Weekly report generation
│   ├── utils/
│   │   ├── retry.ts              # withRetry — generic exponential backoff
│   │   └── dates.ts              # generateDateRange — date range generator
│   └── __tests__/                # Unit tests (Jest)
├── data/
│   ├── history.db                # Search history in SQLite (auto-committed by CI)
│   ├── health.json               # Daily health check control
│   ├── news-seen.json            # Database of already sent news
│   └── offers-seen.json          # Database of already sent offers
├── .github/
│   └── workflows/
│       ├── ci.yml                # CI — tests on push/PR
│       ├── check-flights.yml     # Flight Tracker — cron 2x daily
│       ├── check-news.yml        # News Tracker — cron 3x daily
│       └── check-offers.yml      # Offers Tracker — cron every 2h
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

The project includes a webhook server to respond to commands directly via Telegram. Only messages from the configured `TELEGRAM_CHAT_ID` are accepted.

### Available Commands

- `/buscar [DESTINATION]` — Performs a real-time search for the given destination (e.g., `/buscar GRU`).
- `/historico [DESTINATION]` — Shows the last 5 searches for that destination, allowing price tracking over time.
- `/status` — Displays current tracker status, including origin, monitored destinations, and price threshold.
- `/tendencia ORIGIN DESTINATION [DATE]` — Performs advanced statistical analysis and plots price trends from the last 30 entries of the route as an interactive line chart in Slate-800 Premium format via **QuickChart.io**. The response is delivered as an integrated balloon (chart + legend) containing:
  - **Direction and Variation**: Statistically determines if the price trend is up, down, or stable over the last 7 days.
  - **Extremes**: Displays the lowest price ever recorded in the database history and the latest tracked price.
  - **Ideal Buying Day**: Identifies the day of the week that is statistically cheapest for the route based on arithmetic historical averages.
  - **Resiliency Mechanism**: If the QuickChart API fails or times out, the bot dynamically falls back to a clean, text-based notification balloon.

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
- **Integrated Persistence**: Direct integration with the native synchronous/asynchronous `node:sqlite` driver for extremely fast transactional operations to query history and configure alerts.

### Cryptographic Security & Authentication
- **HMAC Telegram Authentication**: The login flow is integrated with the official Telegram Login Widget. The authentication of frontend credentials (`id`, `first_name`, `username`, `auth_date`, `hash`) is verified on the backend by recalculating the HMAC-SHA256 of alphabetically sorted parameters using a key derived from `TELEGRAM_BOT_TOKEN` via a SHA-256 hash.
- **Stateless Session Tokens**: Instead of storing sessions in a database, the server issues self-contained, cryptographically signed tokens. The token contains `id:firstName:username:timestamp` and an HMAC-SHA256 signature keyed by the `TELEGRAM_BOT_TOKEN`.
- **Secure Session Cookies**: The token is injected via the `Set-Cookie` header with strict restriction directives: `HttpOnly` (prevents interception by client scripts and XSS attacks), `SameSite=Lax` (protects against CSRF), and a default validity of 30 days.

### REST API Endpoints
The backend maps native HTTP routes based on the session token retrieved from the request headers:
- `GET /` — Serves the interactive Landing Page.
- `GET /dashboard` — Renders the administrative dashboard control page for the authenticated user's alerts.
- `GET /api/stats` — Aggregates global statistics directly from SQLite (`total_searches`, `cheapest_flight_ever`, `active_routes`).
- `GET /api/history` — Returns the serialized price history for the filtered route to populate client-side charts.
- `GET /api/alerts` — Lists all monitoring rules registered for the logged-in user (based on the Telegram Chat ID extracted from the session).
- `POST /api/alerts` — Creates a new monitoring trigger (`origin`, `destination`, `max_price_brl`, `departure_date`, `return_date`).
- `POST /api/alerts/update` — Updates the parameters (e.g., maximum price threshold) of an active monitoring trigger.
- `DELETE /api/alerts` — Permanently deletes a registered alert.
- `GET /api/auth/telegram` — Callback endpoint for cryptographic validation of the Telegram Login Widget.
- `GET /api/auth/logout` — Clears the browser session cookie.

### UI Google Blog Style (Material 3) & Reactivity
- **Advanced & Modular CSS**: Fully responsive layout (Desktop/Mobile) featuring clean typography imported via Google Fonts (Outfit & Inter), soft borders with blur (`backdrop-filter`), elevated shadows, and elegant gradients.
- **Flash of Unstyled Content (FOUC) Prevention**: A lightweight color preference script (`dark` vs `light` theme) injected directly into the `<head>` using `localStorage`, ensuring instantaneous loading of the correct theme with zero flash.
- **Dynamic Visualization with Chart.js**: Line charts rendering history in a fully reactive manner. The chart theme dynamically adapts its colors (axes, grid lines, tooltips, and linear gradient fills) on the client side whenever the user toggles light/dark mode.

---

## Price Glitch Detector

The tracker incorporates a statistical algorithm to identify extreme anomalies in airfare prices, commonly known as "fare glitches" or pricing bugs.

### Algorithm Mechanics
1. **Specific Sample Collection**: For each identified flight, the system queries the SQLite database history for the exact route on the specific departure date (`getRoutePriceHistory(origin, destination, departure_date)`).
2. **Insufficient Sample Fallback**: The statistical detector requires a minimum of $N \ge 3$ historical records to compute averages. If the specific date lacks sufficient records, the algorithm automatically falls back to the complete route history (`getRoutePriceHistory(origin, destination)`).
3. **Deviation Calculation & Trigger**: If sufficient historical data is present ($\ge 3$), the system calculates the simple arithmetic mean (`avgPrice`). A price "Glitch" is flagged if:
   $$\text{Current Price BRL} \le \text{avgPrice} \times (1 - \text{PRICE\_ERROR\_THRESHOLD})$$
   The default `PRICE_ERROR_THRESHOLD` is set to `0.45` (representing a price drop of over 45% compared to the historical average).

### Rule Bypass Mechanism (Alert Prioritization)
When a flight is classified as a Glitch, the standard alert notification rules are dynamically modified:
- **Price Cap Bypass**: The bot triggers the alert even if the price exceeds the user's custom `max_price_brl` threshold. This ensures users do not miss massive price drops on premium or long-haul tickets that would otherwise be filtered out (e.g., a R$ 6,000.00 ticket plummeting to R$ 700.00).
- **Exclusive Anti-Spam Control**: To avoid spamming subsequent searches that capture the same active glitch, subsequent glitch alerts are only triggered if the current price is *strictly lower* than the last registered glitch price.

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
    │   ├── Save to data/history.db (automatic pruning)
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

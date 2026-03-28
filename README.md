<p align="center">
  <img src="public/favicon.svg" width="64" height="64" alt="DeltaScope Logo" />
</p>

<h1 align="center">DeltaScope</h1>

<p align="center">
  <strong>Real-time Oracle & DEX Intelligence Platform</strong><br/>
  Monitor Pyth Network oracle prices vs Hyperliquid mark prices — catch discrepancies, track funding rates, and analyze infrastructure latency in real-time.
</p>

<p align="center">
  <a href="https://deltascope.site">Live Demo</a> · <a href="#architecture">Architecture</a> · <a href="#pyth-integration-deep-dive">Pyth Integration</a> · <a href="#getting-started">Getting Started</a>
</p>

---

## Why DeltaScope?

Oracle price feeds and DEX mark prices **should** be the same — but they're not. The gap between Pyth's oracle price and Hyperliquid's mark price reveals:

- **Liquidation risk** — When oracles lag mark prices, leveraged positions can be liquidated before the oracle catches up
- **Funding rate mechanics** — The oracle-mark spread directly drives funding rate calculations
- **Infrastructure health** — A growing oracle delay signals network congestion or validator issues
- **Arbitrage signals** — Persistent discrepancies across venues create cross-exchange opportunities

Most trading dashboards show you prices. DeltaScope shows you **the infrastructure behind the prices**.

---

## Pyth Integration Deep-Dive

DeltaScope uses Pyth Network as the **primary price truth layer** — every feature depends on Pyth data, and the integration goes beyond simply reading prices.

### 1. Triple-Source Oracle Ingestion (Lowest Possible Latency)

We don't just connect to one Pyth endpoint. We run **three parallel Pyth data sources** and accept whichever returns the freshest `publishTime`:

```
┌─────────────────────────┐
│  Hermes WS (main)       │──┐
│  hermes.pyth.network    │  │
└─────────────────────────┘  │    ┌─────────────────────┐
                              ├───▶│  Freshness Dedup     │──▶ Broadcast
┌─────────────────────────┐  │    │  (highest publishTime│     to clients
│  Hermes WS (beta)       │──┘    │   wins per asset)    │
│  hermes-beta.pyth.network│      └─────────────────────┘
└─────────────────────────┘            ▲
                                        │
┌─────────────────────────┐            │
│  Hermes REST (1s poll)  │────────────┘
│  /v2/updates/price/latest│
└─────────────────────────┘
```

**Why this matters:** Hermes main and beta are separate relay infrastructure with different latency characteristics. REST polling catches updates that WebSocket batching delays. The combination yields ~10-15% lower oracle delay than a single WS connection.

**Implementation:** [`workers/price-aggregator.ts`](workers/price-aggregator.ts) lines 324-329 (dual WS), 526-565 (REST poll), 567-591 (freshness dedup via `publishTime` comparison).

### 2. Pyth Pro (Lazer) Ready — Sub-50ms When Enabled

The aggregator has a **dual-mode architecture**: if a `PYTH_PRO_TOKEN` environment variable is set, it automatically switches from Hermes to Pyth's Lazer protocol:

- Connects to all 3 Lazer endpoints (`pyth-lazer-{0,1,2}.dourolabs.app`) for redundancy
- Subscribes to `real_time` channel (1-50ms updates vs ~400ms on Hermes)
- Uses microsecond-precision `feedUpdateTimestamp` for latency measurement
- Processes `bestBidPrice`, `bestAskPrice`, and `publisherCount` — data not available on Hermes

```typescript
// Automatic mode selection — no code changes needed
const token = this.env.PYTH_PRO_TOKEN;
this.usingPythPro = !!token;

if (this.usingPythPro) {
  // Connect to all 3 Lazer endpoints for redundancy
  for (let i = 0; i < 3; i++) this.connectPythPro(i, token);
} else {
  // Dual Hermes + REST polling fallback
  this.connectPythHermes("https://hermes.pyth.network/ws", false);
  this.connectPythHermes("https://hermes-beta.pyth.network/ws", true);
  this.startPythRestPoll();
}
```

### 3. Oracle Discrepancy Monitoring

For each of the 8 tracked assets, DeltaScope computes the **real-time discrepancy** between Pyth's oracle price and Hyperliquid's mark price:

```
discrepancy = |pythPrice - markPrice| / markPrice × 100%
```

This is displayed per-asset in the Market Overview table with color-coded severity badges. Assets exceeding 0.5% discrepancy are flagged, and a global `discrepancyCount` is shown in the dashboard header.

### 4. Publish Delay Analytics

The Latency Monitor page computes the **median Pyth publish delay** across all tracked feeds:

```
publishDelay = now() - (publishTime from Pyth)
```

This is tracked in a ring buffer (120 samples, ~10 min) and visualized on a TradingView chart alongside Hyperliquid API latency and WebSocket interval metrics. Traders can see exactly how stale their oracle data is at any moment.

### 5. AI Chat with 6 Pyth-Powered Tools

The AI assistant (`workers/chat.ts` + `workers/pyth-tools.ts`) has direct access to the full Pyth Hermes API through 6 structured tools:

| Tool | What It Does | Pyth API Used |
|------|-------------|---------------|
| `searchPriceFeeds` | Search 1,930+ feeds by symbol, name, or asset type | `/v2/price_feeds` |
| `getLatestPrices` | Real-time prices with confidence intervals | `/v2/updates/price/latest` |
| `getHistoricalPrice` | Price at any historical timestamp | `/v2/updates/price/{timestamp}` |
| `getTwap` | Time-weighted average price (1-600s windows) | `/v2/updates/twap/latest` |
| `getHyperliquidData` | Cross-reference with Hyperliquid perps data | Hyperliquid REST API |
| `analyzePriceFeed` | Full analysis: price + TWAP + deviation + confidence | Multiple endpoints combined |

Example interaction:
> **User:** "Compare BTC and ETH funding rates"
> **AI:** Fetches real-time Pyth prices for both, queries Hyperliquid funding/OI, computes discrepancies, and presents a structured comparison.

### 6. Confidence Interval Visualization

Pyth provides a `confidence` value with every price update — a measure of publisher agreement. DeltaScope displays this alongside the price, giving traders visibility into **price certainty**, not just price level. Wide confidence = disagreement among publishers = higher risk.

---

## Features

### Dashboard (`/`)
- Real-time price table: 8 major assets with Pyth oracle prices vs Hyperliquid mark prices
- Oracle discrepancy badges (color-coded by severity)
- 24h volume, open interest, annualized funding rates
- HIP-3 ecosystem overview (permissionless perp DEXs on Hyperliquid)

### Ticker Analysis (`/analysis`)
- Deep-dive into individual assets
- TradingView candlestick charts (built from raw tick data)
- Orderbook visualization
- Funding rate history

### Predict & Win (`/predict`)
- Paper prediction game — bet on price direction using live Pyth + Hyperliquid prices
- UP/DOWN binary predictions on 8 major assets (BTC, ETH, SOL, HYPE, ARB, DOGE, AVAX, LINK)
- Two time windows: 1 minute (fast) and 5 minutes (standard)
- Points-based economy: 1,000 starting balance, wager 10/25/50/100 per prediction
- Alarm-based settlement: predictions resolve automatically against live oracle prices
- Streak bonuses: 3+ consecutive wins earn +10% bonus per extra win
- Global leaderboard: compete by points, win rate, and streaks
- Editable display names, bankrupt reset (to 500 points)
- Zero real money — validates the prediction market concept before on-chain deployment

### Latency Monitor (`/latency`)
- Pyth Oracle Delay (median publish delay across feeds)
- Hyperliquid REST API round-trip time
- WebSocket delivery latency (edge → browser)
- Overall infrastructure health score (0-100)
- Multi-line TradingView chart with 10-min rolling history
- Source health table with P50/P95/MIN/MAX percentiles

### AI Chat Assistant
- Natural language queries about any Pyth price feed
- Cross-references Pyth oracle data with Hyperliquid perps
- 6 structured tools for real-time and historical analysis
- Accessible via floating chat button on all pages

### Developers (`/developers`)
- API documentation and integration examples

---

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │              Cloudflare Edge                  │
                    │                                              │
 Browsers ────WS────┤  ┌────────────────────────────────────────┐  │
                    │  │       PriceAggregator (Durable Object)  │  │
                    │  │                                          │  │
                    │  │  Pyth Hermes WS ──┐                     │  │
                    │  │  Pyth Hermes Beta ─┼─▶ Merge + Dedup    │  │
                    │  │  Pyth REST Poll ──┘    by publishTime   │  │
                    │  │                            │             │  │
                    │  │  HL allMids WS ────────────┤             │  │
                    │  │  HL Meta REST (3s) ────────┤             │  │
                    │  │                            ▼             │  │
                    │  │                    Fan-out to clients    │  │
                    │  │                    (16ms throttle)       │  │
                    │  └────────────────────────────────────────┘  │
                    │                                              │
                    │  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  │
                    │  │ Chat DO  │  │ PredictionGame│  │ React Router │  │
                    │  │ (AI SDK) │  │ DO (SQLite)   │  │ 7 (SSR)      │  │
                    │  └──────────┘  └──────────────┘  └──────────────┘  │
                    └──────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Single Durable Object for all price state** — The `PriceAggregator` DO maintains exactly one instance (`idFromName("global")`) that holds all upstream connections. This means zero coordination overhead and guaranteed consistency — every client sees the same merged state.

2. **16ms broadcast throttle** — Upstream updates arrive at different rates (Pyth ~400ms, HL ~1000ms). Instead of broadcasting on every tick, we coalesce updates within a 16ms window using `queueMicrotask()` for immediate dispatch or `setTimeout()` for the remaining window.

3. **Incremental snapshot caching** — Only assets with changed data (`dirtyAssets` set) get their JSON object recomputed. Unchanged assets reuse their cached snapshot object, reducing `JSON.stringify` work on every broadcast.

4. **24/7 keep-alive via DO Alarms** — The DO sets an alarm every 25 seconds. When the alarm fires, it calls `ensureUpstream()` to keep all WebSocket connections alive, even with zero connected clients. This eliminates cold-start delays for the first visitor.

5. **Smart Placement** — Cloudflare's Smart Placement routes the Worker closer to Pyth/Hyperliquid backends rather than the user's edge, reducing upstream fetch latency.

---

## Tech Stack — Full-Stack Application

DeltaScope is a **full-stack application** with a persistent backend, server-side rendering, and real-time WebSocket infrastructure.

### Backend

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Runtime** | Cloudflare Workers | Edge-deployed serverless runtime |
| **Persistent Backend** | Durable Objects (×4) | `PriceAggregator` — stateful price engine with 4 upstream connections, 24/7 alarm keep-alive; `PredictionGame` — paper prediction market with SQLite settlement; `Chat` — AI agent DO; `ChatSessionsDO` — session index |
| **Oracle Ingestion** | Pyth Network Hermes | Dual WebSocket (main + beta) + REST polling every 1s — triple-source freshness dedup |
| **Oracle Ingestion (Pro)** | Pyth Lazer (optional) | 3 redundant WS endpoints, `real_time` channel, sub-50ms updates |
| **DEX Data** | Hyperliquid API | WebSocket (`allMids` stream) + REST polling every 3s (`metaAndAssetCtxs`) |
| **AI Engine** | Vercel AI SDK + Workers AI | Streaming LLM with 6 structured tools querying Pyth + Hyperliquid APIs |
| **API Layer** | REST + WebSocket | `/api/prices`, `/api/latency`, `/api/hip3` (REST); `/ws/prices` (real-time WS fan-out) |
| **Security** | CSP + CORS + Origin validation | Hardened headers, WebSocket origin checks, HttpOnly cookies |

### Frontend

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Framework** | React Router 7 (SSR) | Server-side rendered pages with typed loaders/actions |
| **State Management** | Zustand | Client-side WebSocket connection + tick aggregation |
| **Charts** | TradingView Lightweight Charts | Candlestick charts (analysis) + multi-line latency charts |
| **UI Components** | shadcn/ui + Tailwind CSS 4 | Dark theme, responsive layout, accessible components |
| **Typography** | Space Grotesk (self-hosted) | Zero external font requests via @fontsource |
| **AI Chat** | @cloudflare/ai-chat + agents SDK | Lazy-mounted chat popup with retry-aware message fetching |

### Infrastructure & DevOps

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Deployment** | Cloudflare Workers (edge) | Global CDN, Smart Placement near Pyth/HL backends |
| **Package Manager** | Bun | Fast installs, builds, and script execution |
| **Build** | Vite + React Router | SSR build with Cloudflare plugin |
| **Type Safety** | TypeScript (strict) | End-to-end types from DO → loader → component |
| **Testing** | Vitest + Playwright | Unit tests (Workers pool) + E2E scaffolding |
| **Caching** | Cloudflare Edge | Immutable assets (1yr), HTML (5s + stale-while-revalidate) |

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (Cloudflare CLI)
- A Cloudflare account

### Install & Run Locally

```bash
git clone https://github.com/0xPilotSB/deltascope.git
cd deltascope
bun install
bun dev
```

Open `http://localhost:5173` — the dashboard will connect to live Pyth and Hyperliquid APIs.

### Deploy to Cloudflare

```bash
bun run deploy
```

This builds the React Router app and deploys the Worker + Durable Objects to Cloudflare's edge network.

### Enable Pyth Pro (Lazer) — Optional

For sub-50ms oracle updates (requires Pyth Pro access):

```bash
wrangler secret put PYTH_PRO_TOKEN
# Paste your Pyth Lazer API token
```

The aggregator automatically detects the token and switches from Hermes to Lazer.

---

## Project Structure

```
deltascope/
├── app/
│   ├── components/
│   │   ├── latency-chart.tsx    # Multi-line TradingView latency chart
│   │   ├── oracle-chat.tsx      # AI chat popup (lazy-mounted)
│   │   ├── tv-chart.tsx         # TradingView candlestick chart
│   │   ├── markdown-renderer.tsx
│   │   ├── mobile-nav.tsx
│   │   └── ui/                  # shadcn/ui components
│   ├── routes/
│   │   ├── home.tsx             # Dashboard — price table, stats, HIP-3
│   │   ├── analysis.tsx         # Ticker deep-dive with charts
│   │   ├── predict.tsx          # Predict & Win — paper prediction game
│   │   ├── latency.tsx          # Infrastructure latency monitor
│   │   ├── developers.tsx       # API docs page
│   │   └── chat.tsx             # Full-page chat view
│   ├── schemas/
│   │   └── prediction.ts        # Zod validation for predictions
│   ├── stores/
│   │   └── price-store.ts       # Zustand store — WS connection, tick aggregation
│   ├── root.tsx                 # App shell, meta tags, preconnect hints
│   └── app.css                  # Tailwind + theme config
├── workers/
│   ├── app.ts                   # Worker entry — routing, security headers, caching
│   ├── price-aggregator.ts      # Core DO — Pyth + HL ingestion, fan-out, latency tracking
│   ├── prediction-game.ts       # Prediction DO — SQLite, settlement alarms, leaderboard
│   ├── chat.ts                  # AI chat agent (Workers AI + 6 Pyth tools)
│   ├── chat-sessions.ts         # Chat session index DO
│   ├── pyth-tools.ts            # 6 AI tools: search, prices, historical, TWAP, analysis
│   └── data-proxy.ts            # Local dev data proxy shim
├── wrangler.jsonc               # Cloudflare config — bindings, Smart Placement, compat
├── package.json
└── LICENSE                      # Apache 2.0
```

---

## Predict & Win — How It Works

The prediction game is a **paper trading system** that validates the prediction market concept before moving to real smart contracts on HyperEVM.

### Settlement Flow

```
User clicks UP/DOWN
       │
       ▼
┌──────────────────────────┐
│  PredictionGame DO        │
│  1. Validate wager        │
│  2. Fetch entry price     │◀── PriceAggregator DO (/prices)
│  3. Deduct points         │
│  4. Store prediction      │
│  5. Schedule alarm        │
└──────────────────────────┘
       │
       ▼  (alarm fires after duration + 1s)
┌──────────────────────────┐
│  Settlement               │
│  1. Fetch exit price      │◀── PriceAggregator DO (/prices)
│  2. Compare direction     │
│  3. Calculate payout      │
│  4. Update points/streak  │
│  5. Reschedule if pending │
└──────────────────────────┘
```

### Scoring System

| Action | Points |
|--------|--------|
| Starting balance | 1,000 |
| Win | +wager amount |
| Loss | -wager amount (already deducted at placement) |
| Streak bonus (3+) | +10% per extra win beyond 2 |
| Bankrupt reset | Reset to 500 |
| Price unchanged | Full refund |
| Oracle unavailable | Full refund |

### SQLite Schema

The `PredictionGame` DO uses two tables: `users` (id, display_name, points, wins, losses, streak, best_streak) and `predictions` (asset, direction, entry_price, target_time, wager, status, exit_price, points_delta). Settlement runs via Durable Object alarms every 5 seconds.

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/prices` | GET | Current merged state (Pyth + Hyperliquid) for all 8 assets |
| `/api/latency` | GET | Latency history buffer + current source status |
| `/api/hip3` | GET | HIP-3 ecosystem data (all permissionless DEXs) |
| `/ws/prices` | WS | Real-time price stream (auto-reconnect, exponential backoff) |

### Example: Fetch Current Prices

```bash
curl https://deltascope.site/api/prices | jq '.assets[] | {symbol, pythPrice, markPrice, oracleDiscrepancy}'
```

```json
{
  "symbol": "BTC",
  "pythPrice": 66459.91,
  "markPrice": 66484.50,
  "oracleDiscrepancy": 0.037
}
```

---

## Performance Optimizations

- **Triple Pyth source** — Dual Hermes WS + REST polling for lowest oracle delay
- **16ms broadcast coalescing** — Microtask-based throttle prevents WS storm
- **Incremental JSON snapshots** — Only dirty assets recomputed per broadcast
- **Smart Placement** — Worker runs near Pyth/HL backends, not user edge
- **Self-hosted fonts** — Zero external CSS or font requests
- **Immutable asset caching** — Hashed filenames get `max-age=31536000`
- **Preconnect hints** — Full TCP+TLS established during HTML parse
- **HTML edge caching** — `max-age=5, stale-while-revalidate=30`
- **Security-hardened CSP** — No `unsafe-eval`, strict connect-src whitelist

---

## Security

- Content Security Policy with strict directives (no `unsafe-eval`)
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- Origin validation on WebSocket upgrades
- HttpOnly session cookies for chat
- No secrets in client bundle

---

## Roadmap

DeltaScope is evolving from a price intelligence dashboard into a full prediction market platform on HyperEVM (Hyperliquid's EVM chain).

### Completed
- [x] Real-time oracle & DEX price monitoring (8 assets)
- [x] Pyth Pro (Lazer) integration for sub-50ms updates
- [x] Infrastructure latency monitoring with TradingView charts
- [x] AI chat assistant with 6 Pyth-powered tools
- [x] Predict & Win paper prediction game with leaderboard
- [x] Ticker analysis with top trader positioning data

### Next Up
- [ ] On-chain prediction market contracts (Solidity on HyperEVM testnet)
- [ ] Wallet connection (wagmi + viem for EVM)
- [ ] Pyth confidence-aware settlement (refund on unreliable oracle data)
- [ ] Dual oracle strategy: HyperEVM native precompile + Pyth confidence gates
- [ ] CPMM-based dynamic pricing for prediction shares
- [ ] Liquidity provider system with fee distribution

### Future
- [ ] HyperEVM mainnet deployment
- [ ] Multi-asset prediction pools
- [ ] Early exit mechanism (sell positions before settlement)
- [ ] Mobile-optimized trading experience
- [ ] Tournament mode with prize pools

---

## License

[Apache License 2.0](LICENSE)

---

## Acknowledgments

- [Pyth Network](https://pyth.network/) — Real-time oracle price data
- [Hyperliquid](https://hyperliquid.xyz/) — Perpetual DEX market data
- [TradingView Lightweight Charts](https://github.com/nicehash/lightweight-charts) — Charting library
- [Cloudflare Workers](https://workers.cloudflare.com/) — Edge runtime
- [React Router](https://reactrouter.com/) — Full-stack framework

Built by [@0xPilotSB](https://github.com/0xPilotSB)

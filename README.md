<p align="center">
  <img src="public/favicon.svg" width="64" height="64" alt="DeltaScope Logo" />
</p>

<h1 align="center">DeltaScope</h1>

<p align="center">
  <strong>Real-time Oracle & DEX Intelligence Platform</strong><br/>
  Monitor Pyth Network oracle prices vs Hyperliquid mark prices — catch discrepancies, track funding rates, analyze infrastructure latency, and follow global market hours in real-time.
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

**Implementation:** [`workers/price-aggregator.ts`](workers/price-aggregator.ts) — dual WS connect, REST poll, freshness dedup via `publishTime` comparison.

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

Displayed per-asset with color-coded severity badges. Assets exceeding 0.5% are flagged, and a global `discrepancyCount` appears in the dashboard header.

### 4. Publish Delay Analytics + 7-Day Persistence

The Latency Monitor tracks the **median Pyth publish delay** across all feeds:

```
publishDelay = now() - (publishTime from Pyth)
```

Two-tier persistence in SQLite (Durable Object):
- **Fine-grained (24h):** 5-second samples for recent analysis
- **Aggregated (7 days):** 1-minute P50/P95/P99/MAX percentiles for co-location analysis

Source uptime events (WS connect/disconnect) are also persisted for the full 7-day window.

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

### 6. Spike Filter — Tick Integrity

Every Pyth tick passes a **1% deviation guard** before being written to the tick buffer:

```typescript
if (arr.length > 0) {
  const deviation = Math.abs(price - last) / last;
  if (deviation > 0.01) continue; // >1% in one tick = bad oracle data
}
```

This eliminates chart spikes caused by Pyth oracle noise — valid crypto moves never exceed 1% in a single 1-second interval.

---

## Features

### Dashboard (`/`)
- Real-time price table: 8 major assets with Pyth oracle prices vs Hyperliquid mark prices
- Oracle discrepancy badges (color-coded by severity: green <0.1%, yellow <0.5%, red ≥0.5%)
- 24h volume, open interest, annualized funding rates (live WebSocket)
- HIP-3 ecosystem overview (permissionless perp DEXs on Hyperliquid)
- **Market Hours widget** — 8-exchange mini-Gantt with live open/closed status
- 60fps React rendering via Zustand granular selectors + `React.memo` dirty-only re-renders
- 1s/5s/15s/30s/1m/5m/15m candlestick + line chart (TradingView Lightweight Charts)

### Market Hours (`/market-hours`)
- **31 exchanges** across Crypto, Americas, Europe, Asia
- Live 24-hour UTC Gantt chart with animated now-marker
- Region + category filters, "Open only" toggle
- Session overlap analysis: 6 key high-liquidity windows for crypto traders
- Exchange reference table with live open/extended/closed status
- Data sourced from [loris.tools](https://loris.tools/market-hours) + [markethours.io](https://markethours.io/markets)

### Ticker Analysis (`/analysis`)
- Top-20 Hyperliquid leaderboard traders — 474+ open positions across 189 tickers
- Sort by size, trader count, or PnL
- Long/short bias bar with net positioning
- Stats: Traders Analyzed, Active Tickers, Net Long Bias, Last Updated

### Predict & Win (`/predict`)
- Paper prediction game using live Pyth + Hyperliquid prices
- UP/DOWN binary predictions on 8 major assets
- Two time windows: 1 minute (fast) and 5 minutes (standard)
- Points-based economy: 1,000 starting balance, wager 10/25/50/100 per prediction
- Alarm-based settlement — resolves automatically against live oracle prices
- Streak bonuses: 3+ consecutive wins earn +10% per extra win
- Global leaderboard: compete by points, win rate, and streaks

### Latency Monitor (`/latency`)
- Pyth Oracle Delay (median publish delay across feeds)
- Hyperliquid REST API round-trip time
- WebSocket delivery latency (edge → browser)
- Overall infrastructure health score (0-100)
- 7-day historical latency chart with range selector (1h/6h/24h/3d/7d)
- Source uptime event timeline (WS connect/disconnect events)
- P50/P95/P99 percentile trends

### AI Chat Assistant
- Natural language queries about any Pyth price feed
- Cross-references Pyth oracle data with Hyperliquid perps
- 6 structured tools for real-time and historical analysis
- Accessible via floating chat button on all pages

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
                    │  │                            │             │  │
                    │  │  SQLite (DO storage):      │             │  │
                    │  │  • price_candles (7d)      │             │  │
                    │  │  • latency_history (24h)   │             │  │
                    │  │  • latency_minutes (7d)    │             │  │
                    │  │  • source_events (7d)      │             │  │
                    │  └────────────────────────────────────────┘  │
                    │                                              │
                    │  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  │
                    │  │ Chat DO  │  │ PredictionGame│  │ React Router │  │
                    │  │ (AI SDK) │  │ DO (SQLite)   │  │ 7 (SSR)      │  │
                    │  └──────────┘  └──────────────┘  └──────────────┘  │
                    └──────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Single Durable Object for all price state** — The `PriceAggregator` DO maintains exactly one instance (`idFromName("global")`) that holds all upstream connections. Zero coordination overhead, guaranteed consistency.

2. **16ms broadcast throttle** — Upstream updates arrive at different rates (Pyth ~400ms, HL ~1000ms). Updates are coalesced within a 16ms window using `queueMicrotask()` for immediate dispatch.

3. **Incremental snapshot caching** — Only assets with changed data (`dirtyAssets` set) get JSON recomputed. Unchanged assets reuse cached objects, reducing `JSON.stringify` work.

4. **Two-tier SQLite persistence** — Fine-grained 5s samples (24h) + 1-minute aggregated P50/P95/P99 (7 days). Balances storage cost vs. co-location analysis granularity.

5. **60fps React rendering** — Granular Zustand selectors (one per field), `React.memo` with shallow-clone dirty detection, pre-computed badge styles, zero in-render object allocation.

6. **24/7 keep-alive via DO Alarms** — Alarm fires every 25 seconds, calls `ensureUpstream()` to keep all WebSocket connections alive with zero connected clients. Eliminates cold-start delays.

7. **Smart Placement** — Cloudflare routes the Worker closer to Pyth/Hyperliquid backends rather than user's edge, reducing upstream fetch latency.

---

## Tech Stack

### Backend

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Runtime** | Cloudflare Workers | Edge-deployed serverless runtime |
| **Persistent Backend** | Durable Objects (×4) | `PriceAggregator` — stateful price engine; `PredictionGame` — SQLite settlement; `Chat` — AI agent; `ChatSessionsDO` — session index |
| **Storage** | SQLite (DO) | 7-day latency history, candles, source events |
| **Oracle Ingestion** | Pyth Network Hermes | Dual WebSocket + REST polling, triple-source dedup |
| **Oracle Ingestion (Pro)** | Pyth Lazer (optional) | 3 redundant WS, `real_time` channel, sub-50ms |
| **DEX Data** | Hyperliquid API | WebSocket (`allMids`) + REST polling |
| **AI Engine** | Vercel AI SDK + Workers AI | Streaming LLM with 6 structured Pyth/HL tools |
| **API Layer** | REST + WebSocket | `/api/prices`, `/api/latency`, `/api/candles`, `/api/latency/history`, `/api/hip3`, `/ws/prices` |
| **Security** | CSP + CORS + Origin validation + TruffleHog CI | Hardened headers, WS origin checks, 0 secrets in codebase |

### Frontend

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Framework** | React Router 7 (SSR) | Server-side rendered pages with typed loaders |
| **State** | Zustand (granular selectors) | WS connection + 60fps tick aggregation |
| **Charts** | TradingView Lightweight Charts | Candlestick + line charts (price + latency) |
| **UI** | shadcn/ui + Tailwind CSS 4 | Dark theme, responsive, mobile-first |
| **Typography** | Space Grotesk (self-hosted) | Zero external font requests via @fontsource |
| **AI Chat** | @cloudflare/ai-chat + agents SDK | Lazy-mounted popup with retry-aware fetch |

### Infrastructure

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Deployment** | Cloudflare Workers + Smart Placement | Global CDN near Pyth/HL backends |
| **Package Manager** | Bun | Fast installs, builds, scripts |
| **Build** | Vite + React Router | SSR build with Cloudflare plugin |
| **Type Safety** | TypeScript (strict) | End-to-end types DO → loader → component |
| **Secret Scanning** | TruffleHog | Git history + filesystem scan, 0 findings |

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

Open `http://localhost:5173` — connects live to Pyth and Hyperliquid APIs.

### Deploy to Cloudflare

```bash
bun run deploy
```

Builds React Router SSR app and deploys Worker + Durable Objects to Cloudflare edge.

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
│   │   ├── historical-latency-chart.tsx  # 7-day latency chart with range selector
│   │   ├── latency-chart.tsx             # Live multi-line TradingView latency chart
│   │   ├── oracle-chat.tsx               # AI chat popup (lazy-mounted)
│   │   ├── tv-chart.tsx                  # TradingView candlestick/line chart
│   │   ├── mobile-nav.tsx
│   │   └── ui/                           # shadcn/ui components
│   ├── routes/
│   │   ├── home.tsx          # Dashboard — price table, stats, HIP-3, market hours widget
│   │   ├── market-hours.tsx  # Global Market Hours — 31 exchanges, Gantt, overlaps
│   │   ├── analysis.tsx      # Ticker deep-dive — leaderboard trader positioning
│   │   ├── predict.tsx       # Predict & Win — paper prediction game
│   │   ├── latency.tsx       # Infrastructure latency monitor + 7-day history
│   │   ├── developers.tsx    # API docs
│   │   └── chat.tsx          # Full-page chat
│   ├── stores/
│   │   └── price-store.ts    # Zustand — WS, 60fps tick aggregation, spike filter
│   ├── root.tsx              # App shell, meta tags, preconnect hints
│   └── app.css               # Tailwind + theme config
├── workers/
│   ├── app.ts                # Worker entry — routing, security headers, caching
│   ├── price-aggregator.ts   # Core DO — Pyth/HL ingestion, fan-out, SQLite persistence
│   ├── prediction-game.ts    # Prediction DO — SQLite, settlement alarms, leaderboard
│   ├── chat.ts               # AI chat agent (Workers AI + 6 Pyth tools)
│   ├── chat-sessions.ts      # Chat session index DO
│   ├── pyth-tools.ts         # 6 AI tools: search, prices, historical, TWAP, analysis
│   └── data-proxy.ts         # Local dev data proxy shim
├── wrangler.jsonc            # Cloudflare config — bindings, Smart Placement, compat
├── package.json
└── LICENSE                   # Apache 2.0
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/prices` | GET | Current merged state (Pyth + Hyperliquid) for all 8 assets |
| `/api/latency` | GET | Live latency stats + 24h rolling history |
| `/api/latency/history?range=1h\|6h\|24h\|3d\|7d` | GET | Historical P50/P95/P99 latency + source events |
| `/api/candles?symbol=BTC&range=1h\|6h\|24h\|3d\|7d` | GET | Historical OHLC candles from SQLite |
| `/api/hip3` | GET | HIP-3 ecosystem data (all permissionless DEXs) |
| `/ws/prices` | WS | Real-time price stream (16ms throttle, auto-reconnect) |

### Example: Fetch Current Prices

```bash
curl https://deltascope.site/api/prices | jq '.assets[] | {symbol, pythPrice, markPrice, oracleDiscrepancy}'
```

```json
{
  "symbol": "BTC",
  "pythPrice": 69333.68,
  "markPrice": 69305.00,
  "oracleDiscrepancy": 0.041
}
```

---

## Performance

- **Triple Pyth source** — Dual Hermes WS + REST polling for lowest oracle delay
- **Spike filter** — 1% deviation guard rejects bad oracle ticks before charting
- **16ms broadcast coalescing** — Microtask-based throttle prevents WS storm
- **Incremental JSON snapshots** — Only dirty assets recomputed per broadcast
- **60fps React** — Zustand granular selectors + React.memo dirty-only re-renders
- **Smart Placement** — Worker runs near Pyth/HL backends, not user edge
- **Self-hosted fonts** — Zero external CSS or font requests
- **Immutable asset caching** — Hashed filenames `max-age=31536000`
- **Preconnect hints** — Full TCP+TLS during HTML parse
- **HTML edge caching** — `max-age=5, stale-while-revalidate=30`

### Measured Latency (Cloudflare edge → browser)

| Route | TTFB | Total |
|-------|------|-------|
| `/` (home, warm DO) | ~50ms | ~100ms |
| `/market-hours` | ~361ms | ~572ms |
| `/analysis` | ~468ms | ~1.3s |
| `/latency` | ~456ms | ~605ms |
| `/api/prices` | ~580ms | ~580ms |

---

## Security

- Content Security Policy — no `unsafe-eval`, strict `connect-src` whitelist
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff`
- Origin validation on WebSocket upgrades
- HttpOnly session cookies for chat
- **TruffleHog scan: 0 verified secrets, 0 unverified secrets** across full git history + source files

---

## Roadmap

### Completed
- [x] Real-time oracle & DEX price monitoring (8 assets, 60fps)
- [x] Pyth Pro (Lazer) integration for sub-50ms updates
- [x] Spike filter — bad tick rejection on 1s chart
- [x] Infrastructure latency monitoring + 7-day SQLite persistence
- [x] P50/P95/P99 latency percentiles + source uptime event timeline
- [x] AI chat assistant with 6 Pyth-powered tools
- [x] Predict & Win paper prediction game with leaderboard
- [x] Ticker analysis with top trader positioning data
- [x] Global Market Hours — 31 exchanges, live Gantt chart
- [x] Mobile-responsive UI (2-col stat cards, sticky columns, FAB)

### Next Up
- [ ] On-chain prediction market contracts (Solidity on HyperEVM testnet)
- [ ] Wallet connection (wagmi + viem for EVM)
- [ ] Pyth confidence-aware settlement (refund on unreliable oracle data)
- [ ] WebSocket RTT measurement (Browser ↔ Edge DO round-trip)
- [ ] Dual oracle strategy: HyperEVM native precompile + Pyth confidence gates
- [ ] CPMM-based dynamic pricing for prediction shares

### Future
- [ ] HyperEVM mainnet deployment
- [ ] Multi-asset prediction pools
- [ ] Early exit mechanism (sell positions before settlement)
- [ ] Tournament mode with prize pools

---

## License

[Apache License 2.0](LICENSE)

---

## Acknowledgments

- [Pyth Network](https://pyth.network/) — Real-time oracle price data
- [Hyperliquid](https://hyperliquid.xyz/) — Perpetual DEX market data
- [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) — Charting library
- [Cloudflare Workers](https://workers.cloudflare.com/) — Edge runtime + Durable Objects
- [React Router](https://reactrouter.com/) — Full-stack SSR framework
- [loris.tools](https://loris.tools/market-hours) — Market hours reference data
- [markethours.io](https://markethours.io/markets) — Exchange UTC times verification

Built by [@0xPilotSB](https://github.com/0xPilotSB)

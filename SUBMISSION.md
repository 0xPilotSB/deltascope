# DeltaScope

**Team:** @0xPilotSB

**Submitted:** March 28, 2026

---

## Answer Capsule

DeltaScope is a **real-time oracle intelligence platform + paper prediction game** that monitors the gap between Pyth Network oracle prices and Hyperliquid DEX mark prices. It uses triple-source Pyth ingestion (dual Hermes WebSocket + REST polling) with Pyth Lazer ready for sub-50ms updates, an AI assistant with 6 Pyth-powered tools for querying 1,930+ price feeds, and a **Predict & Win** game where users bet on price direction using live Pyth oracle data — with confidence-aware settlement that refunds when oracle data is unreliable.

---

## What It Does

Oracle prices and DEX mark prices should match — but they don't. The gap reveals liquidation risk, funding rate mechanics, and infrastructure health that most traders are blind to.

DeltaScope gives traders **real-time visibility** into:
- **Oracle-mark spread** — Real-time discrepancy between Pyth oracle prices and Hyperliquid mark prices across 8 major assets
- **Pyth publish delay analytics** — How stale is your oracle data right now? Median publish delay tracked in a 10-min rolling buffer
- **Infrastructure latency monitoring** — Pyth Oracle Delay, Hyperliquid REST API latency, WebSocket delivery, and overall health score
- **Predict & Win** — Paper prediction game where users predict price direction (UP/DOWN) using live Pyth prices, with alarm-based settlement, streak bonuses, and a global leaderboard
- **AI-powered analysis** — Natural language queries across 1,930+ Pyth price feeds with 6 structured tools

This is the layer beneath the prices that nobody else shows.

---

## Live Demo

**Live:** [https://deltascope.site](https://deltascope.site)

**GitHub:** [https://github.com/0xPilotSB/deltascope](https://github.com/0xPilotSB/deltascope)

---

## Pyth Features Used

- ✅ **Price Feeds (off-chain)** — Triple-source Pyth Hermes ingestion (dual WebSocket + REST polling) with freshness dedup by `publishTime`
- ✅ **Price Feeds (Lazer-ready)** — Pyth Pro/Lazer integration for sub-50ms updates via 3 redundant endpoints when `PYTH_PRO_TOKEN` is set
- ✅ **Confidence Intervals** — Displayed per-asset alongside oracle prices; used in prediction settlement (refund when confidence is unreliable)
- ✅ **Historical Prices** — AI chat tool queries Pyth Hermes `/v2/updates/price/{timestamp}` for backtesting
- ✅ **TWAP** — AI chat tool queries `/v2/updates/twap/latest` for time-weighted average prices (1-600s windows)
- ✅ **Price Feed Search** — AI tool searches 1,930+ Pyth feeds by symbol, name, or asset type via `/v2/price_feeds`
- ❌ Entropy (randomness) — Not used

---

## Features

### 1. Dashboard (`/`)
Real-time price table for 8 major assets (BTC, ETH, SOL, HYPE, ARB, DOGE, AVAX, LINK) showing:
- Pyth oracle price vs Hyperliquid mark price side-by-side
- Oracle discrepancy badges (color-coded by severity)
- 24h change, annualized funding rates, open interest, 24h volume
- Aggregate stats: total volume ($2.5B+), total OI ($4.2B+), avg funding rate
- HIP-3 ecosystem overview (Hyperliquid's permissionless perp DEXs)

### 2. Ticker Analysis (`/analysis`)
- Top 20 Hyperliquid leaderboard trader positions per asset
- Long/short breakdown: counts, sizes, average entries, liquidation ranges
- Expandable position details: leverage, unrealized PnL, margin used
- Sort by position size, trader count, or PnL

### 3. Predict & Win (`/predict`) — NEW
Paper prediction game powered by live Pyth oracle prices:
- **Binary predictions:** UP or DOWN on any of 8 assets
- **Two time windows:** 1 minute (fast) and 5 minutes (standard)
- **Points economy:** 1,000 starting balance, wager 10/25/50/100 per prediction
- **Alarm-based settlement:** Predictions resolve automatically via Durable Object alarms against live Pyth prices
- **Streak bonuses:** 3+ consecutive wins earn +10% bonus per extra win
- **Global leaderboard:** Compete by points, win rate, and streaks
- **Safety mechanics:** Refund on oracle unavailability or zero price movement
- **Zero real money** — Validates the prediction market concept before on-chain deployment on HyperEVM

### 4. Latency Monitor (`/latency`)
Infrastructure intelligence inspired by HyperLatency:
- **Pyth Oracle Delay** — Median publish delay across all tracked feeds
- **Hyperliquid REST API** — Round-trip time to `api.hyperliquid.xyz`
- **WebSocket Delivery** — Edge DO → browser delivery latency
- **Overall Health Score** — Composite 0-100 score
- Multi-line TradingView chart with 10-min rolling history (120 samples)
- Source health table with P50/P95/MIN/MAX percentiles

### 5. AI Chat Assistant
Natural language queries powered by 6 structured Pyth tools:

| Tool | What It Does | Pyth API Used |
|------|-------------|---------------|
| `searchPriceFeeds` | Search 1,930+ feeds by symbol/name | `/v2/price_feeds` |
| `getLatestPrices` | Real-time prices with confidence | `/v2/updates/price/latest` |
| `getHistoricalPrice` | Price at any historical timestamp | `/v2/updates/price/{timestamp}` |
| `getTwap` | Time-weighted average (1-600s) | `/v2/updates/twap/latest` |
| `getHyperliquidData` | Cross-reference with HL perps | Hyperliquid REST API |
| `analyzePriceFeed` | Full analysis package | Multiple endpoints combined |

### 6. Developer API (`/developers`)
REST + WebSocket endpoints documented for integration:
- `GET /api/prices` — Current merged Pyth + Hyperliquid state
- `GET /api/latency` — Latency history + source health
- `GET /api/hip3` — HIP-3 ecosystem data
- `WS /ws/prices` — Real-time stream (16ms broadcast coalescing)

---

## Screenshots / Media

### Dashboard — Real-time Oracle vs DEX Prices
![Dashboard](https://deltascope.site/og-image.png)

*8 assets with Pyth oracle prices vs Hyperliquid mark prices, discrepancy monitoring, funding rates, open interest, and 24h volume*

### Predict & Win — Paper Prediction Game
*Binary UP/DOWN predictions on live Pyth prices with points economy, countdown timers, streak bonuses, and global leaderboard*

### Latency Monitor — Infrastructure Intelligence
*Live Pyth oracle delay (1826ms Hermes → client), Hyperliquid API latency (85ms), WebSocket delivery, and overall health score with TradingView charts*

### AI Chat — 6 Pyth-Powered Tools
*Natural language queries: "Compare BTC and ETH funding rates" → AI fetches real-time Pyth prices, queries Hyperliquid funding/OI, computes discrepancies, and presents structured analysis*

---

## Architecture

```
                    ┌──────────────────────────────────────────────────┐
                    │              Cloudflare Edge (24/7)               │
                    │                                                    │
 Browsers ────WS────┤  ┌──────────────────────────────────────────────┐  │
                    │  │       PriceAggregator (Durable Object)        │  │
                    │  │                                                │  │
                    │  │  Pyth Hermes WS ──┐                           │  │
                    │  │  Pyth Hermes Beta ─┼─▶ Merge + Dedup          │  │
                    │  │  Pyth REST Poll ──┘    by publishTime         │  │
                    │  │                            │                   │  │
                    │  │  HL allMids WS ────────────┤                   │  │
                    │  │  HL Meta REST (3s) ────────┤                   │  │
                    │  │                            ▼                   │  │
                    │  │                    Fan-out to clients          │  │
                    │  │                    (16ms throttle)             │  │
                    │  └──────────────────────────────────────────────┘  │
                    │                                                    │
                    │  ┌──────────────┐  ┌──────────────┐               │
                    │  │ Chat DO      │  │ PredictionGame│               │
                    │  │ (AI + Tools) │  │ DO (SQLite)   │               │
                    │  └──────────────┘  └──────────────┘               │
                    │                                                    │
                    │  ┌──────────────────────────────────────────────┐  │
                    │  │         React Router 7 (SSR)                  │  │
                    │  │         + Security Headers + Edge Caching     │  │
                    │  └──────────────────────────────────────────────┘  │
                    └──────────────────────────────────────────────────┘
```

### Predict & Win Settlement Flow

```
User clicks UP/DOWN → PredictionGame DO
  1. Validate wager (sufficient points)
  2. Fetch entry price from PriceAggregator DO (live Pyth price)
  3. Deduct points atomically
  4. Store prediction in SQLite
  5. Schedule DO alarm (duration + 1s)

Alarm fires → Settlement
  1. Fetch exit price from PriceAggregator DO
  2. Compare direction (up/down vs actual movement)
  3. Calculate payout (wager + streak bonus)
  4. Update points, wins/losses, streak in SQLite
  5. Reschedule alarm if more pending predictions
```

---

## Tech Stack

**Framework/Language:** React Router 7 (TypeScript), Vite, Tailwind CSS 4, shadcn/ui

**Blockchain/Oracle:** Pyth Network (Hermes WebSocket + REST + Lazer-ready), Hyperliquid L1 (WebSocket + REST)

**Agent Framework:** Vercel AI SDK + Cloudflare Workers AI (6 structured Pyth tools with codemode)

**Deployment:** Cloudflare Workers + 4 Durable Objects (edge-deployed, 24/7 uptime via DO alarms, Smart Placement)

### Full Backend Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Runtime | Cloudflare Workers | Edge-deployed serverless runtime with Smart Placement |
| PriceAggregator DO | Durable Object (stateful) | 4 upstream connections (2× Pyth WS + 1× HL WS + 1× REST), 16ms broadcast coalescing, 24/7 alarm keep-alive |
| PredictionGame DO | Durable Object (SQLite) | Paper prediction market: users, predictions, leaderboard, alarm-based settlement |
| Chat DO | Durable Object (AI SDK) | Streaming LLM with 6 structured Pyth tools |
| ChatSessionsDO | Durable Object (SQLite) | Session index per anonymous user |
| Oracle Ingestion | Pyth Hermes (dual WS + REST) | Triple-source freshness dedup by publishTime |
| Oracle Ingestion (Pro) | Pyth Lazer (optional) | 3 redundant WS endpoints, real_time channel, sub-50ms |
| DEX Data | Hyperliquid API | allMids WebSocket + metaAndAssetCtxs REST (3s poll) |

### Full Frontend Stack

| Component | Technology |
|-----------|-----------|
| Framework | React Router 7 (SSR) with typed loaders/actions |
| State | Zustand (WebSocket connection + tick aggregation) |
| Charts | TradingView Lightweight Charts (candlestick + multi-line latency) |
| UI | shadcn/ui + Tailwind CSS 4 (dark theme, responsive) |
| Typography | Space Grotesk (self-hosted via @fontsource) |
| AI Chat | @cloudflare/ai-chat + agents SDK (lazy-mounted popup) |

---

## Key Design Decisions

1. **Single global PriceAggregator** — One DO instance holds all upstream connections. Zero coordination overhead, guaranteed consistency.

2. **16ms broadcast coalescing** — `queueMicrotask()` for immediate dispatch or `setTimeout()` for remaining window. Prevents WebSocket storm from multiple upstream sources.

3. **Incremental snapshot caching** — Only `dirtyAssets` get JSON recomputed per broadcast. Unchanged assets reuse cached objects.

4. **24/7 keep-alive via DO Alarms** — 25-second alarm cycle keeps all upstream connections alive even with zero clients. Eliminates cold-start delays.

5. **Alarm-based prediction settlement** — PredictionGame DO schedules alarms per prediction duration. Settlement fetches live prices from PriceAggregator via DO-to-DO RPC. Atomic SQLite updates prevent race conditions.

6. **Triple Pyth source** — Dual Hermes WS (main + beta) + REST polling. Freshest `publishTime` wins per asset. ~10-15% lower oracle delay than single WS.

---

## Security

- Content Security Policy (no `unsafe-eval`, strict `connect-src` whitelist)
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- Origin validation on WebSocket upgrades
- HttpOnly session cookies (SameSite=Lax)
- `crypto.randomUUID()` for session IDs (CWE-338 remediated)
- No secrets in client bundle
- Atomic SQLite wager deduction (prevents double-spend on rapid clicks)

---

## Content Contributions (Required)

* **Public Post (Reddit, Dev.to, or Hashnode):** [URL]
* **Technical Contribution (Stack Overflow answer or GitHub gist/example):** [URL]
* **Bonus — X Platform Post:** [URL]
* **Bonus — Wikipedia Contribution (optional):** [URL or diff link]

---

## Licensing

This project is licensed under **Apache 2.0** (required for all submissions).

---

## Eligibility Confirmation

- [x] I am 18+ years old
- [x] I am not located in an OFAC-sanctioned jurisdiction
- [x] I confirm this is an original work created during the hackathon period
- [x] I have read and agree to the Terms & Conditions

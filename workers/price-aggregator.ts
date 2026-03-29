import { DurableObject } from "cloudflare:workers";

/**
 * PriceAggregator DO — ultra-low-latency price streaming:
 *
 * DUAL-MODE PYTH:
 * - If PYTH_PRO_TOKEN is set → connects to Pyth Pro (Lazer) WebSocket
 *   at wss://pyth-lazer-{0,1,2}.dourolabs.app/v1/stream
 *   with `real_time` channel for 1-50ms updates
 * - Otherwise → falls back to free Pyth Hermes WebSocket
 *
 * HYPERLIQUID:
 * - Outbound WebSocket to wss://api.hyperliquid.xyz/ws
 *   subscribing to allMids for real-time mark prices
 * - REST poll every 5s for metadata (funding, OI, volume)
 *
 * On ANY upstream update → merge + fan out to all clients within 16ms
 */

// ─── Pyth Pro (Lazer) Feed IDs ────────────────────────────
// Source: https://pyth.dourolabs.app/v1/symbols
// All feeds use exponent -8

const PYTH_PRO_IDS: Record<string, number> = {
  BTC: 1,    // min_channel: real_time
  ETH: 2,    // min_channel: real_time
  SOL: 6,    // min_channel: real_time
  HYPE: 110, // min_channel: fixed_rate@200ms
  ARB: 37,   // min_channel: fixed_rate@200ms
  DOGE: 13,  // min_channel: fixed_rate@200ms
  AVAX: 18,  // min_channel: fixed_rate@200ms
  LINK: 19,  // min_channel: fixed_rate@200ms
};

// Feeds that support real_time channel (sub-50ms)
const PYTH_PRO_REALTIME_IDS: number[] = [1, 2, 6]; // BTC, ETH, SOL
// Feeds that require fixed_rate@200ms minimum
const PYTH_PRO_FIXED_IDS: number[] = [110, 37, 13, 18, 19]; // HYPE, ARB, DOGE, AVAX, LINK

// ─── Pyth Hermes (free) Feed IDs (fallback) ──────────────

const PYTH_HERMES_IDS: Record<string, string> = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  HYPE: "0x4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b",
  ARB: "0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5",
  DOGE: "0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c",
  AVAX: "0x93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7",
  LINK: "0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221",
};

// Reverse maps
const HERMES_ID_TO_SYMBOL: Record<string, string> = {};
for (const [sym, id] of Object.entries(PYTH_HERMES_IDS)) {
  HERMES_ID_TO_SYMBOL[id] = sym;
  HERMES_ID_TO_SYMBOL[id.slice(2)] = sym;
}

const PRO_ID_TO_SYMBOL: Record<number, string> = {};
for (const [sym, id] of Object.entries(PYTH_PRO_IDS)) {
  PRO_ID_TO_SYMBOL[id] = sym;
}

const SYMBOLS = Object.keys(PYTH_PRO_IDS);

// Pyth Pro WebSocket endpoints (connect to all 3 for redundancy)
const PYTH_PRO_ENDPOINTS = [
  "wss://pyth-lazer-0.dourolabs.app/v1/stream",
  "wss://pyth-lazer-1.dourolabs.app/v1/stream",
  "wss://pyth-lazer-2.dourolabs.app/v1/stream",
];

// ─── Types ────────────────────────────────────────────────

interface AssetState {
  pythPrice: number;
  pythConfidence: number;
  pythExpo: number;
  pythPublishTime: number; // microseconds for Pro, seconds for Hermes
  bestBidPrice: number;
  bestAskPrice: number;
  publisherCount: number;
  markPrice: number;
  fundingRate: number;
  openInterest: number;
  volume24h: number;
  prevDayPx: number;
}

// ─── DO ───────────────────────────────────────────────────

export class PriceAggregator extends DurableObject<Env> {
  private state: Map<string, AssetState> = new Map();
  private cachedJson: string | null = null;
  private sqliteReady = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  // Upstream connections
  private pythProWs: (WebSocket | null)[] = [null, null, null];
  private pythHermesWs: WebSocket | null = null;
  private pythHermesBetaWs: WebSocket | null = null; // Dual Hermes: beta endpoint
  private hlWs: WebSocket | null = null;
  private pythProConnected: boolean[] = [false, false, false];
  private pythHermesConnected = false;
  private pythHermesBetaConnected = false;
  private hlConnected = false;
  private upstreamActive = false;
  private usingPythPro = false;

  // Timers
  private metaPollTimer: ReturnType<typeof setTimeout> | null = null;
  private pythRestPollTimer: ReturnType<typeof setTimeout> | null = null; // REST supplement
  private pythRestInFlight = false; // Prevent concurrent REST polls
  private reconnectTimers: (ReturnType<typeof setTimeout> | null)[] = [null, null, null, null, null, null]; // +1 for beta
  private reconnectAttempts: number[] = [0, 0, 0, 0, 0, 0];
  private broadcastPending = false;
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  // Latency tracking
  private lastPythUpdateUs = 0;
  private pythProLatencyMs = 0;
  private hlRestLatencyMs = 0;
  private lastHlWsTime = 0;
  private hlWsIntervalMs = 0;
  private pythPublishDelayMs = 0;

  // Latency history ring buffer (120 samples @ 5s = 10 min)
  private latencyHistory: Array<{
    t: number;
    pyth: number;
    hlRest: number;
    hlWs: number;
    publishDelay: number;
    wsRtt: number;
  }> = [];
  private latencyHistoryTimer: ReturnType<typeof setTimeout> | null = null;

  // HIP-3 data cache
  private hip3Data: any = null;
  private hip3PollTimer: ReturnType<typeof setTimeout> | null = null;

  // Minute-level latency aggregation buffer (flushed every 60s)
  private latencyMinuteBuffer: Array<{ pyth: number; hlRest: number; hlWs: number; publishDelay: number }> = [];
  private lastMinuteFlush = 0;

  // ─── Perf: exponent cache ──────────────────────────────
  private expoCache: Map<number, number> = new Map([
    [-10, 1e-10], [-9, 1e-9], [-8, 1e-8], [-7, 1e-7], [-6, 1e-6],
    [-5, 1e-5], [-4, 1e-4], [-3, 1e-3], [-2, 1e-2], [-1, 0.1],
    [0, 1], [1, 10], [2, 100],
  ]);

  // ─── Perf: microtask broadcast with 16ms floor ────────
  private lastBroadcastTime = 0;

  // ─── Perf: dirty flag per-asset for incremental snapshot
  private dirtyAssets: Set<string> = new Set();
  // Pre-computed per-asset JSON objects, keyed by symbol
  private assetSnapshotCache: Map<string, object> = new Map();
  // Reusable assets array to reduce allocations
  private reusableAssets: object[] = [];
  // Cache last HL mid strings to skip parseFloat when unchanged
  private lastHlMidStr: Map<string, string> = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
    for (const sym of SYMBOLS) {
      this.state.set(sym, {
        pythPrice: 0,
        pythConfidence: 0,
        pythExpo: 0,
        pythPublishTime: 0,
        bestBidPrice: 0,
        bestAskPrice: 0,
        publisherCount: 0,
        markPrice: 0,
        fundingRate: 0,
        openInterest: 0,
        volume24h: 0,
        prevDayPx: 0,
      });
    }
    // Load persisted data before handling any requests
    ctx.blockConcurrencyWhile(async () => {
      try {
        this.initSqlite();
        this.loadFromSqlite();
      } catch (e) {
        console.error("SQLite init failed:", e);
      }
    });
    // 24/7 keep-alive: set alarm on construction so DO never sleeps
    ctx.storage.setAlarm(Date.now() + 25000);
  }

  // ─── SQLite persistence ─────────────────────────────────────

  private initSqlite() {
    const sql = this.ctx.storage.sql;

    // Last-known price state per asset (survives restarts)
    sql.exec(`CREATE TABLE IF NOT EXISTS price_state (
      symbol TEXT PRIMARY KEY,
      pyth_price REAL, pyth_confidence REAL, pyth_expo INTEGER,
      pyth_publish_time REAL, best_bid REAL, best_ask REAL,
      publisher_count INTEGER, mark_price REAL, funding_rate REAL,
      open_interest REAL, volume_24h REAL, prev_day_px REAL,
      updated_at INTEGER
    )`);

    // 1-second OHLC candles for chart history (kept 7 days)
    sql.exec(`CREATE TABLE IF NOT EXISTS price_candles (
      symbol TEXT NOT NULL,
      t INTEGER NOT NULL,
      o REAL, h REAL, l REAL, c REAL,
      PRIMARY KEY (symbol, t)
    ) WITHOUT ROWID`);

    // Fine-grained latency samples every 5s (kept 24h)
    sql.exec(`CREATE TABLE IF NOT EXISTS latency_history (
      t INTEGER PRIMARY KEY,
      pyth REAL, hl_rest REAL, hl_ws REAL,
      publish_delay REAL, ws_rtt REAL
    )`);

    // 1-minute aggregated latency stats (kept 7 days — for co-location analysis)
    sql.exec(`CREATE TABLE IF NOT EXISTS latency_minutes (
      t INTEGER PRIMARY KEY,
      pyth_p50 REAL, pyth_p95 REAL, pyth_p99 REAL, pyth_max REAL,
      hl_rest_p50 REAL, hl_rest_p95 REAL, hl_rest_max REAL,
      hl_ws_p50 REAL, hl_ws_p95 REAL, hl_ws_max REAL,
      publish_delay_avg REAL, publish_delay_max REAL,
      sample_count INTEGER
    )`);

    // Source uptime events (kept 7 days — tracks connection drops/reconnects)
    sql.exec(`CREATE TABLE IF NOT EXISTS source_events (
      t INTEGER NOT NULL,
      source TEXT NOT NULL,
      event TEXT NOT NULL,
      detail TEXT
    )`);

    // Last HIP-3 snapshot JSON
    sql.exec(`CREATE TABLE IF NOT EXISTS hip3_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT, updated_at INTEGER
    )`);

    // Indexes for time-range queries and cleanup
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_candles_t ON price_candles(t)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_latency_t ON latency_history(t)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_latency_min_t ON latency_minutes(t)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_source_events_t ON source_events(t)`);

    this.sqliteReady = true;
  }

  /** Load persisted data into memory on cold start */
  private loadFromSqlite() {
    if (!this.sqliteReady) return;
    const sql = this.ctx.storage.sql;

    // Restore price state
    let hasData = false;
    for (const row of sql.exec("SELECT * FROM price_state")) {
      const sym = row.symbol as string;
      const st = this.state.get(sym);
      if (!st) continue;
      st.pythPrice = (row.pyth_price as number) || 0;
      st.pythConfidence = (row.pyth_confidence as number) || 0;
      st.pythExpo = (row.pyth_expo as number) || 0;
      st.pythPublishTime = (row.pyth_publish_time as number) || 0;
      st.bestBidPrice = (row.best_bid as number) || 0;
      st.bestAskPrice = (row.best_ask as number) || 0;
      st.publisherCount = (row.publisher_count as number) || 0;
      st.markPrice = (row.mark_price as number) || 0;
      st.fundingRate = (row.funding_rate as number) || 0;
      st.openInterest = (row.open_interest as number) || 0;
      st.volume24h = (row.volume_24h as number) || 0;
      st.prevDayPx = (row.prev_day_px as number) || 0;
      if (st.pythPrice > 0 || st.markPrice > 0) hasData = true;
      this.dirtyAssets.add(sym);
    }

    // Pre-build snapshot so first request is instant
    if (hasData) {
      this.cachedJson = this.buildSnapshot();
    }

    // Restore latency history
    const latRows = sql.exec(
      "SELECT * FROM latency_history ORDER BY t DESC LIMIT 120"
    );
    this.latencyHistory = [];
    for (const row of latRows) {
      this.latencyHistory.unshift({
        t: row.t as number,
        pyth: (row.pyth as number) || 0,
        hlRest: (row.hl_rest as number) || 0,
        hlWs: (row.hl_ws as number) || 0,
        publishDelay: (row.publish_delay as number) || 0,
        wsRtt: (row.ws_rtt as number) || 0,
      });
    }

    // Restore HIP-3 snapshot
    const hip3Row = sql.exec("SELECT data FROM hip3_snapshot WHERE id = 1").toArray();
    if (hip3Row.length > 0 && hip3Row[0].data) {
      try { this.hip3Data = JSON.parse(hip3Row[0].data as string); } catch {}
    }
  }

  /** Flush current state to SQLite (called every 5s) */
  private persistToSqlite() {
    if (!this.sqliteReady) return;
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const SEVEN_DAYS_S = 7 * 24 * 60 * 60;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // Batch upsert price state
    for (const [sym, st] of this.state) {
      if (st.pythPrice === 0 && st.markPrice === 0) continue;
      sql.exec(
        `INSERT OR REPLACE INTO price_state VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        sym, st.pythPrice, st.pythConfidence, st.pythExpo,
        st.pythPublishTime, st.bestBidPrice, st.bestAskPrice,
        st.publisherCount, st.markPrice, st.fundingRate,
        st.openInterest, st.volume24h, st.prevDayPx, now,
      );
    }

    // Append 1s OHLC candles for each asset
    const candleT = Math.floor(now / 1000); // 1s bucket
    for (const [sym, st] of this.state) {
      const price = st.pythPrice || st.markPrice;
      if (!price || price <= 0) continue;
      sql.exec(
        `INSERT INTO price_candles (symbol, t, o, h, l, c) VALUES (?,?,?,?,?,?)
         ON CONFLICT(symbol, t) DO UPDATE SET
           h = MAX(h, excluded.h), l = MIN(l, excluded.l), c = excluded.c`,
        sym, candleT, price, price, price, price,
      );
    }

    // Prune candles older than 7 days
    sql.exec("DELETE FROM price_candles WHERE t < ?", candleT - SEVEN_DAYS_S);

    // Persist fine-grained latency sample (kept 24h)
    if (this.upstreamActive) {
      const pythMs = this.usingPythPro ? this.pythProLatencyMs : this.pythPublishDelayMs;
      const hlRestMs = this.hlRestLatencyMs;
      const hlWsMs = this.hlWsIntervalMs;

      sql.exec(
        `INSERT OR REPLACE INTO latency_history VALUES (?,?,?,?,?,?)`,
        now, pythMs, hlRestMs, hlWsMs, this.pythPublishDelayMs, 0,
      );
      // Prune fine-grained samples older than 24h
      sql.exec("DELETE FROM latency_history WHERE t < ?", now - ONE_DAY_MS);

      // Buffer for minute-level aggregation
      this.latencyMinuteBuffer.push({
        pyth: pythMs,
        hlRest: hlRestMs,
        hlWs: hlWsMs,
        publishDelay: this.pythPublishDelayMs,
      });

      // Flush minute aggregation every 60s
      const currentMinute = Math.floor(now / 60000) * 60000;
      if (currentMinute > this.lastMinuteFlush && this.latencyMinuteBuffer.length > 0) {
        this.flushMinuteLatency(sql, currentMinute);
        this.lastMinuteFlush = currentMinute;
      }
    }

    // Prune minute-level latency older than 7 days
    sql.exec("DELETE FROM latency_minutes WHERE t < ?", now - SEVEN_DAYS_MS);

    // Prune source events older than 7 days
    sql.exec("DELETE FROM source_events WHERE t < ?", now - SEVEN_DAYS_MS);

    // Persist HIP-3 snapshot
    if (this.hip3Data) {
      sql.exec(
        `INSERT OR REPLACE INTO hip3_snapshot VALUES (1, ?, ?)`,
        JSON.stringify(this.hip3Data), now,
      );
    }
  }

  /** Compute percentiles and flush minute-level latency stats */
  private flushMinuteLatency(sql: any, minuteTs: number) {
    const buf = this.latencyMinuteBuffer;
    if (buf.length === 0) return;

    const percentile = (arr: number[], p: number): number => {
      const sorted = arr.filter((v) => v > 0).sort((a, b) => a - b);
      if (sorted.length === 0) return 0;
      const idx = Math.ceil(sorted.length * p / 100) - 1;
      return sorted[Math.max(0, idx)];
    };

    const pythArr = buf.map((b) => b.pyth);
    const hlRestArr = buf.map((b) => b.hlRest);
    const hlWsArr = buf.map((b) => b.hlWs);
    const delayArr = buf.map((b) => b.publishDelay);

    sql.exec(
      `INSERT OR REPLACE INTO latency_minutes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      minuteTs,
      percentile(pythArr, 50), percentile(pythArr, 95), percentile(pythArr, 99),
      Math.max(0, ...pythArr),
      percentile(hlRestArr, 50), percentile(hlRestArr, 95),
      Math.max(0, ...hlRestArr),
      percentile(hlWsArr, 50), percentile(hlWsArr, 95),
      Math.max(0, ...hlWsArr),
      delayArr.reduce((a, b) => a + b, 0) / (delayArr.length || 1),
      Math.max(0, ...delayArr),
      buf.length,
    );

    this.latencyMinuteBuffer = [];
  }

  /** Record a source event (connect/disconnect/error) */
  private recordSourceEvent(source: string, event: string, detail?: string) {
    if (!this.sqliteReady) return;
    try {
      this.ctx.storage.sql.exec(
        `INSERT INTO source_events VALUES (?,?,?,?)`,
        Date.now(), source, event, detail ?? null,
      );
    } catch {}
  }

  private startPersistTimer() {
    if (this.persistTimer) return;
    this.persistTimer = setInterval(() => {
      try { this.persistToSqlite(); } catch (e) {
        console.error("SQLite persist error:", e);
      }
    }, 5000);
  }

  private stopPersistTimer() {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
  }

  // ─── DO Alarm: 24/7 keep-alive ─────────────────────────────
  async alarm() {
    // Keep upstream connections alive even with 0 clients
    this.ensureUpstream();
    // Re-arm alarm every 25s (must be under 30s grace period)
    this.ctx.storage.setAlarm(Date.now() + 25000);
  }

  // ─── Latency history sampling ─────────────────────────────

  private startLatencySampling() {
    if (this.latencyHistoryTimer) return;
    const sample = () => {
      if (!this.upstreamActive) return;
      this.latencyHistory.push({
        t: Date.now(),
        pyth: this.usingPythPro ? this.pythProLatencyMs : this.pythPublishDelayMs,
        hlRest: this.hlRestLatencyMs,
        hlWs: this.hlWsIntervalMs,
        publishDelay: this.pythPublishDelayMs,
        wsRtt: 0, // client-side metric, placeholder for server reference
      });
      // Keep max 120 samples (~10 min at 5s)
      if (this.latencyHistory.length > 120) {
        this.latencyHistory.splice(0, this.latencyHistory.length - 120);
      }
      this.latencyHistoryTimer = setTimeout(sample, 5000);
    };
    sample();
  }

  // ─── Client-facing endpoints ────────────────────────────

  /** Cached exponent lookup — exponents rarely change */
  private pow10(expo: number): number {
    let v = this.expoCache.get(expo);
    if (v === undefined) {
      v = Math.pow(10, expo);
      this.expoCache.set(expo, v);
    }
    return v;
  }


  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(this.buildSnapshot());
      this.ensureUpstream();
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/prices") {
      if (!this.cachedJson) {
        await this.fetchInitialData();
        this.cachedJson = this.buildSnapshot();
      }
      return new Response(this.cachedJson, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=0, stale-while-revalidate=2",
        },
      });
    }

    if (url.pathname === "/latency") {
      return new Response(JSON.stringify({
        history: this.latencyHistory,
        current: {
          pythSourceMs: this.usingPythPro ? this.pythProLatencyMs : null,
          pythPublishDelayMs: this.pythPublishDelayMs,
          hlRestLatencyMs: this.hlRestLatencyMs,
          hlWsIntervalMs: this.hlWsIntervalMs,
          sources: {
            pythPro: this.usingPythPro && this.pythProConnected.some(Boolean),
            pythHermes: this.pythHermesConnected,
            pythHermesBeta: this.pythHermesBetaConnected,
            hlWs: this.hlConnected,
            mode: this.usingPythPro ? "pro" : "hermes",
          },
        },
      }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      });
    }

    // ─── Historical latency (7-day, minute-resolution) ──
    if (url.pathname === "/latency/history") {
      if (!this.sqliteReady) {
        return new Response(JSON.stringify({ minutes: [], events: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      const sql = this.ctx.storage.sql;
      const range = url.searchParams.get("range") || "24h";
      const rangeMs: Record<string, number> = {
        "1h": 3600000,
        "6h": 21600000,
        "24h": 86400000,
        "3d": 259200000,
        "7d": 604800000,
      };
      const since = Date.now() - (rangeMs[range] ?? 86400000);

      const minutes = [];
      for (const row of sql.exec(
        `SELECT * FROM latency_minutes WHERE t > ? ORDER BY t ASC`, since
      )) {
        minutes.push({
          t: row.t,
          pythP50: row.pyth_p50, pythP95: row.pyth_p95, pythP99: row.pyth_p99, pythMax: row.pyth_max,
          hlRestP50: row.hl_rest_p50, hlRestP95: row.hl_rest_p95, hlRestMax: row.hl_rest_max,
          hlWsP50: row.hl_ws_p50, hlWsP95: row.hl_ws_p95, hlWsMax: row.hl_ws_max,
          publishDelayAvg: row.publish_delay_avg, publishDelayMax: row.publish_delay_max,
          samples: row.sample_count,
        });
      }

      const events = [];
      for (const row of sql.exec(
        `SELECT * FROM source_events WHERE t > ? ORDER BY t DESC LIMIT 200`, since
      )) {
        events.push({
          t: row.t, source: row.source, event: row.event, detail: row.detail,
        });
      }

      return new Response(JSON.stringify({ minutes, events }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=30",
        },
      });
    }

    // ─── Historical candles (7-day) ──
    if (url.pathname === "/candles") {
      if (!this.sqliteReady) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
        });
      }
      const sql = this.ctx.storage.sql;
      const symbol = url.searchParams.get("symbol") || "BTC";
      const range = url.searchParams.get("range") || "1h";
      const rangeS: Record<string, number> = {
        "1h": 3600, "6h": 21600, "24h": 86400, "3d": 259200, "7d": 604800,
      };
      const since = Math.floor(Date.now() / 1000) - (rangeS[range] ?? 3600);

      const candles = [];
      for (const row of sql.exec(
        `SELECT t, o, h, l, c FROM price_candles WHERE symbol = ? AND t > ? ORDER BY t ASC`,
        symbol, since
      )) {
        candles.push({ t: row.t, o: row.o, h: row.h, l: row.l, c: row.c });
      }

      return new Response(JSON.stringify(candles), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=5",
        },
      });
    }

    if (url.pathname === "/hip3") {
      // Non-blocking: return cached/SQLite data immediately, trigger background poll if stale
      if (!this.hip3Data) {
        // Don't block — schedule background poll and return empty
        this.pollHip3();
      } else if (Date.now() - (this.hip3Data.timestamp || 0) > 60000) {
        // Stale > 60s — trigger background refresh
        this.pollHip3();
      }
      return new Response(JSON.stringify(this.hip3Data || { dexes: [], timestamp: Date.now() }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=5, stale-while-revalidate=10",
        },
      });
    }

    // Historical 1s OHLC candles from SQLite
    if (url.pathname === "/history") {
      const symbol = url.searchParams.get("symbol") || "BTC";
      const hours = Math.min(Number(url.searchParams.get("hours") || "1"), 24);
      const since = Math.floor(Date.now() / 1000) - hours * 3600;

      if (!this.sqliteReady) {
        return new Response(JSON.stringify({ candles: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const rows = this.ctx.storage.sql.exec(
        "SELECT t, o, h, l, c FROM price_candles WHERE symbol = ? AND t >= ? ORDER BY t",
        symbol, since,
      ).toArray();

      return new Response(JSON.stringify({
        symbol,
        candles: rows,
        count: rows.length,
      }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=1, stale-while-revalidate=5",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const msg = typeof message === "string" ? message : new TextDecoder().decode(message);
    // Note: "ping"→"pong" is handled automatically by setWebSocketAutoResponse
    if (msg === "refresh") ws.send(this.buildSnapshot());
  }

  // Grace period timer — keep upstream alive briefly after last client disconnects
  private gracePeriodTimer: ReturnType<typeof setTimeout> | null = null;

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    // Codes 1005 and 1006 are reserved and cannot be sent in ws.close()
    const safeCode = (code === 1005 || code === 1006) ? 1000 : code;
    ws.close(safeCode, reason);
    // DO stays alive via alarm — no teardown on last client disconnect
  }

  async webSocketError(ws: WebSocket) {
    ws.close(1011, "Unexpected error");
  }

  // ─── Upstream management ────────────────────────────────

  private reconnectDelay(idx: number): number {
    // Instant first reconnect for critical Hermes feeds (indices 3, 5)
    if ((idx === 3 || idx === 5) && this.reconnectAttempts[idx] === 0) {
      this.reconnectAttempts[idx]++;
      return 0;
    }
    const base = Math.min(500 * Math.pow(2, this.reconnectAttempts[idx]), 15000);
    const jitter = Math.random() * 500;
    this.reconnectAttempts[idx]++;
    return base + jitter;
  }

  private ensureUpstream() {
    // Cancel any pending teardown grace period
    if (this.gracePeriodTimer) {
      clearTimeout(this.gracePeriodTimer);
      this.gracePeriodTimer = null;
    }
    if (this.upstreamActive) return;
    this.upstreamActive = true;

    // Start latency history sampling
    this.startLatencySampling();
    // Start SQLite persistence (every 5s)
    this.startPersistTimer();

    // Check if Pyth Pro token is available
    const token = (this.env as any).PYTH_PRO_TOKEN;
    this.usingPythPro = !!token;

    // Parallel initialization: fetch data + connect WebSockets simultaneously
    if (this.usingPythPro) {
      // Pyth Pro (Lazer): connect to all 3 endpoints for redundancy
      // Uses real_time channel for BTC/ETH/SOL, fixed_rate@200ms for others
      for (let i = 0; i < 3; i++) {
        this.connectPythPro(i, token);
      }
      // Pro supersedes Hermes — skip Hermes WS to save CPU (REST poll kept as emergency fallback)
    } else {
      // Dual Hermes: connect to both main and beta for lowest latency
      this.connectPythHermes("https://hermes.pyth.network/ws", false);
      this.connectPythHermes("https://hermes-beta.pyth.network/ws", true);
      // REST polling supplement: poll every 3s (rate-limited to 30/10s)
      this.startPythRestPoll();
    }
    this.connectHlWs();
    this.fetchInitialData().then(() => {
      this.startMetaPoll();
      this.startHip3Poll();
    });
  }

  private tearDownUpstream() {
    this.upstreamActive = false;
    // Final persist before shutting down
    try { this.persistToSqlite(); } catch {}
    this.stopPersistTimer();
    if (this.gracePeriodTimer) { clearTimeout(this.gracePeriodTimer); this.gracePeriodTimer = null; }
    for (let i = 0; i < 3; i++) {
      if (this.pythProWs[i]) { try { this.pythProWs[i]!.close(); } catch {} }
      this.pythProWs[i] = null;
      this.pythProConnected[i] = false;
    }
    if (this.pythHermesWs) { try { this.pythHermesWs.close(); } catch {} }
    this.pythHermesWs = null;
    this.pythHermesConnected = false;
    if (this.pythHermesBetaWs) { try { this.pythHermesBetaWs.close(); } catch {} }
    this.pythHermesBetaWs = null;
    this.pythHermesBetaConnected = false;
    if (this.hlWs) { try { this.hlWs.close(); } catch {} }
    this.hlWs = null;
    this.hlConnected = false;
    for (const t of this.reconnectTimers) { if (t) clearTimeout(t); }
    this.reconnectTimers = [null, null, null, null, null, null];
    if (this.metaPollTimer) clearTimeout(this.metaPollTimer);
    this.metaPollTimer = null;
    if (this.pythRestPollTimer) clearTimeout(this.pythRestPollTimer);
    this.pythRestPollTimer = null;
    if (this.latencyHistoryTimer) clearTimeout(this.latencyHistoryTimer);
    this.latencyHistoryTimer = null;
    if (this.hip3PollTimer) clearTimeout(this.hip3PollTimer);
    this.hip3PollTimer = null;
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    this.broadcastTimer = null;
  }

  // ─── Pyth Pro (Lazer) WebSocket ─────────────────────────

  private async connectPythPro(idx: number, token: string) {
    if (!this.upstreamActive) return;
    try {
      const resp = await fetch(PYTH_PRO_ENDPOINTS[idx], {
        headers: {
          Upgrade: "websocket",
          Authorization: `Bearer ${token}`,
        },
      });
      const ws = resp.webSocket;
      if (!ws) throw new Error("No webSocket on response");
      ws.accept();
      this.pythProWs[idx] = ws;
      this.pythProConnected[idx] = true;
      this.reconnectAttempts[idx] = 0;
      this.recordSourceEvent("pyth-pro", "connected", `shard-${idx}`);

      // Subscription 1: real_time channel for BTC, ETH, SOL (sub-50ms)
      ws.send(JSON.stringify({
        type: "subscribe",
        subscriptionId: idx * 10 + 1,
        priceFeedIds: PYTH_PRO_REALTIME_IDS,
        properties: [
          "price",
          "bestBidPrice",
          "bestAskPrice",
          "exponent",
          "feedUpdateTimestamp",
        ],
        formats: [],
        channel: "real_time",
        deliveryFormat: "json",
        jsonBinaryEncoding: "hex",
        ignoreInvalidFeeds: true,
      }));

      // Subscription 2: fixed_rate@200ms for HYPE, ARB, DOGE, AVAX, LINK
      ws.send(JSON.stringify({
        type: "subscribe",
        subscriptionId: idx * 10 + 2,
        priceFeedIds: PYTH_PRO_FIXED_IDS,
        properties: [
          "price",
          "bestBidPrice",
          "bestAskPrice",
          "exponent",
          "feedUpdateTimestamp",
        ],
        formats: [],
        channel: "fixed_rate@200ms",
        deliveryFormat: "json",
        jsonBinaryEncoding: "hex",
        ignoreInvalidFeeds: true,
      }));

      ws.addEventListener("message", (event) => {
        this.handlePythProMessage(event.data);
      });

      ws.addEventListener("close", () => {
        this.pythProConnected[idx] = false;
        this.pythProWs[idx] = null;
        this.recordSourceEvent("pyth-pro", "disconnected", `shard-${idx}`);
        if (this.upstreamActive) {
          this.reconnectTimers[idx] = setTimeout(() => this.connectPythPro(idx, token), this.reconnectDelay(idx));
        }
      });

      ws.addEventListener("error", () => { try { ws.close(); } catch {} });
    } catch (e) {
      console.error(`Pyth Pro WS[${idx}] connect error:`, e);
      this.pythProConnected[idx] = false;
      if (this.upstreamActive) {
        this.reconnectTimers[idx] = setTimeout(() => this.connectPythPro(idx, token), this.reconnectDelay(idx));
      }
    }
  }

  private handlePythProMessage(raw: string | ArrayBuffer) {
    try {
      const data = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      const msg = JSON.parse(data);

      if (msg.type === "streamUpdated" && msg.parsed?.priceFeeds) {
        const timestampUs = Number(msg.parsed.timestampUs);
        const nowUs = Date.now() * 1000;

        // Deduplicate: skip if we already processed this timestamp
        if (timestampUs <= this.lastPythUpdateUs) return;
        this.lastPythUpdateUs = timestampUs;
        this.pythProLatencyMs = Math.max(0, (nowUs - timestampUs) / 1000);

        for (const feed of msg.parsed.priceFeeds) {
          const symbol = PRO_ID_TO_SYMBOL[feed.priceFeedId];
          if (!symbol) continue;
          const st = this.state.get(symbol);
          if (!st) continue;

          // Lazer uses exponent -8 for all crypto feeds
          // Price is a string integer that needs exponent applied
          const expo = feed.exponent ?? -8;
          const mult = this.pow10(expo);

          if (feed.price !== undefined) st.pythPrice = Number(feed.price) * mult;
          if (feed.bestBidPrice !== undefined) st.bestBidPrice = Number(feed.bestBidPrice) * mult;
          if (feed.bestAskPrice !== undefined) st.bestAskPrice = Number(feed.bestAskPrice) * mult;
          if (feed.exponent !== undefined) st.pythExpo = feed.exponent;
          if (feed.feedUpdateTimestamp !== undefined) st.pythPublishTime = feed.feedUpdateTimestamp;
          this.dirtyAssets.add(symbol);
        }
        this.updatePublishDelay();
        this.scheduleBroadcast();
      }
    } catch (e) { console.error("Pyth Pro msg error:", e); }
  }

  // ─── Pyth Hermes WebSocket (free fallback — dual endpoint) ──

  private async connectPythHermes(endpoint: string, isBeta: boolean) {
    if (!this.upstreamActive) return;
    const reconnIdx = isBeta ? 5 : 3; // reconnect timer index
    try {
      const resp = await fetch(endpoint, {
        headers: { Upgrade: "websocket" },
      });
      const ws = resp.webSocket;
      if (!ws) throw new Error("No webSocket");
      ws.accept();

      if (isBeta) {
        this.pythHermesBetaWs = ws;
        this.pythHermesBetaConnected = true;
      } else {
        this.pythHermesWs = ws;
        this.pythHermesConnected = true;
      }
      this.reconnectAttempts[reconnIdx] = 0;
      this.recordSourceEvent("pyth-hermes", "connected", isBeta ? "beta" : "primary");

      ws.send(JSON.stringify({
        type: "subscribe",
        ids: Object.values(PYTH_HERMES_IDS),
        verbose: false,
        binary: false,
        allow_unordered: true,    // Skip ordering overhead — we dedup by publishTime
        parsed: true,             // Pre-parsed JSON, skip base64 decoding
      }));

      ws.addEventListener("message", (event) => {
        this.handleHermesMessage(event.data);
      });

      ws.addEventListener("close", () => {
        if (isBeta) {
          this.pythHermesBetaConnected = false;
          this.pythHermesBetaWs = null;
        } else {
          this.pythHermesConnected = false;
          this.pythHermesWs = null;
        }
        this.recordSourceEvent("pyth-hermes", "disconnected", isBeta ? "beta" : "primary");
        if (this.upstreamActive) {
          this.reconnectTimers[reconnIdx] = setTimeout(
            () => this.connectPythHermes(endpoint, isBeta),
            this.reconnectDelay(reconnIdx)
          );
        }
      });

      ws.addEventListener("error", () => { try { ws.close(); } catch {} });
    } catch (e) {
      console.error(`Hermes${isBeta ? " Beta" : ""} WS error:`, e);
      if (this.upstreamActive) {
        this.reconnectTimers[reconnIdx] = setTimeout(
          () => this.connectPythHermes(endpoint, isBeta),
          this.reconnectDelay(reconnIdx)
        );
      }
    }
  }

  // ─── Pyth Hermes REST polling (rate-limited: 30 req / 10s) ────

  // Rate limiter: sliding window of request timestamps
  private hermesRequestTimes: number[] = [];
  private static readonly HERMES_RATE_LIMIT = 30; // max requests
  private static readonly HERMES_RATE_WINDOW = 10000; // per 10 seconds
  private hermesBackoffUntil = 0; // timestamp — 0 = no backoff

  private canRequestHermes(): boolean {
    const now = Date.now();
    if (now < this.hermesBackoffUntil) return false;
    // Prune old entries outside window
    const cutoff = now - PriceAggregator.HERMES_RATE_WINDOW;
    while (this.hermesRequestTimes.length > 0 && this.hermesRequestTimes[0] < cutoff) {
      this.hermesRequestTimes.shift();
    }
    return this.hermesRequestTimes.length < PriceAggregator.HERMES_RATE_LIMIT;
  }

  private recordHermesRequest() {
    this.hermesRequestTimes.push(Date.now());
  }

  private startPythRestPoll() {
    if (this.pythRestPollTimer) return;
    this.pollPythRest();
  }

  // Cached REST URLs (built once)
  private pythRestUrl: string | null = null;
  private pythRestBetaUrl: string | null = null;

  private async pollPythRest() {
    if (!this.upstreamActive || this.usingPythPro || this.pythRestInFlight) return;

    // Rate limit check
    if (!this.canRequestHermes()) {
      // Back off — reschedule after window clears
      this.pythRestPollTimer = setTimeout(() => this.pollPythRest(), 1000);
      return;
    }

    this.pythRestInFlight = true;
    try {
      if (!this.pythRestUrl) {
        const feedIds = Object.values(PYTH_HERMES_IDS);
        const qs = feedIds.map((id) => `ids[]=${id}`).join("&");
        this.pythRestUrl = `https://hermes.pyth.network/v2/updates/price/latest?${qs}`;
        this.pythRestBetaUrl = `https://hermes-beta.pyth.network/v2/updates/price/latest?${qs}`;
      }
      this.recordHermesRequest();

      // Race both endpoints — first successful response wins (halves p99 latency)
      const opts = { headers: { Accept: "application/json" } };
      const res = await Promise.any([
        fetch(this.pythRestUrl!, opts),
        fetch(this.pythRestBetaUrl!, opts),
      ]).catch(() => null);

      // Handle 429 Too Many Requests — exponential backoff
      if (res && res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") || "10");
        this.hermesBackoffUntil = Date.now() + retryAfter * 1000;
        console.warn(`Hermes 429 — backing off ${retryAfter}s`);
        this.pythRestPollTimer = setTimeout(() => this.pollPythRest(), retryAfter * 1000);
        return;
      }

      if (res && res.ok) {
        const data = await res.json() as any;
        let updated = false;
        for (const item of (data.parsed || [])) {
          const symbol = HERMES_ID_TO_SYMBOL[item.id];
          if (!symbol) continue;
          const pd = item.price;
          const publishTime = Number(pd.publish_time);
          const st = this.state.get(symbol);
          if (st && publishTime > st.pythPublishTime) {
            const expo = Number(pd.expo);
            const mult = this.pow10(expo);
            st.pythPrice = Number(pd.price) * mult;
            st.pythConfidence = Number(pd.conf) * mult;
            st.pythExpo = expo;
            st.pythPublishTime = publishTime;
            this.dirtyAssets.add(symbol);
            updated = true;
          }
        }
        if (updated) {
          this.updatePublishDelay();
          this.scheduleBroadcast();
        }
      }
    } catch (e) { console.error("Hermes REST poll error:", e); }
    finally { this.pythRestInFlight = false; }
    // REST supplement — dual WS is primary. Poll every 2s (dual-race stays under 30/10s limit).
    this.pythRestPollTimer = setTimeout(() => this.pollPythRest(), 2000);
  }

  private handleHermesMessage(raw: string | ArrayBuffer) {
    try {
      const data = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      // Fast-path: skip non-price messages without full JSON.parse
      if (!data.includes('"price_update"')) return;
      const msg = JSON.parse(data);
      if (msg.type === "price_update" && msg.price_feed) {
        const feed = msg.price_feed;
        const symbol = HERMES_ID_TO_SYMBOL[feed.id];
        if (!symbol) return;
        const pd = feed.price;
        const publishTime = Number(pd.publish_time);
        const st = this.state.get(symbol);
        if (st && publishTime > st.pythPublishTime) {
          const expo = Number(pd.expo);
          const mult = this.pow10(expo);
          st.pythPrice = Number(pd.price) * mult;
          st.pythConfidence = Number(pd.conf) * mult;
          st.pythExpo = expo;
          st.pythPublishTime = publishTime;
          this.dirtyAssets.add(symbol);
          this.updatePublishDelay();
          this.scheduleBroadcast();
        }
      }
    } catch (e) { console.error("Hermes msg error:", e); }
  }

  // ─── Hyperliquid WebSocket ──────────────────────────────

  private async connectHlWs() {
    if (!this.upstreamActive) return;
    try {
      const resp = await fetch("https://api.hyperliquid.xyz/ws", {
        headers: { Upgrade: "websocket" },
      });
      const ws = resp.webSocket;
      if (!ws) throw new Error("No webSocket");
      ws.accept();
      this.hlWs = ws;
      this.hlConnected = true;
      this.reconnectAttempts[4] = 0;
      this.recordSourceEvent("hyperliquid", "connected");

      ws.send(JSON.stringify({
        method: "subscribe",
        subscription: { type: "allMids" },
      }));

      ws.addEventListener("message", (event) => {
        this.handleHlMessage(event.data);
      });

      ws.addEventListener("close", () => {
        this.hlConnected = false;
        this.hlWs = null;
        this.recordSourceEvent("hyperliquid", "disconnected");
        if (this.upstreamActive) {
          this.reconnectTimers[4] = setTimeout(() => this.connectHlWs(), this.reconnectDelay(4));
        }
      });

      ws.addEventListener("error", () => { try { ws.close(); } catch {} });
    } catch (e) {
      console.error("HL WS error:", e);
      if (this.upstreamActive) {
        this.reconnectTimers[4] = setTimeout(() => this.connectHlWs(), this.reconnectDelay(4));
      }
    }
  }

  private handleHlMessage(raw: string | ArrayBuffer) {
    try {
      const data = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      const msg = JSON.parse(data);
      if (msg.channel === "allMids" && msg.data?.mids) {
        const now = Date.now();
        if (this.lastHlWsTime > 0) {
          this.hlWsIntervalMs = now - this.lastHlWsTime;
        }
        this.lastHlWsTime = now;

        let updated = false;
        const mids = msg.data.mids;
        for (const symbol of SYMBOLS) {
          const mid = mids[symbol];
          if (mid !== undefined) {
            // Skip parseFloat if string unchanged from last message
            if (mid === this.lastHlMidStr.get(symbol)) continue;
            this.lastHlMidStr.set(symbol, mid);
            const price = parseFloat(mid);
            const st = this.state.get(symbol);
            if (st && st.markPrice !== price) {
              st.markPrice = price;
              this.dirtyAssets.add(symbol);
              updated = true;
            }
          }
        }
        if (updated) this.scheduleBroadcast();
      }
    } catch (e) { console.error("HL msg error:", e); }
  }

  // ─── Metadata poll ──────────────────────────────────────

  private startMetaPoll() { this.pollMeta(); }

  // ─── HIP-3 data fetching ────────────────────────────────

  private hip3PollFailures = 0;

  private startHip3Poll() {
    if (this.hip3PollTimer) return;
    this.pollHip3();
  }

  private async pollHip3() {
    try {
      // Fetch all perp DEXs
      const dexRes = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "perpDexs" }),
      });
      if (!dexRes.ok) throw new Error(`perpDexs fetch failed: ${dexRes.status}`);
      const dexList = await dexRes.json() as any[];
      if (!Array.isArray(dexList)) throw new Error("perpDexs: not an array");

      // For each HIP-3 DEX (skip nulls = validator slots), fetch metaAndAssetCtxs
      const dexes: any[] = [];
      const hip3Dexes = dexList.filter((d: any) => d !== null);

      // Fetch meta for all HIP-3 DEXs + validator DEX in parallel
      const validatorFetchPromise = fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      }).then(r => r.ok ? r.json() : null).catch(() => null);

      const metaResults = await Promise.all(
        hip3Dexes.map((dex: any) =>
          fetch("https://api.hyperliquid.xyz/info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "metaAndAssetCtxs", dex: dex.name }),
          }).then(r => r.ok ? r.json() : null).catch(() => null)
        )
      );

      for (let i = 0; i < hip3Dexes.length; i++) {
        const dex = hip3Dexes[i];
        const metaData = metaResults[i] as any;
        if (!metaData || !Array.isArray(metaData) || metaData.length < 2) continue;

        const meta = metaData[0];
        const ctxs = metaData[1];
        if (!meta?.universe || !Array.isArray(ctxs)) continue;

        let totalVolume = 0;
        let totalOI = 0;
        const assets: any[] = [];

        for (let j = 0; j < meta.universe.length; j++) {
          const asset = meta.universe[j];
          const ctx = ctxs[j];
          if (!ctx) continue;

          const markPx = parseFloat(ctx.markPx) || 0;
          const oraclePx = parseFloat(ctx.oraclePx) || 0;
          const oi = parseFloat(ctx.openInterest) || 0;
          const vol = parseFloat(ctx.dayNtlVlm) || 0;
          const funding = parseFloat(ctx.funding) || 0;
          const prevDayPx = parseFloat(ctx.prevDayPx) || 0;
          const oiNotional = oi * markPx;
          const change24h = prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;
          const oracleDeviation = oraclePx > 0 ? Math.abs((markPx - oraclePx) / oraclePx) * 100 : 0;

          totalVolume += vol;
          totalOI += oiNotional;

          assets.push({
            name: asset.name,
            coin: asset.name.split(":")[1] || asset.name,
            maxLeverage: asset.maxLeverage,
            growthMode: asset.growthMode === "enabled",
            markPx,
            oraclePx,
            oracleDeviation,
            funding,
            openInterest: oiNotional,
            volume24h: vol,
            change24h,
            midPx: parseFloat(ctx.midPx) || 0,
            premium: parseFloat(ctx.premium) || 0,
          });
        }

        // Get OI caps from perpDexs data
        const oiCaps: Record<string, number> = {};
        for (const [assetName, cap] of (dex.assetToStreamingOiCap || [])) {
          oiCaps[assetName] = parseFloat(cap);
        }

        dexes.push({
          name: dex.name,
          fullName: dex.fullName,
          deployer: dex.deployer,
          oracleUpdater: dex.oracleUpdater,
          feeRecipient: dex.feeRecipient,
          assetCount: assets.length,
          totalVolume24h: totalVolume,
          totalOpenInterest: totalOI,
          assets,
          oiCaps,
        });
      }

      // Use already-fetched validator data from parallel request
      let validatorVolume = 0;
      let validatorOI = 0;
      try {
        const vData = await validatorFetchPromise as any;
        if (vData) {
          const vCtxs = vData[1];
          if (vCtxs) {
            for (const ctx of vCtxs) {
              validatorVolume += parseFloat(ctx.dayNtlVlm) || 0;
              const markPx = parseFloat(ctx.markPx) || 0;
              const oi = parseFloat(ctx.openInterest) || 0;
              validatorOI += oi * markPx;
            }
          }
        }
      } catch {}

      const hip3TotalVolume = dexes.reduce((s, d) => s + d.totalVolume24h, 0);
      const hip3TotalOI = dexes.reduce((s, d) => s + d.totalOpenInterest, 0);

      this.hip3Data = {
        dexes,
        totalDexes: dexes.length,
        totalAssets: dexes.reduce((s, d) => s + d.assetCount, 0),
        hip3TotalVolume24h: hip3TotalVolume,
        hip3TotalOI: hip3TotalOI,
        validatorVolume24h: validatorVolume,
        validatorOI: validatorOI,
        hip3VolumeShare: validatorVolume + hip3TotalVolume > 0
          ? (hip3TotalVolume / (validatorVolume + hip3TotalVolume)) * 100
          : 0,
        timestamp: Date.now(),
      };
      this.hip3PollFailures = 0; // Reset on success
    } catch (e) {
      console.error("HIP-3 poll error:", e);
      this.hip3PollFailures++;
    }
    // Exponential backoff on failure: 30s, 60s, 120s, max 300s
    const delay = this.hip3PollFailures > 0
      ? Math.min(30000 * Math.pow(2, this.hip3PollFailures - 1), 300000)
      : 30000;
    this.hip3PollTimer = setTimeout(() => this.pollHip3(), delay);
  }

  private async pollMeta() {
    if (!this.upstreamActive) return;
    try {
      const t0 = Date.now();
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      });
      this.hlRestLatencyMs = Date.now() - t0;
      if (res.ok) {
        const hlData = await res.json() as any;
        const hlMeta = hlData[0];
        const hlCtxs = hlData[1];
        if (hlMeta?.universe && hlCtxs) {
          let updated = false;
          for (let i = 0; i < hlMeta.universe.length; i++) {
            const name = hlMeta.universe[i].name;
            const st = this.state.get(name);
            if (st) {
              const ctx = hlCtxs[i];
              const funding = parseFloat(ctx.funding);
              const oi = parseFloat(ctx.openInterest);
              const vol = parseFloat(ctx.dayNtlVlm);
              const prevDay = parseFloat(ctx.prevDayPx);
              // Only mark dirty if values actually changed
              if (st.fundingRate !== funding || st.openInterest !== oi ||
                  st.volume24h !== vol || st.prevDayPx !== prevDay) {
                st.fundingRate = funding;
                st.openInterest = oi;
                st.volume24h = vol;
                st.prevDayPx = prevDay;
                if (st.markPrice === 0) st.markPrice = parseFloat(ctx.markPx);
                this.dirtyAssets.add(name);
                updated = true;
              }
            }
          }
          if (updated) this.scheduleBroadcast();
        }
      }
    } catch (e) { console.error("Meta poll error:", e); }
    this.metaPollTimer = setTimeout(() => this.pollMeta(), 3000);
  }

  // ─── Initial REST bootstrap ─────────────────────────────

  private async fetchInitialData() {
    const feedIds = Object.values(PYTH_HERMES_IDS);
    const pythParams = feedIds.map((id) => `ids[]=${id}`).join("&");

    const [pythRes, hlRes] = await Promise.all([
      fetch(`https://hermes.pyth.network/v2/updates/price/latest?${pythParams}`, {
        headers: { Accept: "application/json" },
      }),
      fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      }),
    ]);

    if (pythRes.ok) {
      const pythData = await pythRes.json() as any;
      for (const item of (pythData.parsed || [])) {
        const symbol = HERMES_ID_TO_SYMBOL[item.id];
        if (!symbol) continue;
        const pd = item.price;
        const expo = Number(pd.expo);
        const st = this.state.get(symbol);
        if (st) {
          const mult = this.pow10(expo);
          st.pythPrice = Number(pd.price) * mult;
          st.pythConfidence = Number(pd.conf) * mult;
          st.pythExpo = expo;
          st.pythPublishTime = Number(pd.publish_time);
        }
      }
    }

    if (hlRes.ok) {
      const hlData = await hlRes.json() as any;
      const hlMeta = hlData[0];
      const hlCtxs = hlData[1];
      if (hlMeta?.universe && hlCtxs) {
        for (let i = 0; i < hlMeta.universe.length; i++) {
          const name = hlMeta.universe[i].name;
          const st = this.state.get(name);
          if (st) {
            const ctx = hlCtxs[i];
            st.markPrice = parseFloat(ctx.markPx);
            st.fundingRate = parseFloat(ctx.funding);
            st.openInterest = parseFloat(ctx.openInterest);
            st.volume24h = parseFloat(ctx.dayNtlVlm);
            st.prevDayPx = parseFloat(ctx.prevDayPx);
          }
        }
      }
    }

    // Mark all assets dirty for initial full snapshot build
    for (const sym of SYMBOLS) this.dirtyAssets.add(sym);
    this.cachedJson = this.buildSnapshot();
  }

  // ─── Publish delay (recomputed on Pyth updates, not every broadcast) ─

  private updatePublishDelay() {
    const nowSec = Date.now() / 1000;
    let sum = 0, count = 0;
    for (const symbol of SYMBOLS) {
      const st = this.state.get(symbol)!;
      if (st.pythPublishTime > 0) {
        const pubSec = this.usingPythPro ? st.pythPublishTime / 1e6 : st.pythPublishTime;
        const delay = (nowSec - pubSec) * 1000;
        if (delay > 0 && delay < 60000) { sum += delay; count++; }
      }
    }
    if (count > 0) this.pythPublishDelayMs = sum / count;
  }

  // ─── Broadcast throttle (16ms = 60fps — full speed to clients) ─
  private static readonly BROADCAST_INTERVAL = 16;

  private scheduleBroadcast() {
    if (this.broadcastPending) return;
    this.broadcastPending = true;

    const elapsed = performance.now() - this.lastBroadcastTime;
    if (elapsed >= PriceAggregator.BROADCAST_INTERVAL) {
      this.broadcastPending = false;
      this.lastBroadcastTime = performance.now();
      this.broadcast();
    } else {
      // Use queueMicrotask for near-zero scheduling overhead
      // (setTimeout has ~4ms minimum resolution on Workers)
      const remaining = PriceAggregator.BROADCAST_INTERVAL - elapsed;
      if (remaining <= 2) {
        // Close enough — fire on next microtask (~0.01ms vs ~4ms setTimeout)
        queueMicrotask(() => {
          this.broadcastPending = false;
          this.lastBroadcastTime = performance.now();
          this.broadcast();
        });
      } else {
        this.broadcastTimer = setTimeout(() => {
          this.broadcastPending = false;
          this.lastBroadcastTime = performance.now();
          this.broadcast();
        }, remaining);
      }
    }
  }

  private broadcastCount = 0;

  private broadcast() {
    const delta = this.buildDelta();
    this.cachedJson = null; // Invalidate — rebuilt lazily on next REST request
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(delta); } catch {}
    }
    this.broadcastCount++;
  }

  // ─── Compact delta payload for WS (short keys, dirty assets only) ─
  // Format: {"a":[{"s":"BTC","p":67000,"c":12,"m":67010,...}],"t":1234,"st":1234}
  // ~200-400 bytes per frame = ~85% smaller than full snapshot

  // Pre-allocated delta objects per symbol to avoid GC churn
  private deltaObjs: Map<string, any> = new Map(
    SYMBOLS.map((s) => [s, { s, p: 0, c: 0, e: 0, m: 0, d: 0, ch: 0, f: 0, oi: 0, v: 0, pt: 0, bb: 0, ba: 0, pc: 0 }])
  );

  // Pre-allocated payload object — mutated in place, serialized each frame
  private deltaPayload: any = { a: [] as any[], t: 0, st: 0 };

  private buildDelta(): string {
    const now = Date.now();
    const payload = this.deltaPayload;
    payload.a.length = 0; // Clear without reallocating
    payload.t = now;
    payload.st = now;

    for (const symbol of this.dirtyAssets) {
      const st = this.state.get(symbol);
      if (!st || (st.pythPrice === 0 && st.markPrice === 0)) continue;

      const markPrice = st.markPrice || st.pythPrice;
      const obj = this.deltaObjs.get(symbol)!;
      obj.p = st.pythPrice;
      obj.c = st.pythConfidence;
      obj.e = st.pythExpo;
      obj.m = markPrice;
      obj.d = markPrice > 0 ? Math.abs((st.pythPrice - markPrice) / markPrice) * 100 : 0;
      obj.ch = st.prevDayPx > 0 ? ((markPrice - st.prevDayPx) / st.prevDayPx) * 100 : 0;
      obj.f = st.fundingRate;
      obj.oi = st.openInterest * markPrice;
      obj.v = st.volume24h;
      obj.pt = st.pythPublishTime;
      obj.bb = st.bestBidPrice;
      obj.ba = st.bestAskPrice;
      obj.pc = st.publisherCount;
      payload.a.push(obj);
    }

    this.dirtyAssets.clear();

    // Include sources every ~5s so client stays informed
    if (this.broadcastCount % 300 === 0) {
      const pythProUp = this.pythProConnected.some(Boolean);
      payload.src = {
        pythPro: this.usingPythPro && pythProUp,
        pythHermes: this.pythHermesConnected,
        pythHermesBeta: this.pythHermesBetaConnected,
        hlWs: this.hlConnected,
        mode: this.usingPythPro ? "pro" : "hermes",
        pythProLatencyMs: this.usingPythPro ? this.pythProLatencyMs : null,
        hlRestLatencyMs: this.hlRestLatencyMs || null,
        hlWsIntervalMs: this.hlWsIntervalMs || null,
        pythPublishDelayMs: this.pythPublishDelayMs || null,
      };
    } else {
      delete payload.src;
    }

    return JSON.stringify(payload);
  }

  // ─── Build JSON snapshot (incremental per-asset caching) ─

  private buildSnapshot(): string {
    // Only recompute asset objects that changed since last broadcast
    const dirty = this.dirtyAssets;
    let totalVolume = 0, totalOI = 0, fundingSum = 0, discrepancies = 0;
    const now = Date.now();

    // Reuse the array — clear length without reallocating
    this.reusableAssets.length = 0;

    for (const symbol of SYMBOLS) {
      const st = this.state.get(symbol)!;
      if (st.pythPrice === 0 && st.markPrice === 0) continue;

      let asset: any;
      if (dirty.has(symbol) || !this.assetSnapshotCache.has(symbol)) {
        // Recompute this asset's snapshot
        const markPrice = st.markPrice || st.pythPrice;
        const discrepancy = markPrice > 0
          ? Math.abs((st.pythPrice - markPrice) / markPrice) * 100
          : 0;
        const change24h = st.prevDayPx > 0
          ? ((markPrice - st.prevDayPx) / st.prevDayPx) * 100
          : 0;
        const oiNotional = st.openInterest * markPrice;

        asset = {
          symbol,
          pythPrice: st.pythPrice,
          pythConfidence: st.pythConfidence,
          pythExpo: st.pythExpo,
          markPrice,
          oracleDiscrepancy: discrepancy,
          change24h,
          fundingRate: st.fundingRate,
          openInterest: oiNotional,
          volume24h: st.volume24h,
          publishTime: st.pythPublishTime,
          bestBidPrice: st.bestBidPrice,
          bestAskPrice: st.bestAskPrice,
          publisherCount: st.publisherCount,
        };
        this.assetSnapshotCache.set(symbol, asset);
      } else {
        asset = this.assetSnapshotCache.get(symbol)!;
      }

      if ((asset as any).oracleDiscrepancy > 0.5) discrepancies++;
      totalVolume += (asset as any).volume24h;
      totalOI += (asset as any).openInterest;
      fundingSum += (asset as any).fundingRate;

      this.reusableAssets.push(asset);
    }

    // Clear dirty set for next cycle
    dirty.clear();

    const pythProUp = this.pythProConnected.some(Boolean);

    return JSON.stringify({
      assets: this.reusableAssets,
      totalVolume24h: totalVolume,
      totalOpenInterest: totalOI,
      avgFundingRate: this.reusableAssets.length > 0 ? fundingSum / this.reusableAssets.length : 0,
      discrepancyCount: discrepancies,
      timestamp: now,
      serverTs: now, // Client uses this to calculate edge→browser delivery latency
      sources: {
        pythPro: this.usingPythPro && pythProUp,
        pythHermes: this.pythHermesConnected,
        pythHermesBeta: this.pythHermesBetaConnected,
        hlWs: this.hlConnected,
        mode: this.usingPythPro ? "pro" : "hermes",
        pythProLatencyMs: this.usingPythPro ? this.pythProLatencyMs : null,
        hlRestLatencyMs: this.hlRestLatencyMs || null,
        hlWsIntervalMs: this.hlWsIntervalMs || null,
        pythPublishDelayMs: this.pythPublishDelayMs || null,
      },
    });
  }
}

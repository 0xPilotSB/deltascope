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

  // ─── Perf: exponent cache ──────────────────────────────
  private expoCache: Map<number, number> = new Map();

  // ─── Perf: microtask broadcast with 16ms floor ────────
  private lastBroadcastTime = 0;

  // ─── Perf: dirty flag per-asset for incremental snapshot
  private dirtyAssets: Set<string> = new Set();
  // Pre-computed per-asset JSON objects, keyed by symbol
  private assetSnapshotCache: Map<string, object> = new Map();
  // Reusable assets array to reduce allocations
  private reusableAssets: object[] = [];

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
    // 24/7 keep-alive: set alarm on construction so DO never sleeps
    ctx.storage.setAlarm(Date.now() + 25000);
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
      if (!this.cachedJson) await this.fetchInitialData();
      return new Response(this.cachedJson || this.buildSnapshot(), {
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

    if (url.pathname === "/hip3") {
      if (!this.hip3Data) await this.pollHip3();
      return new Response(JSON.stringify(this.hip3Data || { dexes: [], timestamp: Date.now() }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=5, stale-while-revalidate=10",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const msg = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (msg === "ping") { ws.send("pong"); return; }
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
      // Also keep Hermes WS as fallback in case Lazer goes down
      this.connectPythHermes("https://hermes.pyth.network/ws", false);
    } else {
      // Dual Hermes: connect to both main and beta for lowest latency
      this.connectPythHermes("https://hermes.pyth.network/ws", false);
      this.connectPythHermes("https://hermes-beta.pyth.network/ws", true);
      // REST polling supplement: poll every 1s for freshest data
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
        this.scheduleBroadcast();
      }
    } catch {}
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

  // ─── Pyth Hermes REST polling supplement (every 2s) ────────

  private startPythRestPoll() {
    if (this.pythRestPollTimer) return;
    this.pollPythRest();
  }

  private async pollPythRest() {
    if (!this.upstreamActive || this.usingPythPro) return;
    try {
      const feedIds = Object.values(PYTH_HERMES_IDS);
      const params = feedIds.map((id) => `ids[]=${id}`).join("&");
      const res = await fetch(
        `https://hermes.pyth.network/v2/updates/price/latest?${params}`,
        { headers: { Accept: "application/json" } }
      );
      if (res.ok) {
        const data = await res.json() as any;
        let updated = false;
        for (const item of (data.parsed || [])) {
          const symbol = HERMES_ID_TO_SYMBOL[item.id];
          if (!symbol) continue;
          const pd = item.price;
          const publishTime = Number(pd.publish_time);
          const st = this.state.get(symbol);
          if (st && publishTime > st.pythPublishTime) {
            // Only update if REST data is fresher than WS data
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
        if (updated) this.scheduleBroadcast();
      }
    } catch {}
    this.pythRestPollTimer = setTimeout(() => this.pollPythRest(), 1000);
  }

  private handleHermesMessage(raw: string | ArrayBuffer) {
    try {
      const data = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      const msg = JSON.parse(data);
      if (msg.type === "price_update" && msg.price_feed) {
        const feed = msg.price_feed;
        const symbol = HERMES_ID_TO_SYMBOL[feed.id];
        if (!symbol) return;
        const pd = feed.price;
        const publishTime = Number(pd.publish_time);
        const st = this.state.get(symbol);
        if (st && publishTime > st.pythPublishTime) {
          // Only accept if fresher than current data (dedup dual WS + REST)
          const expo = Number(pd.expo);
          const mult = this.pow10(expo);
          st.pythPrice = Number(pd.price) * mult;
          st.pythConfidence = Number(pd.conf) * mult;
          st.pythExpo = expo;
          st.pythPublishTime = publishTime;
          this.dirtyAssets.add(symbol);
          this.scheduleBroadcast();
        }
      }
    } catch {}
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
        // Track HL WS update interval
        const now = Date.now();
        if (this.lastHlWsTime > 0) {
          this.hlWsIntervalMs = now - this.lastHlWsTime;
        }
        this.lastHlWsTime = now;

        let updated = false;
        for (const symbol of SYMBOLS) {
          const mid = msg.data.mids[symbol];
          if (mid !== undefined) {
            const st = this.state.get(symbol);
            if (st) { st.markPrice = parseFloat(mid); this.dirtyAssets.add(symbol); updated = true; }
          }
        }
        if (updated) this.scheduleBroadcast();
      }
    } catch {}
  }

  // ─── Metadata poll ──────────────────────────────────────

  private startMetaPoll() { this.pollMeta(); }

  // ─── HIP-3 data fetching ────────────────────────────────

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
      if (!dexRes.ok) throw new Error("perpDexs fetch failed");
      const dexList = await dexRes.json() as any[];

      // For each HIP-3 DEX (skip index 0 = validator), fetch metaAndAssetCtxs
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
        if (!metaData) continue;

        const meta = metaData[0];
        const ctxs = metaData[1];
        if (!meta?.universe || !ctxs) continue;

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
    } catch (e) {
      console.error("HIP-3 poll error:", e);
    }
    this.hip3PollTimer = setTimeout(() => this.pollHip3(), 30000); // Poll every 30s
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
          for (let i = 0; i < hlMeta.universe.length; i++) {
            const name = hlMeta.universe[i].name;
            const st = this.state.get(name);
            if (st) {
              const ctx = hlCtxs[i];
              st.fundingRate = parseFloat(ctx.funding);
              st.openInterest = parseFloat(ctx.openInterest);
              st.volume24h = parseFloat(ctx.dayNtlVlm);
              st.prevDayPx = parseFloat(ctx.prevDayPx);
              if (st.markPrice === 0) st.markPrice = parseFloat(ctx.markPx);
              this.dirtyAssets.add(name);
            }
          }
          this.scheduleBroadcast();
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

  // ─── Broadcast throttle (16ms via microtask + timestamp floor) ─

  private scheduleBroadcast() {
    if (this.broadcastPending) return;
    this.broadcastPending = true;

    const elapsed = performance.now() - this.lastBroadcastTime;
    if (elapsed >= 16) {
      // Broadcast immediately via microtask (faster than setTimeout)
      queueMicrotask(() => {
        this.broadcastPending = false;
        this.lastBroadcastTime = performance.now();
        this.broadcast();
      });
    } else {
      // Wait for remaining time
      this.broadcastTimer = setTimeout(() => {
        this.broadcastPending = false;
        this.lastBroadcastTime = performance.now();
        this.broadcast();
      }, 16 - elapsed);
    }
  }

  private broadcast() {
    const json = this.buildSnapshot();
    this.cachedJson = json;
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(json); } catch {}
    }
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

    // Compute median Pyth publish delay across assets
    const delays: number[] = [];
    const nowSec = now / 1000;
    for (const symbol of SYMBOLS) {
      const st = this.state.get(symbol)!;
      if (st.pythPublishTime > 0) {
        // Pro uses microseconds in feedUpdateTimestamp, Hermes uses seconds
        const pubSec = this.usingPythPro ? st.pythPublishTime / 1e6 : st.pythPublishTime;
        const delay = (nowSec - pubSec) * 1000; // ms
        if (delay > 0 && delay < 60000) delays.push(delay);
      }
    }
    if (delays.length > 0) {
      delays.sort((a, b) => a - b);
      this.pythPublishDelayMs = delays[Math.floor(delays.length / 2)];
    }

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

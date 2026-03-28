import { create } from "zustand";

// ─── Types ─────────────────────────────────────────────────

export interface AssetData {
  symbol: string;
  pythPrice: number;
  pythConfidence: number;
  pythExpo: number;
  markPrice: number;
  oracleDiscrepancy: number;
  change24h: number;
  fundingRate: number;
  openInterest: number;
  volume24h: number;
  publishTime: number;
  bestBidPrice?: number;
  bestAskPrice?: number;
  publisherCount?: number;
}

export interface DashboardData {
  assets: AssetData[];
  totalVolume24h: number;
  totalOpenInterest: number;
  avgFundingRate: number;
  discrepancyCount: number;
  timestamp: number;
  serverTs?: number; // Server send timestamp for WS delivery RTT
  sources?: {
    pythPro?: boolean;
    pythHermes?: boolean;
    pythHermesBeta?: boolean;
    pythWs?: boolean;
    hlWs: boolean;
    mode?: "pro" | "hermes";
    pythProLatencyMs?: number | null;
    hlRestLatencyMs?: number | null;
    hlWsIntervalMs?: number | null;
    pythPublishDelayMs?: number | null;
  };
}

export interface PricePoint {
  time: number; // unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TickData {
  time: number; // unix timestamp in ms
  price: number;
}

interface PriceStore {
  // ── State ──
  data: DashboardData | null;
  isConnected: boolean;
  latencyMs: number | null;
  // Raw ticks per asset (for aggregation into any timeframe)
  rawTicks: Map<string, TickData[]>;
  // Monotonic counter — bumped on every tick append so subscribers
  // know the Map contents changed (since we mutate in place).
  tickVersion: number;

  // ── Actions ──
  connect: () => void;
  disconnect: () => void;
  setInitialData: (data: DashboardData) => void;
}

// ─── Constants ─────────────────────────────────────────────

// Server sends at ~60fps, 60 * 60 * 10 = 36000 ticks per asset for 10 min
const MAX_TICKS = 36000;

// ─── Internal refs (module-scoped, SSR-safe) ───────────────

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let alive = false;
let reconnectAttempt = 0;
let tabVisible = true;

// ─── Helpers ───────────────────────────────────────────────

function appendTicks(
  ticks: Map<string, TickData[]>,
  assets: AssetData[],
  timestamp: number,
): Map<string, TickData[]> {
  for (const asset of assets) {
    const price = asset.pythPrice;
    if (!price || price <= 0) continue;

    let arr = ticks.get(asset.symbol);
    if (!arr) {
      arr = [];
      ticks.set(asset.symbol, arr);
    }

    arr.push({ time: timestamp, price });

    if (arr.length > MAX_TICKS) {
      const drop = Math.floor(MAX_TICKS * 0.1);
      arr.splice(0, drop);
    }
  }

  return ticks;
}

/** Aggregate raw ticks into OHLC candles for a given interval */
export function aggregateCandles(
  ticks: TickData[],
  intervalS: number,
): PricePoint[] {
  if (ticks.length === 0) return [];

  const candles: PricePoint[] = [];
  let currentStart = -1;
  let o = 0, h = 0, l = 0, c = 0;

  for (const tick of ticks) {
    const s = Math.floor(tick.time / 1000);
    const candleStart = s - (s % intervalS);

    if (candleStart !== currentStart) {
      if (currentStart >= 0) {
        candles.push({ time: currentStart, open: o, high: h, low: l, close: c });
      }
      currentStart = candleStart;
      o = tick.price;
      h = tick.price;
      l = tick.price;
      c = tick.price;
    } else {
      h = Math.max(h, tick.price);
      l = Math.min(l, tick.price);
      c = tick.price;
    }
  }

  if (currentStart >= 0) {
    candles.push({ time: currentStart, open: o, high: h, low: l, close: c });
  }

  return candles;
}

/** Convert raw ticks to line data points for a given interval */
export function aggregateLine(
  ticks: TickData[],
  intervalS: number,
): { time: number; value: number }[] {
  if (ticks.length === 0) return [];

  const points: { time: number; value: number }[] = [];
  let currentStart = -1;
  let lastPrice = 0;

  for (const tick of ticks) {
    const s = Math.floor(tick.time / 1000);
    const candleStart = s - (s % intervalS);

    if (candleStart !== currentStart) {
      if (currentStart >= 0) {
        points.push({ time: currentStart, value: lastPrice });
      }
      currentStart = candleStart;
    }
    lastPrice = tick.price;
  }

  if (currentStart >= 0) {
    points.push({ time: currentStart, value: lastPrice });
  }

  return points;
}

// ─── Store ─────────────────────────────────────────────────

export const usePriceStore = create<PriceStore>()((set, get) => ({
  // ── State ──
  data: null,
  isConnected: false,
  latencyMs: null,
  rawTicks: new Map(),
  tickVersion: 0,

  // ── Actions ──

  setInitialData: (data: DashboardData) => {
    const ticks = appendTicks(get().rawTicks, data.assets, data.timestamp);
    set({ data, rawTicks: ticks, tickVersion: get().tickVersion + 1 });
  },

  connect: () => {
    if (typeof window === "undefined") return;
    if (ws) return;

    alive = true;

    // ── Visibility API: pause/resume WS when tab hidden/visible ──
    const handleVisibility = () => {
      tabVisible = !document.hidden;
      // When tab becomes visible again, request fresh data
      if (tabVisible && ws?.readyState === WebSocket.OPEN) {
        ws.send("refresh");
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    function doConnect() {
      if (!alive) return;

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(
        `${proto}//${window.location.host}/ws/prices`,
      );
      ws = socket;

      socket.onopen = () => {
        reconnectAttempt = 0;
        set({ isConnected: true });
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send("ping");
          }
        }, 30000);
      };

      socket.onmessage = (event) => {
        if (event.data === "pong") return;

        // When tab is hidden, only update data (for latency tracking)
        // but skip tick accumulation to save memory
        try {
          const newData = JSON.parse(event.data) as DashboardData;
          const lat = newData.serverTs
            ? Date.now() - newData.serverTs
            : Date.now() - (newData.timestamp || Date.now());

          if (tabVisible) {
            const ticks = appendTicks(
              get().rawTicks,
              newData.assets,
              newData.timestamp,
            );
            set({
              data: newData,
              latencyMs: Math.max(0, lat),
              rawTicks: ticks,
              tickVersion: get().tickVersion + 1,
            });
          } else {
            // Hidden tab: update prices only, skip ticks (saves memory + CPU)
            set({
              data: newData,
              latencyMs: Math.max(0, lat),
            });
          }
        } catch {
          // Ignore malformed messages
        }
      };

      socket.onclose = () => {
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        set({ isConnected: false });
        ws = null;
        if (alive) {
          const baseDelay = Math.min(500 * Math.pow(2, reconnectAttempt), 10000);
          const jitter = Math.random() * 500;
          reconnectAttempt++;
          reconnectTimer = setTimeout(doConnect, baseDelay + jitter);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    doConnect();

    // Store cleanup ref for disconnect
    (usePriceStore as any).__visibilityHandler = handleVisibility;
  },

  disconnect: () => {
    alive = false;

    // Remove visibility listener
    const handler = (usePriceStore as any).__visibilityHandler;
    if (handler) {
      document.removeEventListener("visibilitychange", handler);
      (usePriceStore as any).__visibilityHandler = null;
    }

    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (ws) {
      ws.close();
      ws = null;
    }

    set({ isConnected: false, latencyMs: null });
  },
}));

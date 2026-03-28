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

  // ── Actions ──
  connect: () => void;
  disconnect: () => void;
  setInitialData: (data: DashboardData) => void;
}

// ─── Constants ─────────────────────────────────────────────

const MAX_TICKS = 36000; // ~10 min at ~60 ticks/s

// ─── Internal refs (module-scoped, SSR-safe) ───────────────

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let alive = false;
let reconnectAttempt = 0;

// ─── Helpers ───────────────────────────────────────────────

function appendTicks(
  ticks: Map<string, TickData[]>,
  assets: AssetData[],
  timestamp: number,
): Map<string, TickData[]> {
  const next = new Map(ticks);

  for (const asset of assets) {
    const price = asset.pythPrice;
    if (!price || price <= 0) continue;

    const existing = next.get(asset.symbol);
    const arr = existing ? [...existing] : [];

    arr.push({ time: timestamp, price });

    // Trim oldest ticks
    if (arr.length > MAX_TICKS) {
      arr.splice(0, arr.length - MAX_TICKS);
    }

    next.set(asset.symbol, arr);
  }

  return next;
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

  // Push final candle
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

  // Push final point
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

  // ── Actions ──

  setInitialData: (data: DashboardData) => {
    const ticks = appendTicks(get().rawTicks, data.assets, data.timestamp);
    set({ data, rawTicks: ticks });
  },

  connect: () => {
    // Guard: only run client-side
    if (typeof window === "undefined") return;

    // Prevent duplicate connections
    if (ws) return;

    alive = true;

    function doConnect() {
      if (!alive) return;

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(
        `${proto}//${window.location.host}/ws/prices`,
      );
      ws = socket;

      socket.onopen = () => {
        reconnectAttempt = 0; // Reset backoff on successful connection
        set({ isConnected: true });
      };

      socket.onmessage = (event) => {
        try {
          const newData = JSON.parse(event.data) as DashboardData;
          // Use serverTs for accurate edge→browser delivery latency
          const lat = newData.serverTs
            ? Date.now() - newData.serverTs
            : Date.now() - (newData.timestamp || Date.now());

          const ticks = appendTicks(
            get().rawTicks,
            newData.assets,
            newData.timestamp,
          );

          set({
            data: newData,
            latencyMs: Math.max(0, lat),
            rawTicks: ticks,
          });
        } catch {
          // Ignore malformed messages
        }
      };

      socket.onclose = () => {
        set({ isConnected: false });
        ws = null;
        if (alive) {
          // Exponential backoff: 500ms, 1s, 2s, 4s, max 10s + jitter
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
  },

  disconnect: () => {
    alive = false;

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

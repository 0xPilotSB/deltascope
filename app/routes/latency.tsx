/**
 * Latency Monitor — HyperLatency-inspired infrastructure intelligence.
 * Real-time latency metrics for Pyth Oracle, Hyperliquid API, and WebSocket delivery.
 */
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/latency";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { LatencyChart, type LatencySample } from "~/components/latency-chart";
import { HistoricalLatencyChart, type HistoricalMinute, type SourceEvent } from "~/components/historical-latency-chart";
import { usePriceStore } from "~/stores/price-store";
import { MobileMenu } from "~/components/mobile-nav";
import { OracleChatPopup } from "~/components/oracle-chat";

// ─── Nav ──────────────────────────────────────────────────

const NAV_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Ticker Analysis", href: "/analysis" },
  { label: "Predict & Win", href: "/predict" },
  { label: "Latency Monitor", href: "/latency" },
  { label: "Developers", href: "/developers" },
  { label: "Community", href: "https://discord.gg/pyth", external: true },
];

// ─── Meta ─────────────────────────────────────────────────

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Latency Monitor — DeltaScope" },
    { name: "description", content: "Real-time infrastructure latency monitoring for Pyth Oracle and Hyperliquid" },
  ];
}

// ─── Loader ───────────────────────────────────────────────

export async function loader({ context }: Route.LoaderArgs) {
  try {
    const id = context.cloudflare.env.PRICE_AGGREGATOR.idFromName("global");
    const stub = context.cloudflare.env.PRICE_AGGREGATOR.get(id);
    const res = await stub.fetch(new Request("https://internal/latency"));
    if (res.ok) {
      const data = await res.json();
      return { initialData: data as LatencyData };
    }
  } catch {}
  return { initialData: null };
}

// ─── Types ────────────────────────────────────────────────

interface LatencyData {
  history: LatencySample[];
  current: {
    pythSourceMs: number | null;
    pythPublishDelayMs: number | null;
    hlRestLatencyMs: number | null;
    hlWsIntervalMs: number | null;
    sources: {
      pythPro: boolean;
      pythHermes: boolean;
      hlWs: boolean;
      mode: "pro" | "hermes";
    };
  };
}

// ─── Helpers ──────────────────────────────────────────────

function statusColor(ms: number | null, thresholds: [number, number]): string {
  if (ms === null || ms === 0) return "text-muted-foreground";
  if (ms < thresholds[0]) return "text-emerald-400";
  if (ms < thresholds[1]) return "text-yellow-400";
  return "text-red-400";
}

function statusBadge(ms: number | null, thresholds: [number, number]): { label: string; variant: string } {
  if (ms === null || ms === 0) return { label: "N/A", variant: "text-muted-foreground border-white/10" };
  if (ms < thresholds[0]) return { label: "Excellent", variant: "text-emerald-400 border-emerald-400/30" };
  if (ms < thresholds[1]) return { label: "Good", variant: "text-yellow-400 border-yellow-400/30" };
  return { label: "Slow", variant: "text-red-400 border-red-400/30" };
}

function computeStats(history: LatencySample[], key: keyof LatencySample): { p50: number; p95: number; min: number; max: number } {
  const values = history.map((s) => s[key] as number).filter((v) => v > 0).sort((a, b) => a - b);
  if (values.length === 0) return { p50: 0, p95: 0, min: 0, max: 0 };
  return {
    p50: values[Math.floor(values.length * 0.5)],
    p95: values[Math.floor(values.length * 0.95)],
    min: values[0],
    max: values[values.length - 1],
  };
}

function fmtMs(ms: number | null): string {
  if (ms === null || ms === 0) return "—";
  if (ms < 1) return "<1ms";
  return `${Math.round(ms)}ms`;
}

// ─── Probe Types ──────────────────────────────────────────

interface ProbeResult {
  name: string;
  location: string;
  status: "online" | "offline" | "pending";
  apiP50: number | null;
  apiP95: number | null;
  failRate: number;
  lastSeen: number | null;
  samples: number[];
}

const PROBE_ENDPOINTS = [
  { name: "Hyperliquid API", location: "Your Browser → api.hyperliquid.xyz", url: "https://api.hyperliquid.xyz/info", method: "POST", body: JSON.stringify({ type: "meta" }) },
  { name: "Pyth Hermes", location: "Your Browser → hermes.pyth.network", url: "https://hermes.pyth.network/v2/updates/price/latest?ids[]=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", method: "GET", body: undefined },
  { name: "Pyth Hermes (Beta)", location: "Your Browser → hermes-beta.pyth.network", url: "https://hermes-beta.pyth.network/v2/updates/price/latest?ids[]=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", method: "GET", body: undefined },
  { name: "DeltaScope API", location: "Your Browser → Edge DO", url: "/api/prices", method: "GET", body: undefined },
  { name: "DeltaScope Latency", location: "Your Browser → Edge DO", url: "/api/latency", method: "GET", body: undefined },
  { name: "HL Spot Meta", location: "Your Browser → api.hyperliquid.xyz", url: "https://api.hyperliquid.xyz/info", method: "POST", body: JSON.stringify({ type: "spotMeta" }) },
];

function computePercentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)] ?? 0;
}

function timeAgo(ts: number | null): string {
  if (!ts) return "—";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ─── Component ────────────────────────────────────────────

export default function LatencyMonitor({ loaderData }: Route.ComponentProps) {
  const { initialData } = loaderData;
  const [latencyData, setLatencyData] = useState<LatencyData | null>(initialData);
  // Granular selectors — prevent full re-render on every 60fps tick
  const priceData = usePriceStore((s) => s.data);
  const isConnected = usePriceStore((s) => s.isConnected);
  const latencyMs = usePriceStore((s) => s.latencyMs);
  const connect = usePriceStore((s) => s.connect);
  const disconnect = usePriceStore((s) => s.disconnect);

  // Connect to WebSocket for real-time data
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Poll /api/latency for history every 5s
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/latency");
        if (res.ok && active) {
          const data = await res.json();
          setLatencyData(data as LatencyData);
        }
      } catch {}
      if (active) setTimeout(poll, 30000);
    };
    // Start polling after initial data
    const timer = setTimeout(poll, 30000);
    return () => { active = false; clearTimeout(timer); };
  }, []);

  const history = latencyData?.history ?? [];
  const current = latencyData?.current;
  const sources = priceData?.sources ?? current?.sources;

  // Use real-time values from WebSocket when available
  const pythDelay = priceData?.sources?.pythPublishDelayMs ?? current?.pythPublishDelayMs ?? null;
  const hlRest = priceData?.sources?.hlRestLatencyMs ?? current?.hlRestLatencyMs ?? null;
  const hlWs = priceData?.sources?.hlWsIntervalMs ?? current?.hlWsIntervalMs ?? null;
  const wsDelivery = latencyMs;

  // Client-side WS delivery history (ring buffer, max 60 samples)
  const wsDeliveryHistoryRef = useRef<number[]>([]);
  useEffect(() => {
    if (wsDelivery !== null && wsDelivery > 0 && wsDelivery < 10000) {
      const buf = wsDeliveryHistoryRef.current;
      buf.push(wsDelivery);
      if (buf.length > 60) buf.splice(0, buf.length - 60);
    }
  }, [wsDelivery]);

  // Compute stats from history
  const pythStats = useMemo(() => computeStats(history, "pyth"), [history]);
  const hlRestStats = useMemo(() => computeStats(history, "hlRest"), [history]);
  const hlWsStats = useMemo(() => computeStats(history, "hlWs"), [history]);
  const wsDeliveryStats = useMemo(() => {
    const buf = wsDeliveryHistoryRef.current;
    if (buf.length === 0) return { p50: null, p95: null, min: null, max: null };
    const sorted = [...buf].sort((a, b) => a - b);
    return {
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
  }, [wsDelivery]); // recompute when new sample arrives

  // Overall health
  const healthScore = useMemo(() => {
    let score = 0;
    let count = 0;
    if (pythDelay !== null && pythDelay > 0) { score += pythDelay < 100 ? 100 : pythDelay < 500 ? 70 : 30; count++; }
    if (hlRest !== null && hlRest > 0) { score += hlRest < 200 ? 100 : hlRest < 500 ? 70 : 30; count++; }
    if (wsDelivery !== null && wsDelivery > 0) { score += wsDelivery < 50 ? 100 : wsDelivery < 200 ? 70 : 30; count++; }
    return count > 0 ? Math.round(score / count) : 0;
  }, [pythDelay, hlRest, wsDelivery]);

  const healthLabel = healthScore >= 80 ? "Healthy" : healthScore >= 50 ? "Degraded" : healthScore > 0 ? "Poor" : "N/A";
  const healthColor = healthScore >= 80 ? "text-emerald-400" : healthScore >= 50 ? "text-yellow-400" : healthScore > 0 ? "text-red-400" : "text-muted-foreground";

  // ─── Probe Status ─────────────────────────────────────────
  const [probes, setProbes] = useState<ProbeResult[]>(() =>
    PROBE_ENDPOINTS.map((ep) => ({
      name: ep.name,
      location: ep.location,
      status: "pending" as const,
      apiP50: null,
      apiP95: null,
      failRate: 0,
      lastSeen: null,
      samples: [],
    }))
  );
  const probesRef = useRef(probes);
  probesRef.current = probes;

  // Run probes every 5s
  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;

    const runProbes = async () => {
      const results = await Promise.all(
        PROBE_ENDPOINTS.map(async (ep, i) => {
          const prev = probesRef.current[i];
          try {
            const t0 = performance.now();
            const res = await fetch(ep.url, {
              method: ep.method,
              headers: ep.body ? { "Content-Type": "application/json" } : undefined,
              body: ep.body,
              cache: "no-store",
            });
            const latency = Math.round(performance.now() - t0);

            const samples = [...prev.samples, latency].slice(-20); // keep last 20
            const fails = res.ok ? prev.failRate * 0.9 : prev.failRate * 0.9 + 10; // EWMA

            return {
              name: ep.name,
              location: ep.location,
              status: "online" as const,
              apiP50: computePercentile(samples, 0.5),
              apiP95: computePercentile(samples, 0.95),
              failRate: Math.round(fails * 10) / 10,
              lastSeen: Date.now(),
              samples,
            };
          } catch {
            return {
              ...prev,
              status: "offline" as const,
              failRate: Math.min(100, (prev.failRate * 0.9) + 10),
            };
          }
        })
      );
      if (active) setProbes(results);
    };

    runProbes();
    const interval = setInterval(runProbes, 30000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const onlineCount = probes.filter((p) => p.status === "online").length;

  // ─── Historical 7-day latency data ──────────────────────
  const RANGES = ["1h", "6h", "24h", "3d", "7d"] as const;
  type Range = typeof RANGES[number];
  const [histRange, setHistRange] = useState<Range>("24h");
  const [histMinutes, setHistMinutes] = useState<HistoricalMinute[]>([]);
  const [histEvents, setHistEvents] = useState<SourceEvent[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setHistLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/latency/history?range=${histRange}`);
        if (res.ok && active) {
          const data = await res.json() as { minutes: HistoricalMinute[]; events: SourceEvent[] };
          setHistMinutes(data.minutes);
          setHistEvents(data.events);
        }
      } catch {}
      if (active) setHistLoading(false);
    })();
    return () => { active = false; };
  }, [histRange]);

  return (
    <main className="min-h-screen bg-[#0a0e14] text-white">
      {/* NavHeader */}
      <header className="sticky top-0 z-50 bg-[#0a0e14]/95 backdrop-blur-sm border-b border-white/5 relative will-change-transform">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2 text-white font-bold text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                <path d="M6 26L16 6l10 20H6z" fill="#10b981" />
                <path d="M16 6l5 10h-10L16 6z" fill="#059669" />
              </svg>
              Delta<span className="text-emerald-400">Scope</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map((link) =>
                link.href.startsWith("/") ? (
                  <Link
                    key={link.label}
                    to={link.href}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                      link.href === "/latency"
                        ? "text-white bg-white/10"
                        : "text-muted-foreground hover:text-white hover:bg-white/5"
                    }`}
                  >
                    {link.label}
                  </Link>
                ) : (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm text-muted-foreground hover:text-white hover:bg-white/5 rounded-md transition-colors flex items-center gap-1"
                  >
                    {link.label}
                    {link.external && <span className="text-[10px]">↗</span>}
                  </a>
                )
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {isConnected ? (
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Streaming
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-yellow-400">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                Connecting...
              </div>
            )}
            {wsDelivery !== null && isConnected && (
              <Badge
                variant="outline"
                className={`font-mono text-xs ${
                  wsDelivery < 50 ? "text-emerald-400 border-emerald-400/30" :
                  wsDelivery < 200 ? "text-yellow-400 border-yellow-400/30" :
                  "text-red-400 border-red-400/30"
                }`}
              >
                {wsDelivery}ms
              </Badge>
            )}
          </div>
          <MobileMenu links={NAV_LINKS} activePath="/latency" />
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Title */}
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
            Latency Monitor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time infrastructure latency monitoring — inspired by{" "}
            <a href="https://hyperlatency.glassnode.com" target="_blank" rel="noopener" className="text-emerald-400/60 hover:text-emerald-400 transition-colors">
              HyperLatency
            </a>
          </p>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Pyth Oracle Delay */}
          <Card className="border-white/5 bg-[#111111]">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Pyth Oracle Delay
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-mono font-bold ${statusColor(pythDelay, [100, 500])}`}>
                {fmtMs(pythDelay)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {sources?.mode === "pro" ? "Pyth Pro (Lazer)" : "Pyth Hermes"} → Client
              </p>
            </CardContent>
          </Card>

          {/* HL REST API */}
          <Card className="border-white/5 bg-[#111111]">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                HL REST API
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-mono font-bold ${statusColor(hlRest, [200, 500])}`}>
                {fmtMs(hlRest)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                api.hyperliquid.xyz round-trip
              </p>
            </CardContent>
          </Card>

          {/* WS Delivery */}
          <Card className="border-white/5 bg-[#111111]">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-400" />
                WebSocket Delivery
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-mono font-bold ${statusColor(wsDelivery, [50, 200])}`}>
                {fmtMs(wsDelivery)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Edge DO → Your browser
              </p>
            </CardContent>
          </Card>

          {/* Overall Health */}
          <Card className="border-white/5 bg-[#111111]">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Overall Health
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${healthColor}`}>
                {healthLabel}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Score: {healthScore}/100
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Latency Chart */}
        <Card className="border-white/5 bg-[#111111] shadow-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Latency History
            </CardTitle>
            <CardDescription>
              Rolling 10-minute window — sampled every 5 seconds
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LatencyChart history={history} height={300} />
          </CardContent>
        </Card>

        {/* Historical Latency (7-day persistence) */}
        <Card className="border-white/5 bg-[#111111] shadow-2xl">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                  Historical Latency
                </CardTitle>
                <CardDescription>
                  Minute-aggregated percentiles — p50 / p95 / p99 — stored up to 7 days
                </CardDescription>
              </div>
              <div className="flex gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setHistRange(r)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      histRange === r
                        ? "bg-emerald-400/20 text-emerald-400 font-medium"
                        : "bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {histLoading ? (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                Loading historical data...
              </div>
            ) : histMinutes.length === 0 ? (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                No historical data yet — data accumulates over time (1-minute resolution)
              </div>
            ) : (
              <HistoricalLatencyChart minutes={histMinutes} height={300} />
            )}
          </CardContent>
        </Card>

        {/* Source Events Timeline */}
        {histEvents.length > 0 && (
          <Card className="border-white/5 bg-[#111111] shadow-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                Source Events
              </CardTitle>
              <CardDescription>
                Connection state changes — last {histRange} ({histEvents.length} events)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[300px] overflow-y-auto space-y-1">
                {histEvents.slice(0, 100).map((ev, i) => {
                  const isConnect = ev.event === "connect";
                  const dt = new Date(ev.t);
                  const timeStr = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                  const dateStr = dt.toLocaleDateString([], { month: "short", day: "numeric" });
                  return (
                    <div key={`${ev.t}-${ev.source}-${i}`} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-white/[0.02] text-xs">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isConnect ? "bg-emerald-400" : "bg-red-400"}`} />
                      <span className="text-muted-foreground w-[120px] flex-shrink-0 font-mono">
                        {dateStr} {timeStr}
                      </span>
                      <span className="font-medium w-[140px] flex-shrink-0">{ev.source}</span>
                      <span className={isConnect ? "text-emerald-400" : "text-red-400"}>
                        {ev.event}
                      </span>
                      {ev.detail && (
                        <span className="text-muted-foreground truncate">{ev.detail}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Source Health Table */}
        <Card className="border-white/5 bg-[#111111] shadow-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Source Health
            </CardTitle>
            <CardDescription>
              Per-source latency breakdown with percentiles
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Source</th>
                    <th className="text-left py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Status</th>
                    <th className="text-right py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Current</th>
                    <th className="text-right py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">p50</th>
                    <th className="text-right py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">p95</th>
                    <th className="text-right py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Min</th>
                    <th className="text-right py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Max</th>
                    <th className="text-right py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Health</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {/* Pyth Oracle */}
                  <tr className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="font-medium">Pyth Oracle</span>
                        <span className="text-[10px] text-muted-foreground">
                          {sources?.mode === "pro" ? "Lazer" : "Hermes"}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {(sources?.pythPro || sources?.pythHermes) ? (
                        <span className="text-emerald-400 text-xs">● Connected</span>
                      ) : (
                        <span className="text-red-400 text-xs">● Disconnected</span>
                      )}
                    </td>
                    <td className={`py-3 px-3 text-right font-mono ${statusColor(pythDelay, [100, 500])}`}>{fmtMs(pythDelay)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(pythStats.p50)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(pythStats.p95)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(pythStats.min)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(pythStats.max)}</td>
                    <td className="py-3 px-3 text-right">
                      <Badge variant="outline" className={`text-xs ${statusBadge(pythDelay, [100, 500]).variant}`}>
                        {statusBadge(pythDelay, [100, 500]).label}
                      </Badge>
                    </td>
                  </tr>

                  {/* HL REST API */}
                  <tr className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-400" />
                        <span className="font-medium">Hyperliquid REST</span>
                        <span className="text-[10px] text-muted-foreground">api.hyperliquid.xyz</span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {hlRest !== null && hlRest > 0 ? (
                        <span className="text-emerald-400 text-xs">● Responding</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">● Waiting</span>
                      )}
                    </td>
                    <td className={`py-3 px-3 text-right font-mono ${statusColor(hlRest, [200, 500])}`}>{fmtMs(hlRest)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(hlRestStats.p50)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(hlRestStats.p95)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(hlRestStats.min)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(hlRestStats.max)}</td>
                    <td className="py-3 px-3 text-right">
                      <Badge variant="outline" className={`text-xs ${statusBadge(hlRest, [200, 500]).variant}`}>
                        {statusBadge(hlRest, [200, 500]).label}
                      </Badge>
                    </td>
                  </tr>

                  {/* HL WebSocket */}
                  <tr className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-orange-400" />
                        <span className="font-medium">Hyperliquid WS</span>
                        <span className="text-[10px] text-muted-foreground">allMids interval</span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {sources?.hlWs ? (
                        <span className="text-emerald-400 text-xs">● Connected</span>
                      ) : (
                        <span className="text-red-400 text-xs">● Disconnected</span>
                      )}
                    </td>
                    <td className={`py-3 px-3 text-right font-mono ${statusColor(hlWs, [500, 2000])}`}>{fmtMs(hlWs)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(hlWsStats.p50)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(hlWsStats.p95)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(hlWsStats.min)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(hlWsStats.max)}</td>
                    <td className="py-3 px-3 text-right">
                      <Badge variant="outline" className={`text-xs ${statusBadge(hlWs, [500, 2000]).variant}`}>
                        {statusBadge(hlWs, [500, 2000]).label}
                      </Badge>
                    </td>
                  </tr>

                  {/* WebSocket Delivery */}
                  <tr className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-purple-400" />
                        <span className="font-medium">WS Delivery</span>
                        <span className="text-[10px] text-muted-foreground">Edge → Browser</span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {isConnected ? (
                        <span className="text-emerald-400 text-xs">● Connected</span>
                      ) : (
                        <span className="text-red-400 text-xs">● Disconnected</span>
                      )}
                    </td>
                    <td className={`py-3 px-3 text-right font-mono ${statusColor(wsDelivery, [50, 200])}`}>{fmtMs(wsDelivery)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(wsDeliveryStats.p50)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(wsDeliveryStats.p95)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(wsDeliveryStats.min)}</td>
                    <td className="py-3 px-3 text-right font-mono text-muted-foreground">{fmtMs(wsDeliveryStats.max)}</td>
                    <td className="py-3 px-3 text-right">
                      <Badge variant="outline" className={`text-xs ${statusBadge(wsDelivery, [50, 200]).variant}`}>
                        {statusBadge(wsDelivery, [50, 200]).label}
                      </Badge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Probe Status Table */}
        <Card className="border-white/5 bg-[#111111] shadow-2xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                  Probe Status
                </CardTitle>
                <CardDescription>
                  {onlineCount}/{probes.length} probes online — refreshing every 5s
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-xs text-muted-foreground border-white/10">
                From your browser
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Probe</th>
                    <th className="text-left py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Status</th>
                    <th className="text-right py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">API p50 ↑</th>
                    <th className="text-right py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">API p95</th>
                    <th className="text-right py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Fail Rate</th>
                    <th className="text-right py-3 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {probes.map((probe) => (
                    <tr key={probe.name} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-3">
                        <div>
                          <span className="font-medium">{probe.name}</span>
                          <p className="text-[10px] text-muted-foreground">{probe.location}</p>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        {probe.status === "online" ? (
                          <span className="text-emerald-400 text-xs">● Online</span>
                        ) : probe.status === "offline" ? (
                          <span className="text-red-400 text-xs">● Offline</span>
                        ) : (
                          <span className="text-yellow-400 text-xs animate-pulse">● Probing...</span>
                        )}
                      </td>
                      <td className={`py-3 px-3 text-right font-mono ${
                        probe.apiP50 === null ? "text-muted-foreground" :
                        probe.apiP50 < 100 ? "text-emerald-400" :
                        probe.apiP50 < 300 ? "text-yellow-400" : "text-red-400"
                      }`}>
                        {probe.apiP50 !== null ? `${probe.apiP50}ms` : "—"}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-muted-foreground">
                        {probe.apiP95 !== null ? `${probe.apiP95}ms` : "—"}
                      </td>
                      <td className={`py-3 px-3 text-right font-mono ${
                        probe.failRate === 0 ? "text-emerald-400" :
                        probe.failRate < 5 ? "text-yellow-400" : "text-red-400"
                      }`}>
                        {probe.failRate.toFixed(1)}%
                      </td>
                      <td className="py-3 px-3 text-right text-muted-foreground text-xs">
                        {timeAgo(probe.lastSeen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Japan RPC Colocation Intelligence */}
        <Card className="border-white/5 bg-[#111111] shadow-2xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                  <span>🇯🇵</span> Japan RPC Colocation
                </CardTitle>
                <CardDescription>
                  Optimal infrastructure for lowest latency to Hyperliquid validators
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30">
                Recommended Region
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Why Japan */}
            <div className="rounded-lg bg-emerald-400/5 border border-emerald-400/10 p-4">
              <p className="text-sm text-emerald-300/90 leading-relaxed">
                <span className="font-semibold text-emerald-400">Why Tokyo?</span>{" "}
                Hyperliquid's validator sentry nodes are peered in <span className="font-medium text-white">Tokyo, Japan</span> —
                colocating here gives sub-500μs response times via direct sentry peering, compared to 15-30ms from US/EU.
                This is the #1 region for latency-critical HL trading infrastructure.
              </p>
            </div>

            {/* RPC Provider Comparison Table */}
            <div>
              <h3 className="text-sm font-medium mb-3 text-white/80">Hyperliquid RPC Providers (Japan PoP)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left py-2.5 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Provider</th>
                      <th className="text-left py-2.5 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Japan PoP</th>
                      <th className="text-right py-2.5 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Latency</th>
                      <th className="text-left py-2.5 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Features</th>
                      <th className="text-right py-2.5 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">From</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white">HypeRPC</span>
                          <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-400/30 px-1.5 py-0">Best</Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground">by Imperator</p>
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-emerald-400 text-xs">● Tokyo</span>
                        <p className="text-[10px] text-muted-foreground">Sentry-peered bare metal</p>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-mono text-emerald-400">&lt;500μs</span>
                        <p className="text-[10px] text-muted-foreground">validator-peered</p>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">REST + WS</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">L2/L4 Book</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Streaming</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-mono text-white">Free</span>
                        <p className="text-[10px] text-muted-foreground">2M CU/mo</p>
                      </td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-3">
                        <span className="font-medium text-white">Dwellir</span>
                        <p className="text-[10px] text-muted-foreground">Dedicated clusters</p>
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-yellow-400 text-xs">● Custom</span>
                        <p className="text-[10px] text-muted-foreground">Co-located compute</p>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-mono text-yellow-400">~1ms</span>
                        <p className="text-[10px] text-muted-foreground">co-located</p>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">gRPC</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Orderbook</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Dedicated</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-mono text-white">Custom</span>
                        <p className="text-[10px] text-muted-foreground">Enterprise</p>
                      </td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-3">
                        <span className="font-medium text-white">Chainstack</span>
                        <p className="text-[10px] text-muted-foreground">Global deployments</p>
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-yellow-400 text-xs">● Asia</span>
                        <p className="text-[10px] text-muted-foreground">Multi-region</p>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-mono text-yellow-400">~17ms</span>
                        <p className="text-[10px] text-muted-foreground">avg regional</p>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">HyperEVM</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">HyperCore</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Private</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-mono text-white">$49</span>
                        <p className="text-[10px] text-muted-foreground">/month</p>
                      </td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-3">
                        <span className="font-medium text-white">QuickNode</span>
                        <p className="text-[10px] text-muted-foreground">Elastic endpoints</p>
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-blue-400 text-xs">● Global</span>
                        <p className="text-[10px] text-muted-foreground">Auto-routing</p>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-mono text-muted-foreground">~30ms</span>
                        <p className="text-[10px] text-muted-foreground">from JP</p>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">REST</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Add-ons</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Elastic</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-mono text-white">$49</span>
                        <p className="text-[10px] text-muted-foreground">/month</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pyth Oracle Providers */}
            <div>
              <h3 className="text-sm font-medium mb-3 text-white/80">Pyth Hermes Providers</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left py-2.5 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Provider</th>
                      <th className="text-left py-2.5 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Endpoint</th>
                      <th className="text-left py-2.5 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Type</th>
                      <th className="text-right py-2.5 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Rate Limit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-2.5 px-3 font-medium">Pyth (Public)</td>
                      <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">hermes.pyth.network</td>
                      <td className="py-2.5 px-3"><span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Free</span></td>
                      <td className="py-2.5 px-3 text-right font-mono text-xs text-muted-foreground">30/10s</td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-2.5 px-3 font-medium">Triton</td>
                      <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">triton.one (private)</td>
                      <td className="py-2.5 px-3"><span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400">Dedicated</span></td>
                      <td className="py-2.5 px-3 text-right font-mono text-xs text-muted-foreground">Custom</td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-2.5 px-3 font-medium">P2P</td>
                      <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">p2p.org (private)</td>
                      <td className="py-2.5 px-3"><span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400">Dedicated</span></td>
                      <td className="py-2.5 px-3 text-right font-mono text-xs text-muted-foreground">Custom</td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-2.5 px-3 font-medium">Liquify</td>
                      <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">liquify.io (private)</td>
                      <td className="py-2.5 px-3"><span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400">Dedicated</span></td>
                      <td className="py-2.5 px-3 text-right font-mono text-xs text-muted-foreground">Custom</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tokyo Datacenter Recommendations */}
            <div>
              <h3 className="text-sm font-medium mb-3 text-white/80">Tokyo Datacenter Recommendations</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-emerald-400 font-medium text-sm">Equinix TY</span>
                    <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-400/30 px-1.5 py-0">Top Pick</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
                    TY2/TY4/TY11 — Primary crypto trading hub in Tokyo. Direct cross-connects to major exchanges and HL validator sentry nodes.
                  </p>
                  <div className="flex gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Bare Metal</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Cross-Connect</span>
                  </div>
                </div>
                <div className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-blue-400 font-medium text-sm">AWS Tokyo</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
                    ap-northeast-1 — Good for cloud-native setups. Use EC2 metal instances (i3en.metal) for kernel bypass. ~2-5ms to HL validators.
                  </p>
                  <div className="flex gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Cloud</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Scalable</span>
                  </div>
                </div>
                <div className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-purple-400 font-medium text-sm">NTT Tokyo</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
                    CC1/AT1 — NTT's domestic fiber backbone offers ultra-low latency within Japan. Ideal for JP-resident traders.
                  </p>
                  <div className="flex gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Domestic</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">Fiber</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Latency Optimization Tips */}
            <div className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
              <h3 className="text-sm font-medium mb-3 text-white/80">Optimization Checklist</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Use <span className="text-white font-medium">HypeRPC Tokyo sentry</span> for sub-500μs validator access</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Dedicated Hermes node from <span className="text-white font-medium">Triton or P2P</span> for oracle data</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>WebSocket over REST — HL WS <span className="text-white font-medium">allMids</span> pushes updates vs polling</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Kernel bypass (DPDK/io_uring) on <span className="text-white font-medium">bare metal</span> for &lt;100μs network stack</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Co-locate bot + RPC on <span className="text-white font-medium">same rack</span> to eliminate network hop</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>Monitor with DeltaScope probes — <span className="text-white font-medium">p95 matters more</span> than average</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Info Section */}
        <Card className="border-white/5 bg-[#111111]">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
              <div>
                <h3 className="font-medium text-emerald-400 mb-2">Pyth Oracle Delay</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Time from Pyth oracle publish timestamp to when DeltaScope receives the update.
                  {sources?.mode === "pro" ? " Using Pyth Pro (Lazer) with real_time channel for 1-50ms updates." : " Using Pyth Hermes free tier."}
                </p>
              </div>
              <div>
                <h3 className="font-medium text-blue-400 mb-2">Hyperliquid REST API</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Round-trip time for metaAndAssetCtxs POST to api.hyperliquid.xyz. Measures funding rates,
                  open interest, and volume data fetch latency. Polled every 5 seconds.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-orange-400 mb-2">HL WebSocket Interval</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Time between consecutive allMids messages on the Hyperliquid WebSocket.
                  Not a direct latency measure — indicates real-time data freshness and connection health.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sources */}
        <Card className="border-white/5 bg-[#111111]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Sources
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
              <a href="https://hyperpc.app/" target="_blank" rel="noopener noreferrer" className="text-emerald-400/70 hover:text-emerald-400 transition-colors">
                HypeRPC — Hyperliquid Premier RPC ↗
              </a>
              <a href="https://www.comparenodes.com/protocols/hyperliquid/" target="_blank" rel="noopener noreferrer" className="text-emerald-400/70 hover:text-emerald-400 transition-colors">
                Hyperliquid RPC Providers 2026 — CompareNodes ↗
              </a>
              <a href="https://docs.pyth.network/price-feeds/core/api-instances-and-providers/hermes" target="_blank" rel="noopener noreferrer" className="text-emerald-400/70 hover:text-emerald-400 transition-colors">
                Pyth Hermes Providers — Developer Hub ↗
              </a>
              <a href="https://chainstack.com/top-hyperliquid-rpc-providers-for-2026/" target="_blank" rel="noopener noreferrer" className="text-emerald-400/70 hover:text-emerald-400 transition-colors">
                Chainstack — Top HL RPC Providers ↗
              </a>
              <a href="https://www.dwellir.com/networks/hyperliquid" target="_blank" rel="noopener noreferrer" className="text-emerald-400/70 hover:text-emerald-400 transition-colors">
                Dwellir — Hyperliquid Endpoints ↗
              </a>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <footer className="text-center text-xs text-muted-foreground py-4 border-t border-white/5 space-y-1">
          <p>Powered by DeltaScope — Pyth Hermes + Hyperliquid</p>
          <p className="text-emerald-400/80 font-medium" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
            Best Regard @0xPilotSB, All Hail Retard
          </p>
        </footer>
      </div>
      <OracleChatPopup />
    </main>
  );
}

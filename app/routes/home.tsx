import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/home";
import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { Separator } from "~/components/ui/separator";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import { usePriceStore, type DashboardData } from "~/stores/price-store";
import { TVChart, TIMEFRAMES, type ChartType } from "~/components/tv-chart";
import { MobileMenu } from "~/components/mobile-nav";
import { OracleChatPopup } from "~/components/oracle-chat";

// ─── Constants ─────────────────────────────────────────────

const ASSET_COLORS: Record<string, string> = {
  BTC: "#f7931a",
  ETH: "#627eea",
  SOL: "#9945ff",
  HYPE: "#10b981",
  ARB: "#28a0f0",
  DOGE: "#c2a633",
  AVAX: "#e84142",
  LINK: "#2a5ada",
};

const NAV_LINKS = [
  { label: "Ticker Analysis", href: "/analysis" },
  { label: "Predict & Win", href: "/predict" },
  { label: "Latency Monitor", href: "/latency" },
  { label: "Developers", href: "/developers" },
  { label: "Community", href: "https://discord.gg/pyth", external: true },
];


// ─── Types ─────────────────────────────────────────────────
// AssetData, DashboardData, PricePoint imported from ~/stores/price-store

// ─── Formatting Helpers ────────────────────────────────────

function formatUSD(value: number, decimals = 2): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  return `$${value.toFixed(decimals)}`;
}

function formatPrice(value: number): string {
  if (value >= 1000) return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

function formatPercent(value: number, decimals = 2): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

function formatCompact(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

// ─── Loader ────────────────────────────────────────────────

export function meta({}: Route.MetaArgs) {
  return [
    { title: "DeltaScope — HIP-3 Markets & Oracle Intelligence" },
    {
      name: "description",
      content:
        "Real-time HIP-3 market monitoring, oracle price feeds, and trader positioning powered by Pyth Network and Hyperliquid",
    },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  // Use DO cache for fast SSR — typically <5ms when warm
  // 1s timeout so SSR doesn't block on DO cold-start (show skeleton fast)
  const id = context.cloudflare.env.PRICE_AGGREGATOR.idFromName("global");
  const stub = context.cloudflare.env.PRICE_AGGREGATOR.get(id);

  const dataPromise = Promise.race([
    stub
      .fetch(new Request("https://internal/prices"))
      .then((r) => r.json() as Promise<DashboardData>),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
  ]).catch(() => null);

  return { dataPromise };
}

// ─── Navigation Header ─────────────────────────────────────

function NavHeader({
  statusContent,
}: {
  statusContent?: React.ReactNode;
}) {
  return (
    <header className="border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur-xl sticky top-0 z-50 relative">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-3 flex items-center justify-between">
        {/* Left: Logo + Branding */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
                <path d="M4 24L12 8L18 18L28 4" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1
              className="text-lg font-bold tracking-tight"
              style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}
            >
              Delta<span className="text-emerald-400">Scope</span>
            </h1>
          </div>

          {/* Center: Navigation Links */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) =>
              link.href.startsWith("/") ? (
                <Link
                  key={link.label}
                  to={link.href}
                  className="px-3 py-1.5 rounded-md text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                >
                  {link.label}
                </Link>
              ) : (
                <a
                  key={link.label}
                  href={link.href}
                  target={link.external ? "_blank" : undefined}
                  rel={link.external ? "noopener noreferrer" : undefined}
                  className="px-3 py-1.5 rounded-md text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                >
                  {link.label}
                  {link.external && (
                    <svg className="inline-block ml-1 w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  )}
                </a>
              )
            )}
          </nav>
        </div>

        {/* Right: Status indicators + mobile menu */}
        <div className="flex items-center gap-3">
          {statusContent}
          <MobileMenu links={NAV_LINKS} activePath="/" />
        </div>
      </div>
    </header>
  );
}


// ─── Component ─────────────────────────────────────────────

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <React.Suspense fallback={<DashboardSkeleton />}>
        <DashboardLoader dataPromise={loaderData.dataPromise} />
      </React.Suspense>
      <OracleChatPopup />
    </>
  );
}

function DashboardSkeleton() {
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#0a0a0a] text-white">
        <NavHeader
          statusContent={
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-xs text-muted-foreground">Connecting...</span>
              <Badge variant="outline" className="text-yellow-400 border-yellow-400/30 text-xs animate-pulse">
                LOADING
              </Badge>
            </>
          }
        />
        <main className="max-w-[1440px] mx-auto px-6 py-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="border-white/5 bg-[#111111]">
                <CardContent className="p-4">
                  <div className="h-4 w-20 bg-white/5 rounded animate-pulse mb-3" />
                  <div className="h-8 w-32 bg-white/5 rounded animate-pulse" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="border-white/5 bg-[#111111]">
            <CardContent className="p-6">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div key={i} className="h-12 bg-white/[0.02] rounded mb-2 animate-pulse" />
              ))}
            </CardContent>
          </Card>
        </main>
      </div>
    </TooltipProvider>
  );
}

function DashboardLoader({ dataPromise }: { dataPromise: Promise<DashboardData | null> }) {
  const initialData = React.use(dataPromise);
  return <Dashboard initialData={initialData} />;
}

function Dashboard({ initialData }: { initialData: DashboardData | null }) {
  // ── Zustand store ──
  const { data, isConnected, latencyMs, rawTicks, connect, disconnect, setInitialData } = usePriceStore();

  // Hydrate store with SSR data and connect WebSocket
  useEffect(() => {
    if (initialData) setInitialData(initialData);
    connect();
    return () => disconnect();
  }, []);

  // Derived source status
  const pythWsUp = useMemo(() => {
    const s = data?.sources;
    return s ? (s.pythPro || s.pythHermes || s.pythWs || false) : false;
  }, [data?.sources]);

  const hlWsUp = useMemo(() => data?.sources?.hlWs ?? false, [data?.sources]);
  const pythMode = useMemo(() => data?.sources?.mode ?? "hermes", [data?.sources]);
  const pythProLatency = useMemo(() => data?.sources?.pythProLatencyMs ?? null, [data?.sources]);

  // Leverage calculator state
  const [calcAsset, setCalcAsset] = useState("BTC");
  const [entryPrice, setEntryPrice] = useState("");
  const [positionSize, setPositionSize] = useState("10000");
  const [leverage, setLeverage] = useState([10]);

  // Chart asset state
  const [chartAsset, setChartAsset] = useState("BTC");
  const [chartTimeframe, setChartTimeframe] = useState(1);
  const [chartType, setChartType] = useState<ChartType>("line");

  // Raw ticks for selected chart asset
  const chartTicks = useMemo(() => {
    return rawTicks.get(chartAsset) ?? [];
  }, [rawTicks, chartAsset]);

  const chartCurrentPrice = useMemo(() => {
    const asset = data?.assets.find((a) => a.symbol === chartAsset);
    return asset?.pythPrice;
  }, [data?.assets, chartAsset]);

  // Set entry price only on asset change (not every tick)
  const prevCalcAssetRef = useRef(calcAsset);
  useEffect(() => {
    if (!data) return;
    // Only auto-set on initial load (empty) or asset switch
    if (entryPrice === "" || calcAsset !== prevCalcAssetRef.current) {
      const asset = data.assets.find((a) => a.symbol === calcAsset);
      if (asset) {
        setEntryPrice(asset.markPrice.toFixed(2));
      }
      prevCalcAssetRef.current = calcAsset;
    }
  }, [calcAsset, data, entryPrice]);

  // Live mark price for the selected calc asset
  const calcCurrentPrice = useMemo(() => {
    const asset = data?.assets.find((a) => a.symbol === calcAsset);
    return asset?.markPrice ?? 0;
  }, [data?.assets, calcAsset]);

  // ── Memoized Stats Bar Values ──
  const statsBarValues = useMemo(() => ({
    volume: formatCompact(data?.totalVolume24h ?? 0),
    openInterest: formatCompact(data?.totalOpenInterest ?? 0),
    avgFunding: formatPercent((data?.avgFundingRate ?? 0) * 24 * 365 * 100, 3),
    discrepancyCount: data?.discrepancyCount ?? 0,
    assetCount: data?.assets.length ?? 0,
  }), [data?.totalVolume24h, data?.totalOpenInterest, data?.avgFundingRate, data?.discrepancyCount, data?.assets?.length]);

  // ── Leverage Calculator Logic (memoized) ──
  const calcResults = useMemo(() => {
    const entry = parseFloat(entryPrice) || 0;
    const size = parseFloat(positionSize) || 0;
    const lev = leverage[0];
    const margin = size / lev;
    const liquidationLong = entry * (1 - 1 / lev + 0.006);
    const liquidationShort = entry * (1 + 1 / lev - 0.006);
    const qty = size / entry;
    const pnlPlus5 = qty * entry * 0.05 * lev;
    const pnlMinus5 = qty * entry * -0.05 * lev;
    const pnlMinus10 = qty * entry * -0.1 * lev;
    // Real-time unrealized PnL (long)
    const unrealizedLong = entry > 0 && calcCurrentPrice > 0 ? (calcCurrentPrice - entry) * qty * lev : 0;
    // Real-time unrealized PnL (short)
    const unrealizedShort = entry > 0 && calcCurrentPrice > 0 ? (entry - calcCurrentPrice) * qty * lev : 0;
    const priceChange = entry > 0 && calcCurrentPrice > 0 ? ((calcCurrentPrice - entry) / entry) * 100 : 0;
    return { entry, size, lev, margin, liquidationLong, liquidationShort, qty, pnlPlus5, pnlMinus5, pnlMinus10, unrealizedLong, unrealizedShort, priceChange };
  }, [entryPrice, positionSize, leverage, calcCurrentPrice]);

  // Memoized callbacks for props
  const handleCalcAssetChange = useCallback((v: string) => setCalcAsset(v), []);
  const handleEntryPriceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => setEntryPrice(e.target.value), []);
  const handlePositionSizeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => setPositionSize(e.target.value), []);
  const handleLeverageChange = useCallback((v: number[]) => setLeverage(v), []);
  const handleChartAssetChange = useCallback((v: string) => setChartAsset(v), []);
  const handleTimeframeChange = useCallback((s: number) => setChartTimeframe(s), []);

  if (!data) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Card className="border-red-500/30 bg-red-950/20 max-w-md">
          <CardHeader>
            <CardTitle className="text-red-400">Connection Error</CardTitle>
            <CardDescription>Unable to connect to data sources. Please try again later.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Please try again later. The WebSocket will auto-reconnect.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { entry, size, lev, margin, liquidationLong, liquidationShort, qty, pnlPlus5, pnlMinus5, pnlMinus10, unrealizedLong, unrealizedShort, priceChange } = calcResults;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#0a0a0a] text-white">
        {/* Header */}
        <NavHeader
          statusContent={
            <>
              {/* Source indicators */}
              {isConnected && (
                <div className="hidden sm:flex items-center gap-2 mr-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1 cursor-help">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${pythWsUp ? "bg-emerald-400" : "bg-yellow-400"}`} />
                        <span className="text-[10px] text-muted-foreground">
                          {pythMode === "pro" ? "PYTH PRO" : "PYTH"}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs space-y-1">
                        <p>{pythMode === "pro" ? "Pyth Pro (Lazer) \u2014 real_time channel" : "Pyth Hermes (free tier)"}</p>
                        {pythMode === "pro" && pythProLatency != null && (
                          <p>Source latency: {pythProLatency.toFixed(1)}ms</p>
                        )}
                        {pythMode === "hermes" && (
                          <p className="text-yellow-400">Set PYTH_PRO_TOKEN for 1-50ms updates</p>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1 cursor-help">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${hlWsUp ? "bg-emerald-400" : "bg-yellow-400"}`} />
                        <span className="text-[10px] text-muted-foreground">HL</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Hyperliquid WebSocket: {hlWsUp ? "Connected" : "Reconnecting"}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
              <div className="hidden sm:flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    isConnected ? "bg-emerald-400" : "bg-yellow-400 animate-pulse"
                  }`}
                />
                <span className="text-xs text-muted-foreground">
                  {isConnected ? "Streaming" : "Reconnecting..."}
                </span>
              </div>
              {latencyMs !== null && isConnected && (
                <Badge variant="outline" className={`font-mono text-xs ${latencyMs < 50 ? "text-emerald-400 border-emerald-400/30" : latencyMs < 200 ? "text-yellow-400 border-yellow-400/30" : "text-red-400 border-red-400/30"}`}>
                  {latencyMs}ms
                </Badge>
              )}
              <Badge variant="outline" className={`text-xs ${isConnected ? "text-emerald-400 border-emerald-400/30" : "text-yellow-400 border-yellow-400/30 animate-pulse"}`}>
                {isConnected ? "LIVE" : "CONNECTING"}
              </Badge>
            </>
          }
        />

        <main className="max-w-[1440px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="24h Volume"
              value={statsBarValues.volume}
              icon={
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              }
            />
            <StatCard
              title="Open Interest"
              value={statsBarValues.openInterest}
              icon={
                <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              }
            />
            <StatCard
              title="Avg Funding Rate"
              value={statsBarValues.avgFunding}
              subtitle="Annualized"
              icon={
                <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              title="Oracle Discrepancies"
              value={`${statsBarValues.discrepancyCount}`}
              subtitle="> 0.5% deviation"
              icon={
                <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              }
              valueColor={
                statsBarValues.discrepancyCount > 0
                  ? "text-amber-400"
                  : "text-emerald-400"
              }
            />
          </div>

          {/* HIP-3 Market Monitor — deferred to avoid blocking initial paint */}
          <DeferredHip3Monitor />

          {/* Price Table */}
          <Card className="border-white/5 bg-[#111111] shadow-2xl">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle
                    className="text-lg"
                    style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}
                  >
                    Market Overview
                  </CardTitle>
                  <CardDescription>
                    Oracle prices from Pyth Network vs Hyperliquid mark prices
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs text-muted-foreground border-white/10">
                  {statsBarValues.assetCount} Assets
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableHead className="pl-6 text-muted-foreground text-xs uppercase tracking-wider">
                      Asset
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs uppercase tracking-wider text-right">
                      Pyth Oracle
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs uppercase tracking-wider text-right">
                      HL Mark Price
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs uppercase tracking-wider text-right">
                      Discrepancy
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs uppercase tracking-wider text-right">
                      24h Change
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs uppercase tracking-wider text-right">
                      Funding (Ann.)
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs uppercase tracking-wider text-right">
                      Open Interest
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs uppercase tracking-wider text-right pr-6">
                      24h Volume
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.assets ?? []).map((asset) => (
                    <TableRow
                      key={asset.symbol}
                      className="border-white/5 hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Asset */}
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                            style={{
                              backgroundColor: `${ASSET_COLORS[asset.symbol]}20`,
                              color: ASSET_COLORS[asset.symbol],
                            }}
                          >
                            {asset.symbol.slice(0, 2)}
                          </div>
                          <div>
                            <span className="font-semibold text-sm">{asset.symbol}</span>
                            <span className="text-muted-foreground text-xs ml-1">/USD</span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Pyth Oracle Price */}
                      <TableCell className="text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="font-mono text-sm cursor-help border-b border-dotted border-white/20">
                              {formatPrice(asset.pythPrice)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs space-y-1">
                              <p>
                                <span className="text-muted-foreground">Confidence:</span>{" "}
                                {"\u00B1"}{formatPrice(asset.pythConfidence)}
                              </p>
                              {asset.bestBidPrice && asset.bestAskPrice ? (
                                <>
                                  <p>
                                    <span className="text-muted-foreground">Best Bid:</span>{" "}
                                    {formatPrice(asset.bestBidPrice)}
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Best Ask:</span>{" "}
                                    {formatPrice(asset.bestAskPrice)}
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Spread:</span>{" "}
                                    {formatPrice(asset.bestAskPrice - asset.bestBidPrice)}
                                    {" "}({((asset.bestAskPrice - asset.bestBidPrice) / asset.pythPrice * 100).toFixed(4)}%)
                                  </p>
                                </>
                              ) : null}
                              {asset.publisherCount ? (
                                <p>
                                  <span className="text-muted-foreground">Publishers:</span>{" "}
                                  {asset.publisherCount}
                                </p>
                              ) : null}
                              <p>
                                <span className="text-muted-foreground">Expo:</span>{" "}
                                {asset.pythExpo}
                              </p>
                              <p>
                                <span className="text-muted-foreground">Published:</span>{" "}
                                {new Date(asset.publishTime * (asset.publishTime > 1e12 ? 0.001 : 1000)).toLocaleTimeString()}
                              </p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>

                      {/* Mark Price */}
                      <TableCell className="text-right font-mono text-sm">
                        {formatPrice(asset.markPrice)}
                      </TableCell>

                      {/* Oracle Discrepancy */}
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className={`font-mono text-xs ${
                            asset.oracleDiscrepancy < 0.1
                              ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/5"
                              : asset.oracleDiscrepancy < 0.5
                              ? "text-yellow-400 border-yellow-400/30 bg-yellow-400/5"
                              : "text-red-400 border-red-400/30 bg-red-400/5"
                          }`}
                        >
                          {asset.oracleDiscrepancy.toFixed(4)}%
                        </Badge>
                      </TableCell>

                      {/* 24h Change */}
                      <TableCell
                        className={`text-right font-mono text-sm ${
                          asset.change24h >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {formatPercent(asset.change24h)}
                      </TableCell>

                      {/* Funding Rate (annualized) */}
                      <TableCell
                        className={`text-right font-mono text-sm ${
                          asset.fundingRate >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {formatPercent(
                          asset.fundingRate * 24 * 365 * 100,
                          3
                        )}
                      </TableCell>

                      {/* Open Interest */}
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {formatCompact(asset.openInterest)}
                      </TableCell>

                      {/* Volume */}
                      <TableCell className="text-right font-mono text-sm text-muted-foreground pr-6">
                        {formatCompact(asset.volume24h)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>

          {/* Bottom Section - Two Panels */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Real-time Price Chart (TradingView) — 3/5 width */}
            <Card className="border-white/5 bg-[#111111] shadow-2xl lg:col-span-3">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle
                      className="text-lg flex items-center gap-2"
                      style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}
                    >
                      <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                      </svg>
                      Real-time Price
                    </CardTitle>
                    <CardDescription>
                      Live streaming from Pyth Oracle
                    </CardDescription>
                  </div>
                  <Select value={chartAsset} onValueChange={handleChartAssetChange}>
                    <SelectTrigger className="w-[100px] bg-white/5 border-white/10 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      {(data?.assets ?? []).map((a) => (
                        <SelectItem key={a.symbol} value={a.symbol}>
                          {a.symbol}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Timeframe + Chart type selector */}
                <div className="flex items-center gap-3 mt-2">
                  <div className="flex gap-1">
                    {TIMEFRAMES.map((tf) => (
                      <button
                        key={tf.label}
                        onClick={() => handleTimeframeChange(tf.seconds)}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                          chartTimeframe === tf.seconds
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "bg-white/5 text-muted-foreground hover:bg-white/10 border border-transparent"
                        }`}
                        style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}
                      >
                        {tf.label}
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-5 bg-white/10" />
                  {/* Chart type toggle */}
                  <div className="flex gap-1">
                    <button
                      onClick={() => setChartType("line")}
                      title="Line chart"
                      className={`p-1.5 rounded transition-colors ${
                        chartType === "line"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-white/5 text-muted-foreground hover:bg-white/10 border border-transparent"
                      }`}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1,12 4,7 7,9 10,4 15,6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setChartType("candlestick")}
                      title="Candlestick chart"
                      className={`p-1.5 rounded transition-colors ${
                        chartType === "candlestick"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-white/5 text-muted-foreground hover:bg-white/10 border border-transparent"
                      }`}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <line x1="4" y1="2" x2="4" y2="14" />
                        <rect x="2.5" y="5" width="3" height="5" rx="0.5" fill="currentColor" />
                        <line x1="12" y1="1" x2="12" y2="13" />
                        <rect x="10.5" y="3" width="3" height="6" rx="0.5" fill="currentColor" />
                      </svg>
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <TVChart
                  symbol={`${chartAsset}/USD`}
                  ticks={chartTicks}
                  currentPrice={chartCurrentPrice}
                  height={400}
                  timeframe={chartTimeframe}
                  chartType={chartType}
                />

                {/* Current funding info */}
                {data && (
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {(() => {
                      const asset = data.assets.find(
                        (a) => a.symbol === chartAsset
                      );
                      if (!asset) return null;
                      const annualized =
                        asset.fundingRate * 24 * 365 * 100;
                      return (
                        <>
                          <div className="bg-white/[0.02] rounded-lg p-3 text-center">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Current Rate
                            </p>
                            <p
                              className={`text-sm font-mono font-bold mt-1 ${
                                asset.fundingRate >= 0
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }`}
                            >
                              {(asset.fundingRate * 100).toFixed(6)}%
                            </p>
                          </div>
                          <div className="bg-white/[0.02] rounded-lg p-3 text-center">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Annualized
                            </p>
                            <p
                              className={`text-sm font-mono font-bold mt-1 ${
                                annualized >= 0
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }`}
                            >
                              {formatPercent(annualized, 3)}
                            </p>
                          </div>
                          <div className="bg-white/[0.02] rounded-lg p-3 text-center">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Direction
                            </p>
                            <p className="text-sm font-bold mt-1">
                              {asset.fundingRate >= 0 ? (
                                <span className="text-emerald-400">
                                  Longs Pay
                                </span>
                              ) : (
                                <span className="text-red-400">
                                  Shorts Pay
                                </span>
                              )}
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Leverage Calculator — 2/5 width */}
            <Card className="border-white/5 bg-[#111111] shadow-2xl lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle
                  className="text-base flex items-center gap-2"
                  style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}
                >
                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Leverage Calculator
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Compact inputs row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Asset
                    </Label>
                    <Select value={calcAsset} onValueChange={handleCalcAssetChange}>
                      <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" sideOffset={4}>
                        {(data?.assets ?? []).map((a) => (
                          <SelectItem key={a.symbol} value={a.symbol}>
                            {a.symbol}/USD
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Entry Price ($)
                    </Label>
                    <Input
                      type="number"
                      value={entryPrice}
                      onChange={handleEntryPriceChange}
                      className="bg-white/5 border-white/10 font-mono h-9 text-sm"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Position Size ($)
                    </Label>
                    <Input
                      type="number"
                      value={positionSize}
                      onChange={handlePositionSizeChange}
                      className="bg-white/5 border-white/10 font-mono h-9 text-sm"
                      placeholder="10000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        Leverage
                      </Label>
                      <span className="text-xs font-mono text-emerald-400 font-bold">
                        {lev}x
                      </span>
                    </div>
                    <Slider
                      value={leverage}
                      onValueChange={handleLeverageChange}
                      min={1}
                      max={100}
                      step={1}
                      className="mt-3 [&_[data-slot=slider-thumb]]:bg-emerald-400 [&_[data-slot=slider-range]]:bg-emerald-500"
                    />
                    <div className="flex justify-between text-[9px] text-muted-foreground">
                      <span>1x</span>
                      <span>25x</span>
                      <span>50x</span>
                      <span>100x</span>
                    </div>
                  </div>
                </div>

                {/* Results */}
                {entry > 0 && size > 0 && (
                  <>
                    <Separator className="bg-white/5" />
                    <div className="grid grid-cols-2 gap-2">
                      <ResultCard label="Margin" value={formatUSD(margin)} />
                      <ResultCard label="Qty" value={`${qty.toFixed(4)} ${calcAsset}`} />
                      <ResultCard label="Liq. Long" value={formatPrice(liquidationLong)} className="text-red-400" />
                      <ResultCard label="Liq. Short" value={formatPrice(liquidationShort)} className="text-red-400" />
                    </div>

                    {/* Live Unrealized PnL */}
                    {calcCurrentPrice > 0 && entry > 0 && (
                      <div className="bg-white/[0.02] rounded-lg p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                            Live PnL
                          </p>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {formatPrice(calcCurrentPrice)} ({priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)}%)
                          </span>
                        </div>
                        <PnLRow label="Long" value={unrealizedLong} />
                        <PnLRow label="Short" value={unrealizedShort} />
                      </div>
                    )}

                    <div className="bg-white/[0.02] rounded-lg p-2.5 space-y-1.5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        PnL Scenarios ({lev}x)
                      </p>
                      <PnLRow label="+5%" value={pnlPlus5} />
                      <PnLRow label="-5%" value={pnlMinus5} />
                      <PnLRow label="-10%" value={pnlMinus10} />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Footer */}
          <footer className="border-t border-white/5 pt-4 pb-8">
            <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
              <p>
                Data sourced from{" "}
                <a
                  href="https://pyth.network"
                  target="_blank"
                  rel="noopener"
                  className="text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  Pyth Network
                </a>{" "}
                &{" "}
                <a
                  href="https://hyperliquid.xyz"
                  target="_blank"
                  rel="noopener"
                  className="text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  Hyperliquid
                </a>
              </p>
              <p className="text-emerald-400/80 font-medium" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                Best Regard @0xPilotSB, All Hail Retard
              </p>
            </div>
          </footer>
        </main>
      </div>
    </TooltipProvider>
  );
}

// ─── Sub-components ────────────────────────────────────────

const StatCard = React.memo(function StatCard({
  title,
  value,
  subtitle,
  icon,
  valueColor,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <Card className="border-white/5 bg-[#111111] hover:bg-[#151515] transition-colors">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            {title}
          </span>
          {icon}
        </div>
        <p
          className={`text-2xl font-bold font-mono tracking-tight ${
            valueColor ?? "text-white"
          }`}
          style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}
        >
          {value}
        </p>
        {subtitle && (
          <p className="text-[10px] text-muted-foreground mt-1">
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
});

const ResultCard = React.memo(function ResultCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="bg-white/[0.02] rounded-lg p-3">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <p className={`text-sm font-mono font-bold mt-1 ${className ?? "text-white"}`}>
        {value}
      </p>
    </div>
  );
});

const PnLRow = React.memo(function PnLRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-mono font-bold ${
          value >= 0 ? "text-emerald-400" : "text-red-400"
        }`}
      >
        {value >= 0 ? "+" : ""}
        {formatUSD(Math.abs(value))}
        {value < 0 ? " loss" : ""}
      </span>
    </div>
  );
});

// ─── HIP-3 Monitor Component ────────────────────────────────

// Deferred wrapper — renders Hip3Monitor after initial paint to avoid blocking main content
function DeferredHip3Monitor() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Use requestIdleCallback to defer until browser is idle, fallback to setTimeout
    const id = typeof requestIdleCallback !== "undefined"
      ? requestIdleCallback(() => setReady(true))
      : setTimeout(() => setReady(true), 100);
    return () => {
      if (typeof cancelIdleCallback !== "undefined") cancelIdleCallback(id as number);
      else clearTimeout(id as ReturnType<typeof setTimeout>);
    };
  }, []);
  if (!ready) return null;
  return <Hip3Monitor />;
}

interface Hip3Dex {
  name: string;
  fullName: string;
  deployer: string;
  assetCount: number;
  totalVolume24h: number;
  totalOpenInterest: number;
  assets: Hip3Asset[];
}

interface Hip3Asset {
  name: string;
  coin: string;
  maxLeverage: number;
  growthMode: boolean;
  markPx: number;
  oraclePx: number;
  oracleDeviation: number;
  funding: number;
  openInterest: number;
  volume24h: number;
  change24h: number;
  midPx: number;
  premium: number;
}

interface Hip3Data {
  dexes: Hip3Dex[];
  totalDexes: number;
  totalAssets: number;
  hip3TotalVolume24h: number;
  hip3TotalOI: number;
  validatorVolume24h: number;
  validatorOI: number;
  hip3VolumeShare: number;
  timestamp: number;
}

function Hip3Monitor() {
  const [hip3, setHip3] = useState<Hip3Data | null>(null);
  const [selectedDex, setSelectedDex] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/hip3");
        if (res.ok && active) {
          const data = await res.json() as Hip3Data;
          setHip3(data);
          if (!selectedDex && data.dexes.length > 0) {
            setSelectedDex(data.dexes[0].name);
          }
        }
      } catch {}
      setLoading(false);
      if (active) setTimeout(poll, 30000);
    };
    poll();
    return () => { active = false; };
  }, []);

  if (loading || !hip3) {
    return (
      <Card className="border-white/5 bg-[#111111] shadow-2xl">
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Loading HIP-3 markets...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const activeDex = hip3.dexes.find(d => d.name === selectedDex) ?? hip3.dexes[0];
  const totalVolume = hip3.hip3TotalVolume24h + hip3.validatorVolume24h;

  return (
    <div className="space-y-4">
      {/* HIP-3 Overview Stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
            HIP-3 Markets
          </h2>
          <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30">
            {hip3.totalDexes} DEXs · {hip3.totalAssets} Assets
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground">
          Updated {new Date(hip3.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* HIP-3 vs Validator Comparison */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-white/5 bg-[#111111]">
          <CardContent className="p-4">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">HIP-3 Volume (24h)</span>
            <p className="text-xl font-bold font-mono text-emerald-400 mt-1">{formatCompact(hip3.hip3TotalVolume24h)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {hip3.hip3VolumeShare.toFixed(1)}% of total
            </p>
          </CardContent>
        </Card>
        <Card className="border-white/5 bg-[#111111]">
          <CardContent className="p-4">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Validator Volume (24h)</span>
            <p className="text-xl font-bold font-mono text-blue-400 mt-1">{formatCompact(hip3.validatorVolume24h)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {(100 - hip3.hip3VolumeShare).toFixed(1)}% of total
            </p>
          </CardContent>
        </Card>
        <Card className="border-white/5 bg-[#111111]">
          <CardContent className="p-4">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">HIP-3 Open Interest</span>
            <p className="text-xl font-bold font-mono text-white mt-1">{formatCompact(hip3.hip3TotalOI)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Across {hip3.totalAssets} markets
            </p>
          </CardContent>
        </Card>
        <Card className="border-white/5 bg-[#111111]">
          <CardContent className="p-4">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Fee Structure</span>
            <p className="text-xl font-bold font-mono text-yellow-400 mt-1">2x</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              HIP-3 fees vs validator perps
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Volume Share Bar */}
      <Card className="border-white/5 bg-[#111111]">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Volume Distribution</span>
            <span className="text-xs font-mono text-muted-foreground">{formatCompact(totalVolume)} total</span>
          </div>
          <div className="h-3 rounded-full bg-white/5 overflow-hidden flex">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-1000"
              style={{ width: `${hip3.hip3VolumeShare}%` }}
            />
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-1000"
              style={{ width: `${100 - hip3.hip3VolumeShare}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-[10px] text-muted-foreground">HIP-3 ({hip3.hip3VolumeShare.toFixed(1)}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              <span className="text-[10px] text-muted-foreground">Validator ({(100 - hip3.hip3VolumeShare).toFixed(1)}%)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* DEX Selector + Asset Table */}
      <Card className="border-white/5 bg-[#111111] shadow-2xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                Deployer Markets
              </CardTitle>
              <CardDescription>
                Per-DEX asset breakdown with oracle health and trading data
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {hip3.dexes.map(dex => (
                <button
                  key={dex.name}
                  onClick={() => setSelectedDex(dex.name)}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    selectedDex === dex.name
                      ? "bg-emerald-400/20 text-emerald-400 border border-emerald-400/30"
                      : "bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10 border border-transparent"
                  }`}
                >
                  {dex.fullName}
                  <span className="ml-1 text-[9px] opacity-60">{dex.assetCount}</span>
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {activeDex && (
            <>
              {/* DEX Info Bar */}
              <div className="px-3 sm:px-6 pb-3 flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-muted-foreground border-b border-white/5">
                <span>Deployer: <span className="font-mono text-white/60">{activeDex.deployer.slice(0, 6)}...{activeDex.deployer.slice(-4)}</span></span>
                <Separator orientation="vertical" className="h-3" />
                <span>Volume: <span className="font-mono text-white">{formatCompact(activeDex.totalVolume24h)}</span></span>
                <Separator orientation="vertical" className="h-3" />
                <span>OI: <span className="font-mono text-white">{formatCompact(activeDex.totalOpenInterest)}</span></span>
              </div>

              {/* Asset Table */}
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableHead className="pl-6 text-muted-foreground text-xs uppercase tracking-wider">Asset</TableHead>
                    <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider">Mark Price</TableHead>
                    <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider">Oracle Price</TableHead>
                    <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider">Deviation</TableHead>
                    <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider">24h Change</TableHead>
                    <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider">Funding</TableHead>
                    <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider">Open Interest</TableHead>
                    <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wider">Volume</TableHead>
                    <TableHead className="text-right pr-6 text-muted-foreground text-xs uppercase tracking-wider">Leverage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeDex.assets
                    .sort((a, b) => b.volume24h - a.volume24h)
                    .map(asset => (
                    <TableRow key={asset.name} className="border-white/5 hover:bg-white/[0.02]">
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{asset.coin}</span>
                          {asset.growthMode && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-400/10 text-emerald-400">GROWTH</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {asset.markPx > 0 ? formatPrice(asset.markPx) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {asset.oraclePx > 0 ? formatPrice(asset.oraclePx) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className={`font-mono text-xs ${
                            asset.oracleDeviation < 0.1
                              ? "text-emerald-400 border-emerald-400/30"
                              : asset.oracleDeviation < 0.5
                              ? "text-yellow-400 border-yellow-400/30"
                              : "text-red-400 border-red-400/30"
                          }`}
                        >
                          {asset.oracleDeviation.toFixed(3)}%
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm ${asset.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {formatPercent(asset.change24h)}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm ${asset.funding >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {formatPercent(asset.funding * 24 * 365 * 100, 3)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {asset.openInterest > 0 ? formatCompact(asset.openInterest) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {asset.volume24h > 0 ? formatCompact(asset.volume24h) : "—"}
                      </TableCell>
                      <TableCell className="text-right pr-6 font-mono text-sm">
                        {asset.maxLeverage}x
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

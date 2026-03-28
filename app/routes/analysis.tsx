import { useState, useMemo } from "react";
import { Link } from "react-router";
import * as React from "react";
import type { Route } from "./+types/analysis";
import { MobileMenu } from "~/components/mobile-nav";
import { OracleChatPopup } from "~/components/oracle-chat";
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

// ─── Types ─────────────────────────────────────────────────

interface TraderPosition {
  trader: string;
  displayName: string | null;
  coin: string;
  szi: number;
  entryPx: number;
  liquidationPx: number | null;
  leverage: number;
  unrealizedPnl: number;
  positionValue: number;
  marginUsed: number;
}

interface TickerAnalysis {
  coin: string;
  longCount: number;
  shortCount: number;
  totalLongSize: number;
  totalShortSize: number;
  avgLongEntry: number;
  avgShortEntry: number;
  longLiqMin: number;
  longLiqMax: number;
  shortLiqMin: number;
  shortLiqMax: number;
  totalUnrealizedPnl: number;
  traderCount: number;
  positions: TraderPosition[];
}

interface AnalysisData {
  tickers: TickerAnalysis[];
  tradersFetched: number;
  fetchedAt: number;
}

// ─── Constants ─────────────────────────────────────────────

const NAV_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Ticker Analysis", href: "/analysis" },
  { label: "Latency Monitor", href: "/latency" },
  { label: "Developers", href: "/developers" },
  { label: "Community", href: "https://discord.gg/pyth", external: true },
];

const TOP_N_TRADERS = 20;

// ─── Formatting Helpers ────────────────────────────────────

function formatUSD(value: number, decimals = 2): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  return `$${value.toFixed(decimals)}`;
}

function formatPrice(value: number): string {
  if (!value || !isFinite(value)) return "—";
  if (value >= 1000) return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

function formatSize(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(2);
}

function truncateAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ─── Data Fetching ─────────────────────────────────────────

let cachedData: AnalysisData | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

async function fetchAnalysisData(): Promise<AnalysisData> {
  if (cachedData && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedData;
  }

  // Stage 1: Fetch leaderboard
  const lbRes = await fetch("https://stats-data.hyperliquid.xyz/Mainnet/leaderboard");
  if (!lbRes.ok) throw new Error("Failed to fetch leaderboard");
  const lb = await lbRes.json() as {
    leaderboardRows: {
      ethAddress: string;
      accountValue: string;
      displayName: string | null;
      windowPerformances: [string, { pnl: string; roi: string }][];
    }[];
  };

  const topTraders = lb.leaderboardRows
    .sort((a, b) => parseFloat(b.accountValue) - parseFloat(a.accountValue))
    .slice(0, TOP_N_TRADERS);

  // Stage 2: Fetch positions for each trader in parallel
  const posResults = await Promise.allSettled(
    topTraders.map(async (trader) => {
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "clearinghouseState", user: trader.ethAddress }),
      });
      if (!res.ok) return null;
      const state = await res.json() as {
        assetPositions: {
          position: {
            coin: string;
            szi: string;
            entryPx: string;
            liquidationPx: string | null;
            leverage: { type: string; value: number };
            unrealizedPnl: string;
            positionValue: string;
            marginUsed: string;
          };
        }[];
      };
      return {
        trader: trader.ethAddress,
        displayName: trader.displayName,
        positions: state.assetPositions ?? [],
      };
    })
  );

  // Stage 3: Collect all positions
  const allPositions: TraderPosition[] = [];
  for (const r of posResults) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const { trader, displayName, positions } = r.value;
    for (const ap of positions) {
      const p = ap.position;
      const szi = parseFloat(p.szi);
      if (szi === 0) continue;
      allPositions.push({
        trader,
        displayName,
        coin: p.coin,
        szi,
        entryPx: parseFloat(p.entryPx),
        liquidationPx: p.liquidationPx ? parseFloat(p.liquidationPx) : null,
        leverage: p.leverage.value,
        unrealizedPnl: parseFloat(p.unrealizedPnl),
        positionValue: parseFloat(p.positionValue),
        marginUsed: parseFloat(p.marginUsed),
      });
    }
  }

  // Stage 4: Aggregate by coin
  const byCoin = new Map<string, TraderPosition[]>();
  for (const pos of allPositions) {
    const arr = byCoin.get(pos.coin) ?? [];
    arr.push(pos);
    byCoin.set(pos.coin, arr);
  }

  const tickers: TickerAnalysis[] = [];
  for (const [coin, positions] of byCoin) {
    const longs = positions.filter((p) => p.szi > 0);
    const shorts = positions.filter((p) => p.szi < 0);

    const totalLongSize = longs.reduce((s, p) => s + Math.abs(p.szi) * p.entryPx, 0);
    const totalShortSize = shorts.reduce((s, p) => s + Math.abs(p.szi) * p.entryPx, 0);

    const avgLongEntry = longs.length > 0
      ? longs.reduce((s, p) => s + p.entryPx * Math.abs(p.szi), 0) / longs.reduce((s, p) => s + Math.abs(p.szi), 0)
      : 0;
    const avgShortEntry = shorts.length > 0
      ? shorts.reduce((s, p) => s + p.entryPx * Math.abs(p.szi), 0) / shorts.reduce((s, p) => s + Math.abs(p.szi), 0)
      : 0;

    const longLiqs = longs.map((p) => p.liquidationPx).filter((v): v is number => v !== null && v > 0 && isFinite(v));
    const shortLiqs = shorts.map((p) => p.liquidationPx).filter((v): v is number => v !== null && v > 0 && isFinite(v));

    const traders = new Set(positions.map((p) => p.trader));

    tickers.push({
      coin,
      longCount: longs.length,
      shortCount: shorts.length,
      totalLongSize,
      totalShortSize,
      avgLongEntry,
      avgShortEntry,
      longLiqMin: longLiqs.length > 0 ? Math.min(...longLiqs) : 0,
      longLiqMax: longLiqs.length > 0 ? Math.max(...longLiqs) : 0,
      shortLiqMin: shortLiqs.length > 0 ? Math.min(...shortLiqs) : 0,
      shortLiqMax: shortLiqs.length > 0 ? Math.max(...shortLiqs) : 0,
      totalUnrealizedPnl: positions.reduce((s, p) => s + p.unrealizedPnl, 0),
      traderCount: traders.size,
      positions: positions.sort((a, b) => Math.abs(b.positionValue) - Math.abs(a.positionValue)),
    });
  }

  // Sort tickers by total notional
  tickers.sort((a, b) => (b.totalLongSize + b.totalShortSize) - (a.totalLongSize + a.totalShortSize));

  const result: AnalysisData = {
    tickers,
    tradersFetched: posResults.filter((r) => r.status === "fulfilled" && r.value).length,
    fetchedAt: Date.now(),
  };

  cachedData = result;
  cachedAt = Date.now();
  return result;
}

// ─── Loader ────────────────────────────────────────────────

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Ticker Analysis — DeltaScope" },
    { name: "description", content: "Positioning data from Hyperliquid leaderboard traders with liquidation analysis" },
  ];
}

export async function loader({}: Route.LoaderArgs) {
  const analysisPromise = fetchAnalysisData();
  return { analysisPromise };
}

// ─── Navigation ────────────────────────────────────────────

function NavHeader() {
  return (
    <header className="border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur-xl sticky top-0 z-50 relative">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
                <path d="M4 24L12 8L18 18L28 4" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="text-lg font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Delta<span className="text-emerald-400">Scope</span>
            </h1>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) =>
              link.href.startsWith("/") ? (
                <Link
                  key={link.label}
                  to={link.href}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    link.href === "/analysis"
                      ? "text-emerald-400 bg-emerald-500/10"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
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
        <MobileMenu links={NAV_LINKS} activePath="/analysis" />
      </div>
    </header>
  );
}

// ─── Skeleton ──────────────────────────────────────────────

function AnalysisSkeleton() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <NavHeader />
      <main className="max-w-[1440px] mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="border-white/5 bg-[#111111]">
              <CardContent className="pt-6">
                <div className="h-4 w-20 bg-white/5 rounded animate-pulse mb-2" />
                <div className="h-8 w-28 bg-white/5 rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="border-white/5 bg-[#111111]">
          <CardContent className="pt-6 space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-10 bg-white/5 rounded animate-pulse" />
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

// ─── Stat Card ─────────────────────────────────────────────

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="border-white/5 bg-[#111111] shadow-2xl">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
          <span className="text-white/20">{icon}</span>
        </div>
        <p className="text-2xl font-bold tracking-tight font-mono" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Long/Short Bar ────────────────────────────────────────

function LongShortBar({ longSize, shortSize }: { longSize: number; shortSize: number }) {
  const total = longSize + shortSize;
  if (total === 0) return null;
  const longPct = (longSize / total) * 100;
  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-white/5 w-full min-w-[60px]">
      <div className="bg-emerald-500/70 h-full" style={{ width: `${longPct}%` }} />
      <div className="bg-red-500/70 h-full" style={{ width: `${100 - longPct}%` }} />
    </div>
  );
}

// ─── Expanded Row ──────────────────────────────────────────

function TickerDetail({ ticker }: { ticker: TickerAnalysis }) {
  const longs = ticker.positions.filter((p) => p.szi > 0);
  const shorts = ticker.positions.filter((p) => p.szi < 0);

  return (
    <div className="px-4 py-4 bg-white/[0.01] border-t border-white/5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Longs */}
        <div>
          <p className="text-xs text-emerald-400 uppercase tracking-wider mb-2 font-medium">
            Long Positions ({longs.length})
          </p>
          {longs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No long positions</p>
          ) : (
            <div className="space-y-1.5">
              {longs.map((p, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-1 text-xs bg-emerald-500/5 rounded px-2.5 py-1.5 border border-emerald-500/10">
                  <div className="flex items-center gap-2">
                    <span className="text-white/40 font-mono">{p.displayName || truncateAddr(p.trader)}</span>
                    <Badge variant="outline" className="text-[10px] h-4 border-emerald-500/30 text-emerald-400">
                      {p.leverage}x
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-4 font-mono">
                    <span className="text-muted-foreground">Entry {formatPrice(p.entryPx)}</span>
                    <span className="text-muted-foreground">Size {formatUSD(p.positionValue)}</span>
                    {p.liquidationPx && p.liquidationPx > 0 && isFinite(p.liquidationPx) && (
                      <span className="text-red-400">Liq {formatPrice(p.liquidationPx)}</span>
                    )}
                    <span className={p.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {p.unrealizedPnl >= 0 ? "+" : ""}{formatUSD(p.unrealizedPnl)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Shorts */}
        <div>
          <p className="text-xs text-red-400 uppercase tracking-wider mb-2 font-medium">
            Short Positions ({shorts.length})
          </p>
          {shorts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No short positions</p>
          ) : (
            <div className="space-y-1.5">
              {shorts.map((p, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-1 text-xs bg-red-500/5 rounded px-2.5 py-1.5 border border-red-500/10">
                  <div className="flex items-center gap-2">
                    <span className="text-white/40 font-mono">{p.displayName || truncateAddr(p.trader)}</span>
                    <Badge variant="outline" className="text-[10px] h-4 border-red-500/30 text-red-400">
                      {p.leverage}x
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-4 font-mono">
                    <span className="text-muted-foreground">Entry {formatPrice(p.entryPx)}</span>
                    <span className="text-muted-foreground">Size {formatUSD(p.positionValue)}</span>
                    {p.liquidationPx && p.liquidationPx > 0 && isFinite(p.liquidationPx) && p.liquidationPx < p.entryPx * 20 && (
                      <span className="text-red-400">Liq {formatPrice(p.liquidationPx)}</span>
                    )}
                    <span className={p.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {p.unrealizedPnl >= 0 ? "+" : ""}{formatUSD(p.unrealizedPnl)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Analysis Content ─────────────────────────────────

function AnalysisContent({ data }: { data: AnalysisData }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"size" | "traders" | "pnl">("size");

  const sorted = useMemo(() => {
    const arr = [...data.tickers];
    if (sortBy === "size") arr.sort((a, b) => (b.totalLongSize + b.totalShortSize) - (a.totalLongSize + a.totalShortSize));
    else if (sortBy === "traders") arr.sort((a, b) => b.traderCount - a.traderCount);
    else if (sortBy === "pnl") arr.sort((a, b) => Math.abs(b.totalUnrealizedPnl) - Math.abs(a.totalUnrealizedPnl));
    return arr;
  }, [data.tickers, sortBy]);

  const totalPositions = data.tickers.reduce((s, t) => s + t.longCount + t.shortCount, 0);
  const totalLongs = data.tickers.reduce((s, t) => s + t.longCount, 0);
  const netLongPct = totalPositions > 0 ? ((totalLongs / totalPositions) * 100).toFixed(1) : "0";

  return (
    <>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Traders Analyzed"
          value={`${data.tradersFetched}`}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          }
        />
        <StatCard
          label="Active Tickers"
          value={`${data.tickers.length}`}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
            </svg>
          }
        />
        <StatCard
          label="Net Long Bias"
          value={`${netLongPct}%`}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
            </svg>
          }
        />
        <StatCard
          label="Last Updated"
          value={timeAgo(data.fetchedAt)}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Main Table */}
      <Card className="border-white/5 bg-[#111111] shadow-2xl">
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                Ticker Analysis
              </CardTitle>
              <CardDescription>
                Top {data.tradersFetched} leaderboard traders — {totalPositions} open positions across {data.tickers.length} tickers
              </CardDescription>
            </div>
            <div className="flex gap-1">
              {(["size", "traders", "pnl"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    sortBy === s
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-white/5 text-muted-foreground hover:bg-white/10 border border-transparent"
                  }`}
                >
                  {s === "size" ? "By Size" : s === "traders" ? "By Traders" : "By PnL"}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/5 hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">Coin</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground text-center">Longs</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground text-center">Shorts</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground text-right">Long Size</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground text-right">Short Size</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground w-[100px]">L/S Ratio</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground text-right">Avg Long Entry</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground text-right">Avg Short Entry</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground text-right">Unrealized PnL</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground text-center">Traders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((ticker) => (
                <React.Fragment key={ticker.coin}>
                  <TableRow
                    className="border-white/5 cursor-pointer hover:bg-white/[0.02] transition-colors"
                    onClick={() => setExpanded(expanded === ticker.coin ? null : ticker.coin)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{expanded === ticker.coin ? "▾" : "▸"}</span>
                        <span className="font-semibold" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                          {ticker.coin}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-xs">
                        {ticker.longCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="border-red-500/30 text-red-400 text-xs">
                        {ticker.shortCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-emerald-400/80">
                      {formatUSD(ticker.totalLongSize)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-red-400/80">
                      {formatUSD(ticker.totalShortSize)}
                    </TableCell>
                    <TableCell>
                      <LongShortBar longSize={ticker.totalLongSize} shortSize={ticker.totalShortSize} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {ticker.avgLongEntry > 0 ? formatPrice(ticker.avgLongEntry) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {ticker.avgShortEntry > 0 ? formatPrice(ticker.avgShortEntry) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      <span className={ticker.totalUnrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {ticker.totalUnrealizedPnl >= 0 ? "+" : ""}{formatUSD(ticker.totalUnrealizedPnl)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs text-muted-foreground">
                      {ticker.traderCount}/{data.tradersFetched}
                    </TableCell>
                  </TableRow>
                  {expanded === ticker.coin && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={10} className="p-0">
                        <TickerDetail ticker={ticker} />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ─── Suspense Wrapper ──────────────────────────────────────

function AnalysisLoader({ promise }: { promise: Promise<AnalysisData> }) {
  const data = React.use(promise);
  return <AnalysisContent data={data} />;
}

// ─── Page Component ────────────────────────────────────────

export default function AnalysisPage({ loaderData }: Route.ComponentProps) {
  const { analysisPromise } = loaderData;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#0a0a0a] text-white">
        <NavHeader />
        <main className="max-w-[1440px] mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">
          <React.Suspense fallback={
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <Card key={i} className="border-white/5 bg-[#111111]">
                    <CardContent className="pt-6">
                      <div className="h-4 w-20 bg-white/5 rounded animate-pulse mb-2" />
                      <div className="h-8 w-28 bg-white/5 rounded animate-pulse" />
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Card className="border-white/5 bg-[#111111]">
                <CardHeader>
                  <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                    Loading Ticker Analysis...
                  </CardTitle>
                  <CardDescription>
                    Fetching positions from top Hyperliquid leaderboard traders
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="h-10 bg-white/5 rounded animate-pulse" />
                  ))}
                </CardContent>
              </Card>
            </div>
          }>
            <AnalysisLoader promise={analysisPromise} />
          </React.Suspense>
        </main>

        {/* Footer */}
        <footer className="border-t border-white/5 mt-12">
          <div className="max-w-[1440px] mx-auto px-6 py-4 flex flex-col items-center gap-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between w-full">
              <p>
                Data sourced from{" "}
                <a href="https://hyperliquid.xyz" target="_blank" rel="noopener noreferrer" className="text-emerald-400/60 hover:text-emerald-400">
                  Hyperliquid
                </a>{" "}
                leaderboard
              </p>
              <p>Top {TOP_N_TRADERS} traders by account value</p>
            </div>
            <p className="text-emerald-400/80 font-medium" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Best Regard @0xPilotSB, All Hail Retard
            </p>
          </div>
        </footer>
        <OracleChatPopup />
      </div>
    </TooltipProvider>
  );
}

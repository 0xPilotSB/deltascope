import { useState, useEffect, useCallback } from "react";
import * as React from "react";
import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { MobileMenu } from "~/components/mobile-nav";

// ─── Types ──────────────────────────────────────────────────

interface Session {
  label: string;
  start: number; // minutes from midnight UTC
  end: number;   // minutes from midnight UTC (can exceed 1440 for overnight)
  type: "regular" | "extended" | "auction" | "crypto";
}

interface Exchange {
  id: string;
  name: string;
  shortName: string;
  region: "americas" | "europe" | "asia" | "crypto";
  category: "equities" | "futures" | "crypto" | "fx" | "commodities";
  sessions: Session[];
  timezone: string;
  utcOffset: number; // hours offset from UTC
  color: string;
  relevance: "high" | "medium" | "low"; // relevance to crypto traders
}

// ─── Constants ──────────────────────────────────────────────

const NAV_LINKS = [
  { label: "Ticker Analysis", href: "/analysis" },
  { label: "Predict & Win", href: "/predict" },
  { label: "Latency Monitor", href: "/latency" },
  { label: "Market Hours", href: "/market-hours" },
  { label: "Developers", href: "/developers" },
  { label: "Community", href: "https://discord.gg/pyth", external: true },
];

// All times in UTC minutes from midnight
const EXCHANGES: Exchange[] = [
  // ── Crypto (24/7) ──
  {
    id: "binance", name: "Binance", shortName: "BNCE", region: "crypto", category: "crypto",
    sessions: [{ label: "Spot", start: 0, end: 1440, type: "crypto" }],
    timezone: "UTC", utcOffset: 0, color: "#f0b90b", relevance: "high",
  },
  {
    id: "hyperliquid", name: "Hyperliquid", shortName: "HL", region: "crypto", category: "crypto",
    sessions: [{ label: "Perps", start: 0, end: 1440, type: "crypto" }],
    timezone: "UTC", utcOffset: 0, color: "#10b981", relevance: "high",
  },
  {
    id: "coinbase", name: "Coinbase", shortName: "CB", region: "crypto", category: "crypto",
    sessions: [{ label: "Spot", start: 0, end: 1440, type: "crypto" }],
    timezone: "UTC", utcOffset: 0, color: "#0052ff", relevance: "high",
  },
  // ── Americas ──
  {
    id: "cme-btc", name: "CME Bitcoin Futures", shortName: "CME BTC", region: "americas", category: "futures",
    sessions: [
      { label: "Extended", start: 360, end: 360 + 60, type: "extended" }, // Sun 6pm-7pm CT = Mon 0:00-1:00 UTC
      { label: "Regular", start: 360, end: 360 + 1260, type: "regular" }, // Mon-Fri 6pm CT-5pm CT next day
    ],
    timezone: "America/Chicago", utcOffset: -5, color: "#6366f1", relevance: "high",
  },
  {
    id: "nyse", name: "NYSE", shortName: "NYSE", region: "americas", category: "equities",
    sessions: [
      { label: "Pre-market", start: 9 * 60, end: 14 * 60 + 30, type: "extended" },
      { label: "Regular", start: 14 * 60 + 30, end: 21 * 60, type: "regular" },
      { label: "After-hours", start: 21 * 60, end: 24 * 60, type: "extended" },
    ],
    timezone: "America/New_York", utcOffset: -4, color: "#3b82f6", relevance: "high",
  },
  {
    id: "nasdaq", name: "NASDAQ", shortName: "NSDQ", region: "americas", category: "equities",
    sessions: [
      { label: "Pre-market", start: 9 * 60, end: 14 * 60 + 30, type: "extended" },
      { label: "Regular", start: 14 * 60 + 30, end: 21 * 60, type: "regular" },
      { label: "After-hours", start: 21 * 60, end: 24 * 60, type: "extended" },
    ],
    timezone: "America/New_York", utcOffset: -4, color: "#06b6d4", relevance: "high",
  },
  {
    id: "cboe", name: "CBOE Options", shortName: "CBOE", region: "americas", category: "futures",
    sessions: [
      { label: "Regular", start: 14 * 60 + 30, end: 21 * 60, type: "regular" },
    ],
    timezone: "America/Chicago", utcOffset: -5, color: "#8b5cf6", relevance: "medium",
  },
  {
    id: "nymex", name: "NYMEX (Oil/Gas)", shortName: "NYMX", region: "americas", category: "commodities",
    sessions: [
      { label: "Electronic", start: 23 * 60, end: 22 * 60 + 1440, type: "extended" },
      { label: "Floor", start: 14 * 60, end: 19 * 60 + 30, type: "regular" },
    ],
    timezone: "America/New_York", utcOffset: -4, color: "#f59e0b", relevance: "medium",
  },
  // ── Europe ──
  {
    id: "lse", name: "London Stock Exchange", shortName: "LSE", region: "europe", category: "equities",
    sessions: [
      { label: "Auction", start: 7 * 60 + 50, end: 8 * 60, type: "auction" },
      { label: "Regular", start: 8 * 60, end: 16 * 60 + 30, type: "regular" },
      { label: "Auction", start: 16 * 60 + 30, end: 16 * 60 + 35, type: "auction" },
    ],
    timezone: "Europe/London", utcOffset: 1, color: "#ef4444", relevance: "high",
  },
  {
    id: "xetra", name: "Deutsche Börse (Xetra)", shortName: "XETR", region: "europe", category: "equities",
    sessions: [
      { label: "Pre-trading", start: 7 * 60 + 30, end: 9 * 60, type: "extended" },
      { label: "Regular", start: 9 * 60, end: 17 * 60 + 30, type: "regular" },
    ],
    timezone: "Europe/Berlin", utcOffset: 2, color: "#f97316", relevance: "medium",
  },
  {
    id: "eurex", name: "Eurex Derivatives", shortName: "EURX", region: "europe", category: "futures",
    sessions: [
      { label: "Regular", start: 7 * 60, end: 22 * 60, type: "regular" },
    ],
    timezone: "Europe/Berlin", utcOffset: 2, color: "#ec4899", relevance: "medium",
  },
  {
    id: "lme", name: "London Metal Exchange", shortName: "LME", region: "europe", category: "commodities",
    sessions: [
      { label: "Ring", start: 11 * 60 + 40, end: 17 * 60, type: "regular" },
      { label: "Electronic", start: 1 * 60, end: 19 * 60, type: "extended" },
    ],
    timezone: "Europe/London", utcOffset: 1, color: "#a78bfa", relevance: "low",
  },
  // ── Asia ──
  {
    id: "tse", name: "Tokyo Stock Exchange", shortName: "TSE", region: "asia", category: "equities",
    sessions: [
      { label: "Morning", start: 0 * 60, end: 2 * 60 + 30, type: "regular" },
      { label: "Afternoon", start: 3 * 60 + 30, end: 6 * 60, type: "regular" },
    ],
    timezone: "Asia/Tokyo", utcOffset: 9, color: "#f43f5e", relevance: "medium",
  },
  {
    id: "hkex", name: "Hong Kong Exchange", shortName: "HKEX", region: "asia", category: "equities",
    sessions: [
      { label: "Morning", start: 1 * 60 + 30, end: 4 * 60, type: "regular" },
      { label: "Afternoon", start: 5 * 60, end: 8 * 60, type: "regular" },
    ],
    timezone: "Asia/Hong_Kong", utcOffset: 8, color: "#fb7185", relevance: "high",
  },
  {
    id: "sse", name: "Shanghai Stock Exchange", shortName: "SSE", region: "asia", category: "equities",
    sessions: [
      { label: "Morning", start: 1 * 60 + 30, end: 3 * 60, type: "regular" },
      { label: "Afternoon", start: 5 * 60, end: 7 * 60, type: "regular" },
    ],
    timezone: "Asia/Shanghai", utcOffset: 8, color: "#fb923c", relevance: "medium",
  },
  {
    id: "sgx", name: "Singapore Exchange", shortName: "SGX", region: "asia", category: "futures",
    sessions: [
      { label: "Regular", start: 1 * 60, end: 9 * 60, type: "regular" },
      { label: "Evening", start: 11 * 60, end: 19 * 60, type: "regular" },
    ],
    timezone: "Asia/Singapore", utcOffset: 8, color: "#34d399", relevance: "medium",
  },
  {
    id: "nse", name: "NSE India", shortName: "NSE", region: "asia", category: "equities",
    sessions: [
      { label: "Pre-open", start: 3 * 60 + 45, end: 4 * 60 + 15, type: "auction" },
      { label: "Regular", start: 4 * 60 + 15, end: 10 * 60, type: "regular" },
    ],
    timezone: "Asia/Kolkata", utcOffset: 5.5, color: "#fbbf24", relevance: "low",
  },
  {
    id: "asx", name: "Australian Securities Exchange", shortName: "ASX", region: "asia", category: "equities",
    sessions: [
      { label: "Pre-open", start: 23 * 60, end: 23 * 60 + 10, type: "auction" },
      { label: "Regular", start: 23 * 60 + 10, end: 5 * 60, type: "regular" },
    ],
    timezone: "Australia/Sydney", utcOffset: 10, color: "#4ade80", relevance: "low",
  },
];

type FilterRegion = "all" | "americas" | "europe" | "asia" | "crypto";
type FilterCategory = "all" | "equities" | "futures" | "crypto" | "commodities";

// ─── Helpers ────────────────────────────────────────────────

function utcNowMinutes(): number {
  const now = new Date();
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

function isSessionActive(session: Session): boolean {
  const now = utcNowMinutes();
  if (session.end <= 1440) {
    return now >= session.start && now < session.end;
  }
  // Overnight: wraps past midnight
  return now >= session.start || now < (session.end - 1440);
}

function isExchangeOpen(exchange: Exchange): boolean {
  return exchange.sessions.some(
    (s) => s.type === "regular" && isSessionActive(s)
  );
}

function isExchangeExtended(exchange: Exchange): boolean {
  if (isExchangeOpen(exchange)) return false;
  return exchange.sessions.some(
    (s) => (s.type === "extended" || s.type === "auction") && isSessionActive(s)
  );
}

function minutesToLabel(minutes: number): string {
  const m = minutes % 1440;
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function getSessionLeft(start: number): string {
  return `${((start % 1440) / 1440) * 100}%`;
}

function getSessionWidth(start: number, end: number): string {
  const s = start % 1440;
  const e = end > 1440 ? 1440 : end;
  return `${((e - s) / 1440) * 100}%`;
}

// ─── Nav ────────────────────────────────────────────────────

function NavHeader() {
  return (
    <header className="border-b border-white/5 bg-[#0a0a0a]/95 backdrop-blur-sm sticky top-0 z-50 will-change-transform">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
                <path d="M4 24L12 8L18 18L28 4" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Delta<span className="text-emerald-400">Scope</span>
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) =>
              link.href.startsWith("/") ? (
                <Link
                  key={link.label}
                  to={link.href}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    link.href === "/market-hours"
                      ? "bg-white/10 text-white"
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
                  className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-white hover:bg-white/5 transition-colors flex items-center gap-1"
                >
                  {link.label}
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M1 9L9 1M9 1H3M9 1V7" />
                  </svg>
                </a>
              )
            )}
          </nav>
        </div>
        <MobileMenu links={NAV_LINKS} activePath="/market-hours" />
      </div>
    </header>
  );
}

// ─── Clock display ───────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const h = String(time.getUTCHours()).padStart(2, "0");
  const m = String(time.getUTCMinutes()).padStart(2, "0");
  const s = String(time.getUTCSeconds()).padStart(2, "0");

  return (
    <div className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      <span>UTC {h}:{m}:{s}</span>
    </div>
  );
}

// ─── Gantt Row ───────────────────────────────────────────────

function GanttRow({ exchange, nowPct }: { exchange: Exchange; nowPct: number }) {
  const open = isExchangeOpen(exchange);
  const extended = isExchangeExtended(exchange);
  const status = open ? "open" : extended ? "extended" : "closed";

  return (
    <div className="flex items-center gap-2 sm:gap-3 group py-1.5 hover:bg-white/[0.02] rounded-lg px-1 transition-colors">
      {/* Exchange name */}
      <div className="w-24 sm:w-36 shrink-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-500 ${
              open ? "bg-emerald-400 shadow-[0_0_6px_#10b981]" :
              extended ? "bg-yellow-400" : "bg-white/20"
            }`}
          />
          <span className={`text-xs font-medium truncate ${open ? "text-white" : "text-white/50"}`}>
            {exchange.shortName}
          </span>
        </div>
      </div>

      {/* Gantt bar */}
      <div className="flex-1 relative h-6 bg-white/[0.03] rounded overflow-hidden">
        {/* Now marker */}
        <div
          className="absolute top-0 bottom-0 w-px bg-emerald-400/70 z-20 transition-all duration-1000"
          style={{ left: `${nowPct}%` }}
        />
        {/* Sessions */}
        {exchange.sessions.map((session, i) => {
          const left = getSessionLeft(session.start);
          const width = getSessionWidth(session.start, session.end);
          const active = isSessionActive(session);
          const baseColor = exchange.color;
          const opacity = session.type === "regular" ? (active ? "ff" : "55") :
                          session.type === "extended" ? (active ? "99" : "33") :
                          (active ? "77" : "22");
          return (
            <div
              key={i}
              className="absolute top-0.5 bottom-0.5 rounded-sm transition-all duration-500"
              style={{
                left,
                width,
                backgroundColor: `${baseColor}${opacity}`,
                boxShadow: active && session.type === "regular" ? `0 0 8px ${baseColor}40` : undefined,
              }}
              title={`${session.label}: ${minutesToLabel(session.start)}–${minutesToLabel(session.end % 1440)} UTC`}
            />
          );
        })}
      </div>

      {/* Status badge */}
      <div className="w-14 sm:w-16 shrink-0 text-right">
        {status === "open" ? (
          <span className="text-[10px] font-semibold text-emerald-400">OPEN</span>
        ) : status === "extended" ? (
          <span className="text-[10px] font-semibold text-yellow-400">EXT</span>
        ) : (
          <span className="text-[10px] text-white/25">CLOSED</span>
        )}
      </div>
    </div>
  );
}

// ─── Time axis ───────────────────────────────────────────────

function TimeAxis() {
  const hours = [0, 4, 8, 12, 16, 20, 24];
  return (
    <div className="flex items-center gap-2 sm:gap-3 py-1 px-1">
      <div className="w-24 sm:w-36 shrink-0" />
      <div className="flex-1 relative flex">
        {hours.map((h) => (
          <div
            key={h}
            className="absolute text-[10px] text-white/25 -translate-x-1/2"
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {h === 24 ? "" : `${String(h).padStart(2, "0")}:00`}
          </div>
        ))}
      </div>
      <div className="w-14 sm:w-16 shrink-0" />
    </div>
  );
}

// ─── Summary Stats ───────────────────────────────────────────

function OpenCount() {
  const [counts, setCounts] = useState({ open: 0, extended: 0, closed: 0 });

  useEffect(() => {
    function update() {
      let open = 0, extended = 0, closed = 0;
      for (const ex of EXCHANGES) {
        if (isExchangeOpen(ex)) open++;
        else if (isExchangeExtended(ex)) extended++;
        else closed++;
      }
      setCounts({ open, extended, closed });
    }
    update();
    const id = setInterval(update, 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
        <span className="text-xs text-white font-medium">{counts.open} Open</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-yellow-400" />
        <span className="text-xs text-white/60">{counts.extended} Extended</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-white/20" />
        <span className="text-xs text-white/40">{counts.closed} Closed</span>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────

export default function MarketHoursPage() {
  const [region, setRegion] = useState<FilterRegion>("all");
  const [category, setCategory] = useState<FilterCategory>("all");
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [nowPct, setNowPct] = useState(() => (utcNowMinutes() / 1440) * 100);

  // Tick now marker every 10s
  useEffect(() => {
    const id = setInterval(() => {
      setNowPct((utcNowMinutes() / 1440) * 100);
    }, 10000);
    return () => clearInterval(id);
  }, []);

  const filtered = EXCHANGES.filter((ex) => {
    if (region !== "all" && ex.region !== region) return false;
    if (category !== "all" && ex.category !== category) return false;
    if (highlightOpen && !isExchangeOpen(ex) && !isExchangeExtended(ex)) return false;
    return true;
  });

  // Sort: crypto first, then by open status
  const sorted = [...filtered].sort((a, b) => {
    const aOpen = isExchangeOpen(a) ? 2 : isExchangeExtended(a) ? 1 : 0;
    const bOpen = isExchangeOpen(b) ? 2 : isExchangeExtended(b) ? 1 : 0;
    if (a.category === "crypto" && b.category !== "crypto") return -1;
    if (b.category === "crypto" && a.category !== "crypto") return 1;
    return bOpen - aOpen;
  });

  const regionLabels: { value: FilterRegion; label: string }[] = [
    { value: "all", label: "All Regions" },
    { value: "crypto", label: "Crypto" },
    { value: "americas", label: "Americas" },
    { value: "europe", label: "Europe" },
    { value: "asia", label: "Asia" },
  ];

  const categoryLabels: { value: FilterCategory; label: string }[] = [
    { value: "all", label: "All" },
    { value: "crypto", label: "Crypto" },
    { value: "equities", label: "Equities" },
    { value: "futures", label: "Futures" },
    { value: "commodities", label: "Commodities" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <NavHeader />

      <main className="max-w-[1440px] mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Global Market Hours
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Live trading hours across 18 major exchanges · All times UTC · DST-aware
            </p>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-2">
            <LiveClock />
            <OpenCount />
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
          {[
            { label: "Crypto Markets", value: "24/7", color: "text-emerald-400", sub: "Always open" },
            { label: "CME BTC Futures", value: "Mon–Fri", color: "text-indigo-400", sub: "6pm CT daily" },
            { label: "NYSE / NASDAQ", value: "9:30–16:00", color: "text-blue-400", sub: "ET weekdays" },
            { label: "Asia Session", value: "00:00–08:00", color: "text-pink-400", sub: "UTC overlap" },
          ].map((c) => (
            <Card key={c.label} className="border-white/5 bg-[#111111]">
              <CardContent className="p-3 sm:p-4">
                <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider mb-1">{c.label}</p>
                <p className={`text-base sm:text-lg font-bold font-mono ${c.color}`} style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>{c.value}</p>
                <p className="text-[10px] text-white/30 mt-0.5 hidden sm:block">{c.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Gantt Chart */}
        <Card className="border-white/5 bg-[#111111] shadow-2xl">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                  Session Timeline
                </CardTitle>
                <CardDescription>24-hour UTC view · Green line = current time</CardDescription>
              </div>
              {/* Filters */}
              <div className="flex flex-wrap gap-2">
                {/* Region pills */}
                <div className="flex gap-1 flex-wrap">
                  {regionLabels.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => setRegion(r.value)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
                        region === r.value
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-white/5 text-white/50 border border-transparent hover:bg-white/10 hover:text-white/80"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {/* Open only toggle */}
                <button
                  onClick={() => setHighlightOpen((p) => !p)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 border ${
                    highlightOpen
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                      : "bg-white/5 text-white/50 border-transparent hover:bg-white/10"
                  }`}
                >
                  Open only
                </button>
              </div>
            </div>
            {/* Category filters */}
            <div className="flex gap-1 flex-wrap mt-2">
              {categoryLabels.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all duration-200 ${
                    category === c.value
                      ? "bg-white/15 text-white"
                      : "text-white/40 hover:text-white/70"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="pb-6">
            {/* Legend */}
            <div className="flex items-center gap-4 mb-4 px-1 flex-wrap">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-3 rounded-sm bg-emerald-400/80" />
                <span className="text-[11px] text-white/50">Regular</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-3 rounded-sm bg-emerald-400/30" />
                <span className="text-[11px] text-white/50">Extended / Pre-open</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-px h-4 bg-emerald-400/70" />
                <span className="text-[11px] text-white/50">Now (UTC)</span>
              </div>
            </div>

            {/* Time axis */}
            <div className="relative mb-1">
              <TimeAxis />
            </div>
            <div className="w-full h-px bg-white/5 mb-2 ml-[calc(6rem+0.5rem)] sm:ml-[calc(9rem+0.75rem)]" />

            {/* Rows */}
            <div className="space-y-0.5">
              {sorted.length === 0 ? (
                <div className="text-center py-8 text-white/30 text-sm">No exchanges match filter</div>
              ) : (
                sorted.map((ex) => (
                  <GanttRow key={ex.id} exchange={ex} nowPct={nowPct} />
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Session Overlap Analysis */}
        <Card className="border-white/5 bg-[#111111] shadow-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Key Session Overlaps
            </CardTitle>
            <CardDescription>High-liquidity windows relevant to crypto traders</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                {
                  name: "Asia Open",
                  utc: "00:00 – 03:00",
                  markets: ["TSE", "HKEX", "SSE"],
                  color: "text-pink-400",
                  dot: "bg-pink-400",
                  desc: "JPY + HKD + CNY flow. BTC often moves on APAC open.",
                },
                {
                  name: "London Open",
                  utc: "08:00 – 09:30",
                  markets: ["LSE", "Eurex", "LME"],
                  color: "text-red-400",
                  dot: "bg-red-400",
                  desc: "EUR/GBP liquidity. Large institutional orders enter market.",
                },
                {
                  name: "Asia–Europe Overlap",
                  utc: "08:00 – 09:00",
                  markets: ["HKEX", "LSE", "Xetra"],
                  color: "text-orange-400",
                  dot: "bg-orange-400",
                  desc: "Peak cross-regional FX volume. Macro headlines hit hardest.",
                },
                {
                  name: "NY Open (Power Hour)",
                  utc: "14:30 – 16:00",
                  markets: ["NYSE", "NASDAQ", "CME"],
                  color: "text-blue-400",
                  dot: "bg-blue-400",
                  desc: "Highest global equity + BTC futures volume. Strongest crypto moves.",
                },
                {
                  name: "London–NY Overlap",
                  utc: "14:30 – 16:30",
                  markets: ["LSE", "NYSE", "CME"],
                  color: "text-indigo-400",
                  dot: "bg-indigo-400",
                  desc: "Maximum global liquidity. BTC/ETH spreads tightest here.",
                },
                {
                  name: "CME Close",
                  utc: "22:00 – 23:00",
                  markets: ["CME BTC", "CBOE"],
                  color: "text-purple-400",
                  dot: "bg-purple-400",
                  desc: "BTC futures settlement. Often coincides with short-term price action.",
                },
              ].map((overlap) => (
                <div
                  key={overlap.name}
                  className="p-3 sm:p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 hover:bg-white/[0.05] transition-all duration-200"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2 h-2 rounded-full ${overlap.dot}`} />
                    <span className={`text-sm font-semibold ${overlap.color}`}>{overlap.name}</span>
                  </div>
                  <p className="font-mono text-base font-bold text-white mb-1">{overlap.utc} UTC</p>
                  <div className="flex gap-1 flex-wrap mb-2">
                    {overlap.markets.map((m) => (
                      <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50">{m}</span>
                    ))}
                  </div>
                  <p className="text-[11px] text-white/40 leading-relaxed">{overlap.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Exchange Reference Table */}
        <Card className="border-white/5 bg-[#111111] shadow-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Exchange Reference
            </CardTitle>
            <CardDescription>Local open/close times with UTC equivalent</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-4 sm:px-6 py-3 text-[11px] uppercase tracking-wider text-white/40 font-medium sticky left-0 bg-[#111111]">Exchange</th>
                    <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-white/40 font-medium">Type</th>
                    <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-white/40 font-medium">Timezone</th>
                    <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-white/40 font-medium">Hours (UTC)</th>
                    <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-white/40 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {EXCHANGES.map((ex) => {
                    const open = isExchangeOpen(ex);
                    const ext = isExchangeExtended(ex);
                    const mainSession = ex.sessions.find((s) => s.type === "regular" || s.type === "crypto");
                    return (
                      <tr key={ex.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 sm:px-6 py-3 sticky left-0 bg-[#111111]">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ex.color }} />
                            <span className="font-medium text-white text-xs sm:text-sm">{ex.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-white/50 capitalize">{ex.category}</span>
                        </td>
                        <td className="px-3 py-3 text-xs text-white/40 font-mono whitespace-nowrap">{ex.timezone}</td>
                        <td className="px-3 py-3 text-xs font-mono text-white/60 whitespace-nowrap">
                          {mainSession
                            ? `${minutesToLabel(mainSession.start)}–${minutesToLabel(mainSession.end % 1440)}`
                            : "—"}
                        </td>
                        <td className="px-3 py-3">
                          {open ? (
                            <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_#10b981]" />
                              Open
                            </span>
                          ) : ext ? (
                            <span className="flex items-center gap-1 text-yellow-400 text-xs font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                              Extended
                            </span>
                          ) : (
                            <span className="text-white/25 text-xs">Closed</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-white/20 pb-4">
          Times approximate. DST transitions adjust automatically. Crypto 24/7. Holidays not included.
        </p>
      </main>
    </div>
  );
}

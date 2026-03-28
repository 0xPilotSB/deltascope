/**
 * Developers — Resources, API docs, and data sources for DeltaScope.
 */
import { Link } from "react-router";
import type { Route } from "./+types/developers";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
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
    { title: "Developers — DeltaScope" },
    { name: "description", content: "Developer resources, API endpoints, data sources, and RPC providers for DeltaScope" },
  ];
}

// ─── Data ─────────────────────────────────────────────────

const SOURCES = [
  {
    name: "HypeRPC — Hyperliquid Premier RPC",
    url: "https://hyperpc.app/",
    description: "Ultra-low latency RPC with Tokyo sentry-peered bare metal nodes. Sub-500μs validator access. Free tier available.",
    tags: ["RPC", "Tokyo", "Low Latency"],
  },
  {
    name: "Hyperliquid RPC Providers 2026 — CompareNodes",
    url: "https://www.comparenodes.com/protocols/hyperliquid/",
    description: "Compare 11+ Hyperliquid RPC providers side by side. Includes latency benchmarks via MilliNet browser tool.",
    tags: ["Directory", "Benchmarks"],
  },
  {
    name: "Pyth Hermes Providers — Developer Hub",
    url: "https://docs.pyth.network/price-feeds/core/api-instances-and-providers/hermes",
    description: "Official Pyth documentation for Hermes RPC providers. Lists Triton, P2P, Liquify, and public endpoint rate limits.",
    tags: ["Oracle", "Hermes", "Docs"],
  },
  {
    name: "Chainstack — Top HL RPC Providers",
    url: "https://chainstack.com/top-hyperliquid-rpc-providers-for-2026/",
    description: "Detailed comparison of Hyperliquid RPC providers with private HyperEVM and HyperCore access options.",
    tags: ["RPC", "HyperEVM", "Guide"],
  },
  {
    name: "Dwellir — Hyperliquid Endpoints",
    url: "https://www.dwellir.com/networks/hyperliquid",
    description: "Dedicated cluster infrastructure with co-located compute. Run your code next to the node for ultra-low latency.",
    tags: ["Dedicated", "Co-located"],
  },
];

const API_ENDPOINTS = [
  {
    method: "GET",
    path: "/api/prices",
    description: "Current prices, funding rates, open interest, and volume for all tracked assets",
  },
  {
    method: "GET",
    path: "/api/latency",
    description: "Latency history (120 samples, 10 min window) and current latency metrics",
  },
  {
    method: "GET",
    path: "/api/orderbook",
    description: "Live orderbook depth data for the selected asset",
  },
  {
    method: "GET",
    path: "/api/funding",
    description: "Funding rate data across all perpetual contracts",
  },
  {
    method: "WS",
    path: "/ws",
    description: "Real-time WebSocket stream — prices, orderbook updates, and latency metrics",
  },
];

const DATA_SOURCES = [
  {
    name: "Pyth Network",
    type: "Oracle",
    description: "Real-time price feeds via Hermes API. Sub-second publish times with confidence intervals.",
    endpoint: "hermes.pyth.network",
    docs: "https://docs.pyth.network/",
  },
  {
    name: "Hyperliquid",
    type: "DEX",
    description: "Perpetual futures exchange data — mid prices, funding rates, open interest, volume, and orderbook.",
    endpoint: "api.hyperliquid.xyz",
    docs: "https://hyperliquid.gitbook.io/hyperliquid-docs/",
  },
  {
    name: "Hyperliquid WS",
    type: "WebSocket",
    description: "Real-time mid-price stream via allMids subscription for instant price updates.",
    endpoint: "api.hyperliquid.xyz/ws",
    docs: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket",
  },
];

// ─── Component ────────────────────────────────────────────

export default function Developers() {
  return (
    <main className="min-h-screen bg-[#0a0e14] text-white">
      {/* NavHeader */}
      <header className="sticky top-0 z-50 bg-[#0a0e14]/80 backdrop-blur-xl border-b border-white/5 relative">
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
                      link.href === "/developers"
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
          <MobileMenu links={NAV_LINKS} activePath="/developers" />
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Title */}
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
            Developers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            API endpoints, data sources, and infrastructure references for DeltaScope
          </p>
        </div>

        {/* DeltaScope API Endpoints */}
        <Card className="border-white/5 bg-[#111111] shadow-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              DeltaScope API
            </CardTitle>
            <CardDescription>
              Public endpoints served from Cloudflare Edge — no auth required
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left py-2.5 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Method</th>
                    <th className="text-left py-2.5 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Endpoint</th>
                    <th className="text-left py-2.5 px-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {API_ENDPOINTS.map((ep) => (
                    <tr key={ep.path} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-3">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-mono ${
                            ep.method === "GET"
                              ? "text-emerald-400 border-emerald-400/30"
                              : ep.method === "WS"
                              ? "text-purple-400 border-purple-400/30"
                              : "text-blue-400 border-blue-400/30"
                          }`}
                        >
                          {ep.method}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-white">{ep.path}</td>
                      <td className="py-3 px-3 text-xs text-muted-foreground">{ep.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Upstream Data Sources */}
        <Card className="border-white/5 bg-[#111111] shadow-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Data Sources
            </CardTitle>
            <CardDescription>
              Upstream feeds powering DeltaScope's real-time analytics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {DATA_SOURCES.map((src) => (
                <div key={src.name} className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-sm text-white">{src.name}</span>
                    <Badge variant="outline" className="text-[9px] text-muted-foreground border-white/10 px-1.5 py-0">
                      {src.type}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">{src.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-white/40">{src.endpoint}</span>
                    <a
                      href={src.docs}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-emerald-400/70 hover:text-emerald-400 transition-colors"
                    >
                      Docs ↗
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Sources / References */}
        <Card className="border-white/5 bg-[#111111] shadow-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Sources
            </CardTitle>
            <CardDescription>
              RPC providers, infrastructure references, and documentation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {SOURCES.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg bg-white/[0.02] border border-white/5 p-4 hover:bg-white/[0.04] hover:border-white/10 transition-all group"
                >
                  <div className="flex items-start justify-between gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm text-emerald-400 group-hover:text-emerald-300 transition-colors">
                          {source.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{source.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 shrink-0">
                      {source.tags.map((tag) => (
                        <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Compatible Resources */}
        <Card className="border-white/5 bg-[#111111]">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Compatible Resources
            </CardTitle>
            <p className="text-xs text-muted-foreground">Tools, SDKs, and infrastructure for building on Hyperliquid + Pyth</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* SDKs & Libraries */}
              <div>
                <h4 className="text-xs font-medium text-emerald-400 uppercase tracking-wider mb-3">SDKs & Libraries</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {[
                    { name: "Hyperliquid Python SDK", desc: "Official Python SDK for trading, order management, and market data", url: "https://github.com/hyperliquid-dex/hyperliquid-python-sdk", tag: "Python" },
                    { name: "Hyperliquid TypeScript SDK", desc: "Community TS/JS SDK with full API coverage and WebSocket support", url: "https://github.com/nomeida/hyperliquid", tag: "TypeScript" },
                    { name: "Hyperliquid Rust SDK", desc: "High-performance Rust client for low-latency trading bots", url: "https://github.com/hyperliquid-dex/hyperliquid-rust-sdk", tag: "Rust" },
                    { name: "Pyth SDK (JS/TS)", desc: "Official Pyth client for fetching oracle prices from Hermes", url: "https://github.com/pyth-network/pyth-crosschain", tag: "TypeScript" },
                    { name: "Pyth Agent", desc: "Run your own Pyth price publisher for HIP-3 oracle updates", url: "https://github.com/pyth-network/pyth-agent", tag: "Rust" },
                    { name: "CCXT (Hyperliquid)", desc: "Unified exchange API — Hyperliquid supported as a CCXT exchange", url: "https://github.com/ccxt/ccxt", tag: "Multi-lang" },
                  ].map((item) => (
                    <a key={item.name} href={item.url} target="_blank" rel="noopener noreferrer"
                      className="rounded-lg bg-white/[0.02] border border-white/5 p-3 hover:bg-white/[0.04] hover:border-white/10 transition-colors group">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-white text-xs group-hover:text-emerald-400 transition-colors">{item.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{item.tag}</span>
                      </div>
                      <p className="text-xs sm:text-[10px] text-muted-foreground leading-relaxed sm:leading-normal">{item.desc}</p>
                    </a>
                  ))}
                </div>
              </div>

              {/* RPC & Infrastructure */}
              <div>
                <h4 className="text-xs font-medium text-blue-400 uppercase tracking-wider mb-3">RPC & Infrastructure</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {[
                    { name: "HypeRPC", desc: "Tokyo sentry-peered bare metal RPC — <500μs latency, free tier", url: "https://hyperpc.io", tag: "RPC" },
                    { name: "Chainstack", desc: "Managed Hyperliquid EVM RPC nodes with global PoPs", url: "https://chainstack.com/build-better-with-hyperliquid-evm/", tag: "RPC" },
                    { name: "Dwellir", desc: "Hyperliquid API endpoints — EU and Asia regions available", url: "https://dwellir.com", tag: "RPC" },
                    { name: "Pyth Hermes", desc: "Free real-time oracle price service — WebSocket & REST", url: "https://hermes.pyth.network", tag: "Oracle" },
                    { name: "Pyth Hermes (Beta)", desc: "Beta Hermes endpoint for testing latest features", url: "https://hermes-beta.pyth.network", tag: "Oracle" },
                    { name: "Pyth Lazer (Pro)", desc: "Ultra-low-latency 1-50ms oracle feeds via WebSocket", url: "https://docs.pyth.network/lazer", tag: "Oracle Pro" },
                  ].map((item) => (
                    <a key={item.name} href={item.url} target="_blank" rel="noopener noreferrer"
                      className="rounded-lg bg-white/[0.02] border border-white/5 p-3 hover:bg-white/[0.04] hover:border-white/10 transition-colors group">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-white text-xs group-hover:text-blue-400 transition-colors">{item.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{item.tag}</span>
                      </div>
                      <p className="text-xs sm:text-[10px] text-muted-foreground leading-relaxed sm:leading-normal">{item.desc}</p>
                    </a>
                  ))}
                </div>
              </div>

              {/* Data & Analytics */}
              <div>
                <h4 className="text-xs font-medium text-amber-400 uppercase tracking-wider mb-3">Data & Analytics</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {[
                    { name: "Hyperliquid Stats", desc: "Official dashboard — volume, OI, TVL, user growth metrics", url: "https://stats.hyperliquid.xyz", tag: "Analytics" },
                    { name: "HyperDash", desc: "Community analytics dashboard for Hyperliquid perps and spot", url: "https://hyperdash.info", tag: "Dashboard" },
                    { name: "Pyth Price Feeds", desc: "Browse all 500+ oracle price feeds with real-time data", url: "https://pyth.network/price-feeds", tag: "Oracle Data" },
                    { name: "HyperLatency", desc: "Glassnode — infrastructure latency monitoring for HL validators", url: "https://hyperlatency.glassnode.com", tag: "Monitoring" },
                    { name: "CompareNodes", desc: "Compare Hyperliquid RPC providers by latency and uptime", url: "https://comparenodes.com/hyperliquid/", tag: "Comparison" },
                    { name: "Nansen (Hyperliquid)", desc: "On-chain analytics and wallet tracking for Hyperliquid", url: "https://nansen.ai", tag: "Analytics" },
                  ].map((item) => (
                    <a key={item.name} href={item.url} target="_blank" rel="noopener noreferrer"
                      className="rounded-lg bg-white/[0.02] border border-white/5 p-3 hover:bg-white/[0.04] hover:border-white/10 transition-colors group">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-white text-xs group-hover:text-amber-400 transition-colors">{item.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{item.tag}</span>
                      </div>
                      <p className="text-xs sm:text-[10px] text-muted-foreground leading-relaxed sm:leading-normal">{item.desc}</p>
                    </a>
                  ))}
                </div>
              </div>

              {/* Trading & Bots */}
              <div>
                <h4 className="text-xs font-medium text-purple-400 uppercase tracking-wider mb-3">Trading & Bot Frameworks</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {[
                    { name: "Hummingbot", desc: "Open-source market making bot with Hyperliquid connector", url: "https://hummingbot.org", tag: "Market Making" },
                    { name: "Freqtrade", desc: "Crypto trading bot framework — HL support via CCXT", url: "https://www.freqtrade.io", tag: "Bot Framework" },
                    { name: "TradingView (Lightweight)", desc: "Free charting library used by DeltaScope — v5 with custom plugins", url: "https://tradingview.github.io/lightweight-charts/", tag: "Charts" },
                    { name: "Viem + Hyperliquid EVM", desc: "TypeScript library for interacting with HL EVM L1", url: "https://viem.sh", tag: "EVM" },
                  ].map((item) => (
                    <a key={item.name} href={item.url} target="_blank" rel="noopener noreferrer"
                      className="rounded-lg bg-white/[0.02] border border-white/5 p-3 hover:bg-white/[0.04] hover:border-white/10 transition-colors group">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-white text-xs group-hover:text-purple-400 transition-colors">{item.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{item.tag}</span>
                      </div>
                      <p className="text-xs sm:text-[10px] text-muted-foreground leading-relaxed sm:leading-normal">{item.desc}</p>
                    </a>
                  ))}
                </div>
              </div>

              {/* Documentation */}
              <div>
                <h4 className="text-xs font-medium text-rose-400 uppercase tracking-wider mb-3">Documentation</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {[
                    { name: "Hyperliquid Docs", desc: "Official docs — API reference, trading, HIP proposals, EVM", url: "https://hyperliquid.gitbook.io/hyperliquid-docs", tag: "Docs" },
                    { name: "HIP-3 Specification", desc: "Builder-deployed perpetuals — stake requirements, fee structure, oracle setup", url: "https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals/hip-3", tag: "HIP" },
                    { name: "Pyth Developer Hub", desc: "Full Pyth documentation — Hermes, Lazer, price feed IDs, SDKs", url: "https://docs.pyth.network", tag: "Docs" },
                    { name: "Pyth HIP-3 as a Service", desc: "Managed oracle pusher for HIP-3 deployers — contact Pyth team", url: "https://docs.pyth.network/home/pyth-for-hyperliquid", tag: "HIP-3" },
                    { name: "Hyperliquid API Reference", desc: "Complete REST & WebSocket API — info, exchange, subscriptions", url: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api", tag: "API" },
                    { name: "Hyperliquid WebSocket Events", desc: "All subscription types — allMids, l2Book, trades, orderUpdates", url: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket", tag: "WebSocket" },
                  ].map((item) => (
                    <a key={item.name} href={item.url} target="_blank" rel="noopener noreferrer"
                      className="rounded-lg bg-white/[0.02] border border-white/5 p-3 hover:bg-white/[0.04] hover:border-white/10 transition-colors group">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-white text-xs group-hover:text-rose-400 transition-colors">{item.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{item.tag}</span>
                      </div>
                      <p className="text-xs sm:text-[10px] text-muted-foreground leading-relaxed sm:leading-normal">{item.desc}</p>
                    </a>
                  ))}
                </div>
              </div>
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

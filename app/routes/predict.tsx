import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useFetcher, useRevalidator } from "react-router";
import type { Route } from "./+types/predict";
import { MobileMenu } from "~/components/mobile-nav";
import { OracleChatPopup } from "~/components/oracle-chat";
import { usePriceStore } from "~/stores/price-store";
import { PlacePredictionSchema, SetDisplayNameSchema } from "~/schemas/prediction";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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

const ASSETS = ["BTC", "ETH", "SOL", "HYPE", "ARB", "DOGE", "AVAX", "LINK"];
const DURATIONS = [
  { value: 60, label: "1 min" },
  { value: 300, label: "5 min" },
];
const WAGERS = [10, 25, 50, 100];

const NAV_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Ticker Analysis", href: "/analysis" },
  { label: "Predict & Win", href: "/predict" },
  { label: "Latency Monitor", href: "/latency" },
  { label: "Developers", href: "/developers" },
];

// ─── Formatting ────────────────────────────────────────────

function formatPrice(value: number): string {
  if (value >= 1000) return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

// ─── Meta ──────────────────────────────────────────────────

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Predict & Win — DeltaScope" },
    { name: "description", content: "Predict crypto price movements and compete on the leaderboard. Paper trading with live Pyth + Hyperliquid prices." },
  ];
}

// ─── Loader ────────────────────────────────────────────────

export async function loader({ context }: Route.LoaderArgs) {
  const ownerId = context.cloudflare.ownerId;
  const id = context.cloudflare.env.PREDICTION_GAME.idFromName("global");
  const stub = context.cloudflare.env.PREDICTION_GAME.get(id);

  const [user, active, history, leaderboard] = await Promise.all([
    stub.ensureUser(ownerId),
    stub.getActivePredictions(ownerId),
    stub.getUserHistory(ownerId, 10),
    stub.getLeaderboard(20),
  ]);

  return { user, active, history, leaderboard, ownerId };
}

// ─── Action ────────────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const ownerId = context.cloudflare.ownerId;
  const id = context.cloudflare.env.PREDICTION_GAME.idFromName("global");
  const stub = context.cloudflare.env.PREDICTION_GAME.get(id);

  if (intent === "predict") {
    const parsed = PlacePredictionSchema.safeParse({
      asset: formData.get("asset"),
      direction: formData.get("direction"),
      duration: formData.get("duration"),
      wager: formData.get("wager"),
    });
    if (!parsed.success) return { error: "Invalid prediction data" };
    const result = await stub.placePrediction(
      ownerId,
      parsed.data.asset,
      parsed.data.direction,
      parsed.data.duration,
      parsed.data.wager
    );
    return result;
  }

  if (intent === "set-name") {
    const parsed = SetDisplayNameSchema.safeParse({
      displayName: formData.get("displayName"),
    });
    if (!parsed.success) return { error: "Invalid name" };
    await stub.setDisplayName(ownerId, parsed.data.displayName);
    return { ok: true };
  }

  if (intent === "reset") {
    await stub.resetPoints(ownerId);
    return { ok: true };
  }

  return { error: "Unknown intent" };
}

// ─── NavHeader ─────────────────────────────────────────────

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
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.href}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  link.href === "/predict"
                    ? "text-emerald-400 bg-emerald-500/10"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <MobileMenu links={NAV_LINKS} activePath="/predict" />
      </div>
    </header>
  );
}

// ─── Countdown Timer ───────────────────────────────────────

function Countdown({ targetTime }: { targetTime: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, targetTime - Date.now()));

  useEffect(() => {
    const timer = setInterval(() => {
      const r = Math.max(0, targetTime - Date.now());
      setRemaining(r);
      if (r <= 0) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [targetTime]);

  const secs = Math.ceil(remaining / 1000);
  const mins = Math.floor(secs / 60);
  const s = secs % 60;

  if (remaining <= 0) return <span className="text-yellow-400 text-xs font-medium">Settling...</span>;

  return (
    <span className={`text-xs font-mono ${secs <= 10 ? "text-red-400" : "text-white/60"}`}>
      {mins}:{s.toString().padStart(2, "0")}
    </span>
  );
}

// ─── Main Component ────────────────────────────────────────

export default function PredictPage({ loaderData }: Route.ComponentProps) {
  const { user, active, history, leaderboard } = loaderData;

  const [selectedAsset, setSelectedAsset] = useState("BTC");
  const [selectedDuration, setSelectedDuration] = useState(60);
  const [selectedWager, setSelectedWager] = useState(10);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(user.display_name);

  const fetcher = useFetcher();
  const nameFetcher = useFetcher();
  const resetFetcher = useFetcher();
  const revalidator = useRevalidator();

  const isSubmitting = fetcher.state !== "idle";
  const actionError = (fetcher.data as any)?.error;

  // Connect to live price store
  const { data: priceData, connect, disconnect } = usePriceStore();

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Auto-revalidate every 15s to pick up settled predictions
  // (settlement happens via DO alarm, no need for aggressive polling)
  useEffect(() => {
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 15000);
    return () => clearInterval(timer);
  }, [revalidator]);

  // Get live price for selected asset
  const livePrice = useMemo(() => {
    if (!priceData?.assets) return null;
    const asset = priceData.assets.find((a: any) => a.symbol === selectedAsset);
    return asset?.pythPrice ?? asset?.markPrice ?? null;
  }, [priceData, selectedAsset]);

  const winRate = (user.wins + user.losses) > 0
    ? Math.round((user.wins / (user.wins + user.losses)) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <NavHeader />

      <main className="max-w-[1440px] mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">
        {/* User Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-white/5 bg-[#111111]">
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-white/40 mb-1">Points</p>
              <p className="text-xl font-bold text-emerald-400" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                {user.points.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card className="border-white/5 bg-[#111111]">
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-white/40 mb-1">Win Rate</p>
              <p className="text-xl font-bold" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                {winRate}%
                <span className="text-xs text-white/40 ml-1 font-normal">{user.wins}W / {user.losses}L</span>
              </p>
            </CardContent>
          </Card>
          <Card className="border-white/5 bg-[#111111]">
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-white/40 mb-1">Current Streak</p>
              <p className="text-xl font-bold" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                {user.streak > 0 ? (
                  <span className="text-emerald-400">{user.streak}</span>
                ) : (
                  <span className="text-white/60">0</span>
                )}
              </p>
            </CardContent>
          </Card>
          <Card className="border-white/5 bg-[#111111]">
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-white/40 mb-1">
                {editingName ? "Set Name" : "Player"}
              </p>
              {editingName ? (
                <nameFetcher.Form method="post" onSubmit={() => setEditingName(false)} className="flex gap-1">
                  <input type="hidden" name="intent" value="set-name" />
                  <input
                    name="displayName"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    maxLength={20}
                    className="bg-white/5 border border-white/10 rounded px-2 py-0.5 text-sm w-full focus:outline-none focus:border-emerald-500/50"
                    autoFocus
                  />
                  <button type="submit" className="text-xs text-emerald-400 hover:text-emerald-300">Save</button>
                </nameFetcher.Form>
              ) : (
                <p
                  className="text-lg font-bold cursor-pointer hover:text-emerald-400 transition-colors truncate"
                  onClick={() => setEditingName(true)}
                  title="Click to edit"
                  style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}
                >
                  {user.display_name}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Reset banner */}
        {user.points === 0 && (
          <div className="flex items-center justify-between bg-red-950/30 border border-red-500/20 rounded-lg px-4 py-3">
            <p className="text-sm text-red-400">You're out of points!</p>
            <resetFetcher.Form method="post">
              <input type="hidden" name="intent" value="reset" />
              <button
                type="submit"
                className="px-4 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
              >
                Reset to 500 pts
              </button>
            </resetFetcher.Form>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ─── Prediction Panel ─── */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="border-white/5 bg-[#111111]">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                  Make a Prediction
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Asset Selection */}
                <div>
                  <p className="text-xs text-white/40 mb-2">Select Asset</p>
                  <div className="flex flex-wrap gap-2">
                    {ASSETS.map((asset) => (
                      <button
                        key={asset}
                        onClick={() => setSelectedAsset(asset)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                          selectedAsset === asset
                            ? "ring-1 ring-white/20 scale-105"
                            : "opacity-60 hover:opacity-100"
                        }`}
                        style={{
                          backgroundColor: selectedAsset === asset
                            ? `${ASSET_COLORS[asset]}20`
                            : "rgba(255,255,255,0.03)",
                          color: ASSET_COLORS[asset],
                          borderColor: selectedAsset === asset ? `${ASSET_COLORS[asset]}40` : "transparent",
                          borderWidth: 1,
                        }}
                      >
                        {asset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live Price */}
                <div className="text-center py-4">
                  <p className="text-xs text-white/40 mb-1">{selectedAsset}/USD Live Price</p>
                  <p
                    className="text-3xl sm:text-4xl font-bold tracking-tight"
                    style={{
                      fontFamily: "'Space Grotesk Variable', sans-serif",
                      color: ASSET_COLORS[selectedAsset],
                    }}
                  >
                    {livePrice ? formatPrice(livePrice) : "Loading..."}
                  </p>
                </div>

                {/* Direction Buttons */}
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="predict" />
                  <input type="hidden" name="asset" value={selectedAsset} />
                  <input type="hidden" name="duration" value={selectedDuration} />
                  <input type="hidden" name="wager" value={selectedWager} />

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <button
                      type="submit"
                      name="direction"
                      value="up"
                      disabled={isSubmitting || user.points < selectedWager || !livePrice}
                      className="py-4 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 font-bold text-lg hover:bg-emerald-600/30 hover:border-emerald-500/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-[0.98] touch-manipulation"
                    >
                      <svg className="inline-block mr-2 w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                      </svg>
                      UP
                    </button>
                    <button
                      type="submit"
                      name="direction"
                      value="down"
                      disabled={isSubmitting || user.points < selectedWager || !livePrice}
                      className="py-4 rounded-xl bg-red-600/20 border border-red-500/30 text-red-400 font-bold text-lg hover:bg-red-600/30 hover:border-red-500/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-[0.98] touch-manipulation"
                    >
                      <svg className="inline-block mr-2 w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                      DOWN
                    </button>
                  </div>

                  {/* Duration & Wager */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-white/40 mb-2">Duration</p>
                      <div className="flex gap-2">
                        {DURATIONS.map((d) => (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => setSelectedDuration(d.value)}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                              selectedDuration === d.value
                                ? "bg-white/10 text-white border border-white/20"
                                : "bg-white/[0.03] text-white/50 border border-white/5 hover:bg-white/[0.06]"
                            }`}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-white/40 mb-2">Wager</p>
                      <div className="flex gap-2">
                        {WAGERS.map((w) => (
                          <button
                            key={w}
                            type="button"
                            onClick={() => setSelectedWager(w)}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                              selectedWager === w
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                : "bg-white/[0.03] text-white/50 border border-white/5 hover:bg-white/[0.06]"
                            } ${w > user.points ? "opacity-30 cursor-not-allowed" : ""}`}
                            disabled={w > user.points}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </fetcher.Form>

                {/* Error */}
                {actionError && (
                  <p className="text-sm text-red-400 bg-red-950/30 border border-red-500/20 rounded-lg px-3 py-2">
                    {actionError}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ─── Side Panel ─── */}
          <div className="space-y-4">
            {/* Active Predictions */}
            <Card className="border-white/5 bg-[#111111]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                  Active Predictions
                  {active.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] bg-emerald-500/20 text-emerald-400 border-0">
                      {active.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {active.length === 0 ? (
                  <p className="text-xs text-white/30 py-4 text-center">No active predictions</p>
                ) : (
                  <div className="space-y-2">
                    {active.map((pred: any) => (
                      <div
                        key={pred.id}
                        className="flex items-center justify-between bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="text-xs font-bold"
                            style={{ color: ASSET_COLORS[pred.asset] }}
                          >
                            {pred.asset}
                          </span>
                          <Badge
                            className={`text-[10px] border-0 ${
                              pred.direction === "up"
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-red-500/20 text-red-400"
                            }`}
                          >
                            {pred.direction.toUpperCase()}
                          </Badge>
                          <span className="text-[10px] text-white/30">{pred.wager} pts</span>
                        </div>
                        <Countdown targetTime={pred.target_time} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Results */}
            <Card className="border-white/5 bg-[#111111]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
                  Recent Results
                </CardTitle>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <p className="text-xs text-white/30 py-4 text-center">No predictions yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {history.map((pred: any) => (
                      <div
                        key={pred.id}
                        className="flex items-center justify-between text-xs py-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <span style={{ color: ASSET_COLORS[pred.asset] }}>{pred.asset}</span>
                          <span className={pred.direction === "up" ? "text-emerald-400" : "text-red-400"}>
                            {pred.direction.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {pred.status === "won" && (
                            <span className="text-emerald-400 font-medium">
                              +{pred.points_delta}
                            </span>
                          )}
                          {pred.status === "lost" && (
                            <span className="text-red-400 font-medium">
                              {pred.points_delta}
                            </span>
                          )}
                          {pred.status === "expired" && (
                            <span className="text-yellow-400 font-medium">Refund</span>
                          )}
                          <Badge
                            className={`text-[10px] border-0 ${
                              pred.status === "won"
                                ? "bg-emerald-500/20 text-emerald-400"
                                : pred.status === "lost"
                                ? "bg-red-500/20 text-red-400"
                                : "bg-yellow-500/20 text-yellow-400"
                            }`}
                          >
                            {pred.status.toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ─── Leaderboard ─── */}
        <Card className="border-white/5 bg-[#111111]">
          <CardHeader>
            <CardTitle className="text-lg" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-white/40 w-12">#</TableHead>
                  <TableHead className="text-white/40">Player</TableHead>
                  <TableHead className="text-white/40 text-right">Points</TableHead>
                  <TableHead className="text-white/40 text-right hidden sm:table-cell">Win Rate</TableHead>
                  <TableHead className="text-white/40 text-right hidden sm:table-cell">W/L</TableHead>
                  <TableHead className="text-white/40 text-right">Streak</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaderboard.length === 0 ? (
                  <TableRow className="border-white/5">
                    <TableCell colSpan={6} className="text-center text-white/30 py-8">
                      No players yet — be the first!
                    </TableCell>
                  </TableRow>
                ) : (
                  leaderboard.map((entry: any) => (
                    <TableRow
                      key={entry.id}
                      className={`border-white/5 ${entry.id === user.id ? "bg-emerald-500/5" : ""}`}
                    >
                      <TableCell className="font-medium">
                        {entry.rank <= 3 ? (
                          <span className={
                            entry.rank === 1 ? "text-yellow-400" :
                            entry.rank === 2 ? "text-gray-300" :
                            "text-amber-600"
                          }>
                            {entry.rank === 1 ? "1st" : entry.rank === 2 ? "2nd" : "3rd"}
                          </span>
                        ) : (
                          <span className="text-white/40">{entry.rank}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {entry.display_name}
                        {entry.id === user.id && (
                          <span className="text-emerald-400 text-xs ml-1">(you)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-bold text-emerald-400">
                        {entry.points.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right hidden sm:table-cell text-white/60">
                        {entry.win_rate}%
                      </TableCell>
                      <TableCell className="text-right hidden sm:table-cell text-white/40">
                        {entry.wins}/{entry.losses}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.streak > 0 ? (
                          <span className="text-emerald-400">{entry.streak}</span>
                        ) : (
                          <span className="text-white/30">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Footer */}
        <footer className="border-t border-white/5 mt-8">
          <div className="py-4 flex flex-col items-center gap-2 text-xs text-white/30">
            <p>Paper trading — no real money. Prices from Pyth Network + Hyperliquid.</p>
            <p className="text-emerald-400/80 font-medium" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
              Best Regard @0xPilotSB, All Hail Retard
            </p>
          </div>
        </footer>
      </main>

      <OracleChatPopup />
    </div>
  );
}

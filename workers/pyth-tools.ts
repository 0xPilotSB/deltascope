import { tool } from "ai";
import { z } from "zod";

const HERMES_BASE = "https://hermes.pyth.network";
const HERMES_FALLBACK = "https://pyth.dourolabs.app";
const HYPERLIQUID_API = "https://api.hyperliquid.xyz/info";

// ─── Helpers ────────────────────────────────────────────────

function parsePythPrice(price: string, expo: number): number {
	return Number(price) * Math.pow(10, expo);
}

function buildQueryString(params: Record<string, string | undefined>): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== "") {
			parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
		}
	}
	return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function buildIdsQuery(ids: string[], extra?: Record<string, string>): string {
	const parts = ids.map(
		(id) => `ids[]=${encodeURIComponent(id.startsWith("0x") ? id : `0x${id}`)}`,
	);
	if (extra) {
		for (const [k, v] of Object.entries(extra)) {
			parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
		}
	}
	return parts.length > 0 ? `?${parts.join("&")}` : "";
}

// ─── Shared Output Types ────────────────────────────────────

const feedSchema = z.object({
	id: z.string(),
	name: z.string(),
	symbol: z.string(),
	assetType: z.string(),
});

const latestPriceSchema = z.object({
	feedId: z.string(),
	price: z.number(),
	confidence: z.number(),
	emaPrice: z.number(),
	publishTime: z.number(),
});

const historicalPriceSchema = z.object({
	feedId: z.string(),
	price: z.number(),
	confidence: z.number(),
	publishTime: z.number(),
});

const twapEntrySchema = z.object({
	feedId: z.string(),
	twapPrice: z.number(),
	startTime: z.number(),
	endTime: z.number(),
});

const bookLevelSchema = z.object({ price: z.number(), size: z.number() });

const searchOutputSchema = z.object({
	feeds: z.array(feedSchema),
	error: z.string().optional(),
});

const latestPricesOutputSchema = z.object({
	prices: z.array(latestPriceSchema),
	error: z.string().optional(),
});

const historicalOutputSchema = z.object({
	prices: z.array(historicalPriceSchema),
	error: z.string().optional(),
});

const twapOutputSchema = z.object({
	twaps: z.array(twapEntrySchema),
	error: z.string().optional(),
});

const hyperliquidOutputSchema = z.object({
	markPrice: z.number(),
	oraclePrice: z.number(),
	fundingRate: z.number(),
	openInterest: z.number(),
	volume24h: z.number(),
	topBids: z.array(bookLevelSchema),
	topAsks: z.array(bookLevelSchema),
	error: z.string().optional(),
});

const analyzeOutputSchema = z.object({
	symbol: z.string(),
	currentPrice: z.number(),
	twapPrice: z.number(),
	deviation: z.number(),
	confidence: z.number(),
	confidencePercent: z.number(),
	publishTime: z.number(),
	analysis: z.string(),
	error: z.string().optional(),
});

// Inferred types for explicit return annotations
type SearchOutput = z.infer<typeof searchOutputSchema>;
type LatestPricesOutput = z.infer<typeof latestPricesOutputSchema>;
type HistoricalOutput = z.infer<typeof historicalOutputSchema>;
type TwapOutput = z.infer<typeof twapOutputSchema>;
type HyperliquidOutput = z.infer<typeof hyperliquidOutputSchema>;
type AnalyzeOutput = z.infer<typeof analyzeOutputSchema>;

// ─── Tool Definitions ───────────────────────────────────────

export function createPythTools() {
	return {
		searchPriceFeeds: tool({
			description:
				"Search through Pyth Network price feeds by symbol name or asset type. Use this to discover available price feed IDs before fetching prices. Returns up to 20 matching feeds with their hex IDs, names, symbols, and asset types.",
			parameters: z.object({
				query: z
					.string()
					.optional()
					.describe("Search term to match against feed symbol or name (e.g. 'BTC', 'ethereum')"),
				assetType: z
					.enum(["crypto", "equity", "fx", "metal", "rates"])
					.optional()
					.describe("Filter feeds by asset type"),
			}),
			outputSchema: searchOutputSchema,
			execute: async (params): Promise<SearchOutput> => {
				const query = params.query ?? undefined;
				const assetType = params.assetType ?? undefined;

				const qs = buildQueryString({ query, asset_type: assetType });

				try {
					let data: any[];

					try {
						const res = await fetch(`${HERMES_BASE}/v2/price_feeds${qs}`);
						if (!res.ok) throw new Error(`Hermes responded ${res.status}`);
						data = await res.json();
					} catch {
						const res = await fetch(`${HERMES_FALLBACK}/v1/symbols${qs}`);
						if (!res.ok) throw new Error(`Fallback responded ${res.status}`);
						data = await res.json();
					}

					const feeds = (Array.isArray(data) ? data : []).slice(0, 20).map((f: any) => ({
						id: f.id ?? "",
						name: f.name ?? f.attributes?.display_name ?? "",
						symbol: f.symbol ?? f.attributes?.symbol ?? "",
						assetType: f.asset_type ?? f.attributes?.asset_type ?? "",
					}));

					return { feeds };
				} catch (err: any) {
					return { feeds: [], error: `Failed to search price feeds: ${err.message}` };
				}
			},
		}),

		getLatestPrices: tool({
			description:
				"Get real-time prices from Pyth Network for one or more feed IDs. Pass hex feed IDs (from searchPriceFeeds). Returns human-readable prices, confidence intervals, EMA prices, and publish timestamps.",
			parameters: z.object({
				ids: z
					.array(z.string())
					.min(1)
					.describe("Array of hex price feed IDs (e.g. ['0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'])"),
			}),
			outputSchema: latestPricesOutputSchema,
			execute: async (params): Promise<LatestPricesOutput> => {
				try {
					const qs = buildIdsQuery(params.ids, { parsed: "true" });
					const res = await fetch(`${HERMES_BASE}/v2/updates/price/latest${qs}`);
					if (!res.ok) throw new Error(`Hermes responded ${res.status}`);

					const body: any = await res.json();
					const parsed = body.parsed ?? [];

					const prices = parsed.map((entry: any) => {
						const p = entry.price ?? {};
						const e = entry.ema_price ?? {};
						return {
							feedId: entry.id ?? "",
							price: parsePythPrice(p.price ?? "0", p.expo ?? 0),
							confidence: parsePythPrice(p.conf ?? "0", p.expo ?? 0),
							emaPrice: parsePythPrice(e.price ?? "0", e.expo ?? 0),
							publishTime: p.publish_time ?? 0,
						};
					});

					return { prices };
				} catch (err: any) {
					return { prices: [], error: `Failed to get latest prices: ${err.message}` };
				}
			},
		}),

		getHistoricalPrice: tool({
			description:
				"Get the Pyth Network price for specific feeds at a historical timestamp. Useful for checking what a price was at a particular point in time. The publishTime is in Unix seconds.",
			parameters: z.object({
				ids: z
					.array(z.string())
					.min(1)
					.describe("Array of hex price feed IDs"),
				publishTime: z
					.number()
					.describe("Unix timestamp in seconds for the historical price point"),
			}),
			outputSchema: historicalOutputSchema,
			execute: async (params): Promise<HistoricalOutput> => {
				try {
					const qs = buildIdsQuery(params.ids, { parsed: "true" });
					const res = await fetch(
						`${HERMES_BASE}/v2/updates/price/${params.publishTime}${qs}`,
					);
					if (!res.ok) throw new Error(`Hermes responded ${res.status}`);

					const body: any = await res.json();
					const parsed = body.parsed ?? [];

					const prices = parsed.map((entry: any) => {
						const p = entry.price ?? {};
						return {
							feedId: entry.id ?? "",
							price: parsePythPrice(p.price ?? "0", p.expo ?? 0),
							confidence: parsePythPrice(p.conf ?? "0", p.expo ?? 0),
							publishTime: p.publish_time ?? 0,
						};
					});

					return { prices };
				} catch (err: any) {
					return { prices: [], error: `Failed to get historical price: ${err.message}` };
				}
			},
		}),

		getTwap: tool({
			description:
				"Get the time-weighted average price (TWAP) from Pyth Network for one or more feeds over a specified time window. Useful for comparing spot price to TWAP to detect short-term deviations.",
			parameters: z.object({
				ids: z
					.array(z.string())
					.min(1)
					.describe("Array of hex price feed IDs"),
				windowSeconds: z
					.number()
					.min(1)
					.max(600)
					.optional()
					.describe("TWAP window in seconds (1-600, default 60)"),
			}),
			outputSchema: twapOutputSchema,
			execute: async (params): Promise<TwapOutput> => {
				const windowSeconds = params.windowSeconds ?? 60;

				try {
					const qs = buildIdsQuery(params.ids, {
						window_seconds: String(windowSeconds),
						parsed: "true",
					});
					const res = await fetch(`${HERMES_BASE}/v2/updates/twap/latest${qs}`);
					if (!res.ok) throw new Error(`Hermes responded ${res.status}`);

					const body: any = await res.json();
					const parsed = body.parsed ?? [];

					const twaps = parsed.map((entry: any) => {
						const t = entry.twap ?? {};
						return {
							feedId: entry.id ?? "",
							twapPrice: parsePythPrice(t.price ?? "0", t.expo ?? 0),
							startTime: t.start_time ?? entry.start_time ?? 0,
							endTime: t.end_time ?? entry.end_time ?? 0,
						};
					});

					return { twaps };
				} catch (err: any) {
					return { twaps: [], error: `Failed to get TWAP: ${err.message}` };
				}
			},
		}),

		getHyperliquidData: tool({
			description:
				"Get Hyperliquid perpetual futures market data for a specific coin. Returns mark price, oracle price, funding rate, open interest, 24h volume, and top-of-book bids/asks. Use uppercase coin symbols (e.g. 'BTC', 'ETH').",
			parameters: z.object({
				coin: z
					.string()
					.describe("Coin symbol in uppercase (e.g. 'BTC', 'ETH', 'SOL')"),
			}),
			outputSchema: hyperliquidOutputSchema,
			execute: async (params): Promise<HyperliquidOutput> => {
				const coin = params.coin.toUpperCase();
				const emptyResult: HyperliquidOutput = {
					markPrice: 0,
					oraclePrice: 0,
					fundingRate: 0,
					openInterest: 0,
					volume24h: 0,
					topBids: [],
					topAsks: [],
				};

				try {
					const [metaRes, bookRes] = await Promise.all([
						fetch(HYPERLIQUID_API, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ type: "metaAndAssetCtxs" }),
						}),
						fetch(HYPERLIQUID_API, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ type: "l2Book", coin }),
						}),
					]);

					if (!metaRes.ok) throw new Error(`Meta request failed: ${metaRes.status}`);
					if (!bookRes.ok) throw new Error(`Book request failed: ${bookRes.status}`);

					const metaBody: any = await metaRes.json();
					const bookBody: any = await bookRes.json();

					// metaAndAssetCtxs returns [meta, assetCtxs]
					const meta = metaBody[0] ?? {};
					const assetCtxs = metaBody[1] ?? [];
					const universeAssets: any[] = meta.universe ?? [];

					const assetIndex = universeAssets.findIndex(
						(a: any) => a.name?.toUpperCase() === coin,
					);

					if (assetIndex === -1) {
						return { ...emptyResult, error: `Coin '${coin}' not found on Hyperliquid` };
					}

					const ctx = assetCtxs[assetIndex] ?? {};

					// Parse L2 book
					const levels = bookBody.levels ?? bookBody?.l2Book?.levels ?? [];
					const bids: any[] = levels[0] ?? [];
					const asks: any[] = levels[1] ?? [];

					const topBids = bids.slice(0, 5).map((b: any) => ({
						price: parseFloat(b.px ?? "0"),
						size: parseFloat(b.sz ?? "0"),
					}));

					const topAsks = asks.slice(0, 5).map((a: any) => ({
						price: parseFloat(a.px ?? "0"),
						size: parseFloat(a.sz ?? "0"),
					}));

					return {
						markPrice: parseFloat(ctx.markPx ?? "0"),
						oraclePrice: parseFloat(ctx.oraclePx ?? "0"),
						fundingRate: parseFloat(ctx.funding ?? "0"),
						openInterest: parseFloat(ctx.openInterest ?? "0"),
						volume24h: parseFloat(ctx.dayNtlVlm ?? "0"),
						topBids,
						topAsks,
					};
				} catch (err: any) {
					return { ...emptyResult, error: `Failed to get Hyperliquid data: ${err.message}` };
				}
			},
		}),

		analyzePriceFeed: tool({
			description:
				"Run a multi-step analysis on a price feed: searches for the feed by symbol, fetches current price and 60-second TWAP, then computes deviation and confidence metrics. Use this for a quick health check on any Pyth-supported asset.",
			parameters: z.object({
				symbol: z
					.string()
					.describe("Asset symbol to analyze (e.g. 'BTC', 'ETH', 'SOL')"),
			}),
			outputSchema: analyzeOutputSchema,
			execute: async (params): Promise<AnalyzeOutput> => {
				const symbol = params.symbol.toUpperCase();
				const emptyResult: AnalyzeOutput = {
					symbol,
					currentPrice: 0,
					twapPrice: 0,
					deviation: 0,
					confidence: 0,
					confidencePercent: 0,
					publishTime: 0,
					analysis: "",
				};

				try {
					// Step 1: Search for the feed ID
					const searchQs = buildQueryString({ query: symbol, asset_type: "crypto" });
					let feeds: any[];

					try {
						const res = await fetch(`${HERMES_BASE}/v2/price_feeds${searchQs}`);
						if (!res.ok) throw new Error(`Hermes responded ${res.status}`);
						feeds = await res.json();
					} catch {
						const res = await fetch(`${HERMES_FALLBACK}/v1/symbols${searchQs}`);
						if (!res.ok) throw new Error(`Fallback responded ${res.status}`);
						feeds = await res.json();
					}

					if (!Array.isArray(feeds) || feeds.length === 0) {
						return { ...emptyResult, error: `No price feed found for symbol '${symbol}'` };
					}

					// Pick the best match — prefer exact Crypto.<SYMBOL>/USD
					const targetSymbol = `Crypto.${symbol}/USD`;
					const feed =
						feeds.find((f: any) =>
							(f.attributes?.symbol ?? f.symbol ?? "").toUpperCase() ===
							targetSymbol.toUpperCase(),
						) ?? feeds[0];

					const feedId = feed.id;
					if (!feedId) {
						return { ...emptyResult, error: "Feed ID not found in search results" };
					}

					// Step 2 & 3: Get latest price and TWAP in parallel
					const priceQs = buildIdsQuery([feedId], { parsed: "true" });
					const twapQs = buildIdsQuery([feedId], {
						window_seconds: "60",
						parsed: "true",
					});

					const [priceRes, twapRes] = await Promise.all([
						fetch(`${HERMES_BASE}/v2/updates/price/latest${priceQs}`),
						fetch(`${HERMES_BASE}/v2/updates/twap/latest${twapQs}`),
					]);

					if (!priceRes.ok) throw new Error(`Price request failed: ${priceRes.status}`);

					const priceBody: any = await priceRes.json();
					const priceParsed = (priceBody.parsed ?? [])[0];

					if (!priceParsed) {
						return { ...emptyResult, error: "No parsed price data returned" };
					}

					const p = priceParsed.price ?? {};
					const currentPrice = parsePythPrice(p.price ?? "0", p.expo ?? 0);
					const confidence = parsePythPrice(p.conf ?? "0", p.expo ?? 0);
					const publishTime = p.publish_time ?? 0;

					// TWAP may fail for some feeds, handle gracefully
					let twapPrice = currentPrice;
					if (twapRes.ok) {
						const twapBody: any = await twapRes.json();
						const twapParsed = (twapBody.parsed ?? [])[0];
						if (twapParsed) {
							const t = twapParsed.twap ?? {};
							twapPrice = parsePythPrice(t.price ?? "0", t.expo ?? 0);
						}
					}

					// Step 4: Compute metrics
					const deviation =
						twapPrice !== 0
							? ((currentPrice - twapPrice) / twapPrice) * 100
							: 0;
					const confidencePercent =
						currentPrice !== 0 ? (confidence / currentPrice) * 100 : 0;

					// Build analysis string
					const deviationDir =
						deviation > 0 ? "above" : deviation < 0 ? "below" : "at";
					const absDeviation = Math.abs(deviation).toFixed(4);

					const analysis = [
						`${symbol} is currently trading at $${currentPrice.toFixed(6)}.`,
						`The 60-second TWAP is $${twapPrice.toFixed(6)}, with the spot price ${absDeviation}% ${deviationDir} TWAP.`,
						`Price confidence interval is +/- $${confidence.toFixed(6)} (${confidencePercent.toFixed(4)}% of price).`,
						confidencePercent > 1
							? "Warning: Wide confidence interval suggests low liquidity or high volatility."
							: "Confidence interval is tight, indicating good price reliability.",
						Math.abs(deviation) > 0.5
							? "Notable deviation from TWAP detected — possible short-term volatility or momentum."
							: "Price is tracking close to TWAP, suggesting stable conditions.",
					].join(" ");

					return {
						symbol,
						currentPrice,
						twapPrice,
						deviation,
						confidence,
						confidencePercent,
						publishTime,
						analysis,
					};
				} catch (err: any) {
					return {
						...emptyResult,
						error: `Failed to analyze price feed: ${err.message}`,
					};
				}
			},
		}),
	};
}

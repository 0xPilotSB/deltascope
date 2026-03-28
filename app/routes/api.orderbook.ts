import { data } from "react-router";
import type { Route } from "./+types/api.orderbook";

interface BookLevel {
  px: string;
  sz: string;
  n: number;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const coin = url.searchParams.get("coin");

  if (!coin) {
    return data(
      { error: "Missing required query param: coin", bids: [], asks: [] },
      { status: 400 }
    );
  }

  // Validate coin param: alphanumeric only, max 20 chars
  if (!/^[A-Za-z0-9]{1,20}$/.test(coin)) {
    return data(
      { error: "Invalid coin parameter", bids: [], asks: [] },
      { status: 400 }
    );
  }

  try {
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "l2Book", coin: coin.toUpperCase() }),
    });

    if (!response.ok) {
      return data(
        { error: "Failed to fetch orderbook from Hyperliquid", bids: [], asks: [] },
        { status: 502 }
      );
    }

    const result = (await response.json()) as {
      levels: [BookLevel[], BookLevel[]];
    };

    const [rawBids, rawAsks] = result.levels;

    const bids = (rawBids ?? []).slice(0, 15).map((level) => ({
      price: Number(level.px),
      size: Number(level.sz),
      orders: level.n,
    }));

    const asks = (rawAsks ?? []).slice(0, 15).map((level) => ({
      price: Number(level.px),
      size: Number(level.sz),
      orders: level.n,
    }));

    return data({ bids, asks, coin: coin.toUpperCase(), error: null });
  } catch (err) {
    console.error("Error fetching orderbook:", err);
    return data(
      {
        error: "Failed to fetch orderbook data",
        bids: [],
        asks: [],
      },
      { status: 500 }
    );
  }
}

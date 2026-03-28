import { data } from "react-router";
import type { Route } from "./+types/api.funding";

interface FundingEntry {
  coin: string;
  fundingRate: string;
  premium: string;
  time: number;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const coin = url.searchParams.get("coin");

  if (!coin) {
    return data(
      { error: "Missing required query param: coin", history: [] },
      { status: 400 }
    );
  }

  // Validate coin param: alphanumeric only, max 20 chars
  if (!/^[A-Za-z0-9]{1,20}$/.test(coin)) {
    return data(
      { error: "Invalid coin parameter", history: [] },
      { status: 400 }
    );
  }

  try {
    const startTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "fundingHistory",
        coin: coin.toUpperCase(),
        startTime,
      }),
    });

    if (!response.ok) {
      return data(
        { error: "Failed to fetch funding history from Hyperliquid", history: [] },
        { status: 502 }
      );
    }

    const result = (await response.json()) as FundingEntry[];

    const history = (result ?? []).map((entry) => ({
      coin: entry.coin,
      fundingRate: Number(entry.fundingRate),
      premium: Number(entry.premium),
      time: entry.time,
    }));

    return data({ history, coin: coin.toUpperCase(), error: null });
  } catch (err) {
    console.error("Error fetching funding history:", err);
    return data(
      {
        error: "Failed to fetch funding data",
        history: [],
      },
      { status: 500 }
    );
  }
}

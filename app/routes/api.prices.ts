import type { Route } from "./+types/api.prices";

/**
 * REST API endpoint — proxies to PriceAggregator DO for cached data.
 * This route is now handled directly in workers/app.ts for lower latency,
 * but kept as a fallback / for type generation.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const id = context.cloudflare.env.PRICE_AGGREGATOR.idFromName("global");
  const stub = context.cloudflare.env.PRICE_AGGREGATOR.get(id);
  const res = await stub.fetch(new Request("https://internal/prices"));
  const data = await res.json();
  return Response.json(data);
}

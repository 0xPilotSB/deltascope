import { createRequestHandler } from "react-router";
import { routeAgentRequest } from "agents";

// Export Durable Objects so Cloudflare can instantiate them
export { PriceAggregator } from "./price-aggregator";
export { ExampleDO } from "./example-do";
export { LocalDataProxyService } from "./data-proxy";
export { ChatSessionsDO } from "./chat-sessions";
export { Chat } from "./chat";
export { PredictionGame } from "./prediction-game";

/**
 * Augment AppLoadContext to include Cloudflare bindings.
 */
declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
      ownerId: string;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

// ─── Security headers ────────────────────────────────────
// CSP: removed fonts.googleapis.com/gstatic (self-hosted now), removed unsafe-eval
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self' wss: https://hermes.pyth.network https://hermes-beta.pyth.network https://api.hyperliquid.xyz https://deltascope.site wss://deltascope.site",
  "img-src 'self' data: blob:",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": CSP,
};

function addSecurityHeaders(response: Response): Response {
  const newResp = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    newResp.headers.set(key, value);
  }
  return newResp;
}

function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

function isValidOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // Same-origin requests don't send Origin
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" ||
      url.hostname.endsWith(".camelai.dev") ||
      url.hostname.endsWith(".camelai.app") ||
      url.hostname === "deltascope.site" ||
      url.hostname.endsWith(".deltascope.site");
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ─── Static assets: immutable cache (hashed filenames) ───
    if (url.pathname.startsWith("/assets/")) {
      const response = await env.ASSETS.fetch(request);
      const cached = new Response(response.body, response);
      cached.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      cached.headers.set("X-Content-Type-Options", "nosniff");
      return cached;
    }

    // ─── Static files in /public (favicon, og-image, etc) ───
    if (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico" || url.pathname === "/og-image.png") {
      const response = await env.ASSETS.fetch(request);
      const cached = new Response(response.body, response);
      cached.headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      cached.headers.set("X-Content-Type-Options", "nosniff");
      return cached;
    }

    // ─── WebSocket upgrade → validate origin + route to PriceAggregator DO ───
    if (url.pathname === "/ws/prices" && request.headers.get("Upgrade") === "websocket") {
      if (!isValidOrigin(request)) {
        return new Response("Forbidden", { status: 403 });
      }
      const id = env.PRICE_AGGREGATOR.idFromName("global");
      const stub = env.PRICE_AGGREGATOR.get(id);
      return stub.fetch(new Request(new URL("/ws/prices", request.url), { headers: request.headers }));
    }

    // ─── REST API endpoints → route to PriceAggregator DO ───
    // Edge-cached via CF Cache API to avoid DO round-trip on every request.
    // The DO is smart-placed near upstream APIs (Pyth/HL), which is optimal
    // for upstream latency but means user→DO round-trip is high.
    // Edge caching serves responses from the nearest CF PoP instead.
    const id = env.PRICE_AGGREGATOR.idFromName("global");
    const cache = caches.default;

    if (url.pathname === "/api/prices") {
      // Check edge cache first (keyed by URL, per-PoP)
      const cacheKey = new Request(request.url, { method: "GET" });
      let cached = await cache.match(cacheKey);
      if (cached) return addSecurityHeaders(cached);

      const stub = env.PRICE_AGGREGATOR.get(id);
      const res = await stub.fetch(new Request(new URL("/prices", request.url), { headers: request.headers }));
      const response = addSecurityHeaders(new Response(res.body, res));
      response.headers.set("Cache-Control", "public, s-maxage=1, stale-while-revalidate=2");
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    if (url.pathname === "/api/latency") {
      const cacheKey = new Request(request.url, { method: "GET" });
      let cached = await cache.match(cacheKey);
      if (cached) return addSecurityHeaders(cached);

      const stub = env.PRICE_AGGREGATOR.get(id);
      const res = await stub.fetch(new Request(new URL("/latency", request.url), { headers: request.headers }));
      const response = addSecurityHeaders(new Response(res.body, res));
      response.headers.set("Cache-Control", "public, s-maxage=2, stale-while-revalidate=5");
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    if (url.pathname === "/api/hip3") {
      const cacheKey = new Request(request.url, { method: "GET" });
      let cached = await cache.match(cacheKey);
      if (cached) return addSecurityHeaders(cached);

      const stub = env.PRICE_AGGREGATOR.get(id);
      const res = await stub.fetch(new Request(new URL("/hip3", request.url), { headers: request.headers }));
      const response = addSecurityHeaders(new Response(res.body, res));
      response.headers.set("Cache-Control", "public, s-maxage=5, stale-while-revalidate=10");
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // ─── Agent SDK routing (Chat DO) ───
    // Strip AbortSignal to avoid DataCloneError across DO boundary
    const cleanAgentRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    const agentResponse = await routeAgentRequest(cleanAgentRequest, env);
    if (agentResponse) {
      return agentResponse;
    }

    // ─── SSR pages via React Router ───
    let ownerId = getCookie(request, "chat-owner");
    const needsCookie = !ownerId;
    if (!ownerId) {
      ownerId = crypto.randomUUID();
    }

    const response = await requestHandler(request, {
      cloudflare: { env, ctx, ownerId },
    });

    const secured = addSecurityHeaders(response);

    // Preconnect hint for WebSocket — browser starts connection during HTML parse
    const ct = secured.headers.get("Content-Type");
    if (ct?.includes("text/html")) {
      secured.headers.set("Link", `<wss://${url.hostname}/ws/prices>; rel=preconnect`);
      if (!secured.headers.has("Cache-Control")) {
        secured.headers.set("Cache-Control", "public, max-age=10, stale-while-revalidate=30");
      }
    }

    if (needsCookie) {
      secured.headers.append(
        "Set-Cookie",
        `chat-owner=${ownerId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`
      );
    }
    return secured;
  },
} satisfies ExportedHandler<Env>;

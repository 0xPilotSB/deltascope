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
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
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

// ─── DO Failover helper ─────────────────────────────────
// Primary: "global", Standby: "global-standby" (same class, independent instance)
// Standby maintains its own upstream connections via alarm loop.
const DO_PRIMARY = "global";
const DO_STANDBY = "global-standby";
const DO_TIMEOUT_MS = 3000;
let standbyWarmed = false;

// ─── Simple per-IP rate limiter (in-memory, resets on cold start) ───
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 120; // requests per window
const RATE_WINDOW_MS = 60_000; // 1 minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  // Prune stale entries periodically
  if (rateLimitMap.size > 10000) {
    for (const [k, v] of rateLimitMap) {
      if (now >= v.resetAt) rateLimitMap.delete(k);
    }
  }
  return entry.count > RATE_LIMIT;
}

async function fetchWithFailover(
  env: Env,
  buildRequest: () => Request,
): Promise<Response> {
  const primaryStub = env.PRICE_AGGREGATOR.get(
    env.PRICE_AGGREGATOR.idFromName(DO_PRIMARY),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DO_TIMEOUT_MS);
  try {
    const res = await primaryStub.fetch(buildRequest(), { signal: controller.signal });
    clearTimeout(timer);
    if (res.status >= 500) throw new Error("primary-5xx");
    return res;
  } catch {
    clearTimeout(timer);
    const standbyStub = env.PRICE_AGGREGATOR.get(
      env.PRICE_AGGREGATOR.idFromName(DO_STANDBY),
    );
    return standbyStub.fetch(buildRequest());
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ─── Rate limit API endpoints ───
    if (url.pathname.startsWith("/api/")) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (isRateLimited(ip)) {
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }
    }

    // ─── Warm up standby DO on first request (one-time) ───
    if (!standbyWarmed) {
      standbyWarmed = true;
      const standbyStub = env.PRICE_AGGREGATOR.get(
        env.PRICE_AGGREGATOR.idFromName(DO_STANDBY),
      );
      ctx.waitUntil(
        standbyStub.fetch(new Request(new URL("/prices", request.url))).catch((e) => console.error("Standby warm-up failed:", e)),
      );
    }

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
      const wsReq = () => new Request(new URL("/ws/prices", request.url), { headers: request.headers });
      try {
        const primaryStub = env.PRICE_AGGREGATOR.get(
          env.PRICE_AGGREGATOR.idFromName(DO_PRIMARY),
        );
        return await primaryStub.fetch(wsReq());
      } catch {
        // Failover WS to standby
        const standbyStub = env.PRICE_AGGREGATOR.get(
          env.PRICE_AGGREGATOR.idFromName(DO_STANDBY),
        );
        return standbyStub.fetch(wsReq());
      }
    }

    // ─── REST API endpoints → route to PriceAggregator DO with failover ───

    if (url.pathname === "/api/prices") {
      const res = await fetchWithFailover(env, () =>
        new Request(new URL("/prices", request.url), { headers: request.headers }),
      );
      const response = addSecurityHeaders(new Response(res.body, res));
      response.headers.set("Cache-Control", "public, max-age=1, stale-while-revalidate=2");
      return response;
    }

    if (url.pathname === "/api/latency") {
      const res = await fetchWithFailover(env, () =>
        new Request(new URL("/latency", request.url), { headers: request.headers }),
      );
      const response = addSecurityHeaders(new Response(res.body, res));
      response.headers.set("Cache-Control", "public, max-age=2, stale-while-revalidate=5");
      return response;
    }

    if (url.pathname === "/api/hip3") {
      const res = await fetchWithFailover(env, () =>
        new Request(new URL("/hip3", request.url), { headers: request.headers }),
      );
      const response = addSecurityHeaders(new Response(res.body, res));
      response.headers.set("Cache-Control", "public, max-age=5, stale-while-revalidate=10");
      return response;
    }

    if (url.pathname === "/api/history") {
      const doUrl = new URL("/history", request.url);
      doUrl.search = url.search;
      const res = await fetchWithFailover(env, () =>
        new Request(doUrl, { headers: request.headers }),
      );
      const response = addSecurityHeaders(new Response(res.body, res));
      response.headers.set("Cache-Control", "public, max-age=1, stale-while-revalidate=5");
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

    let response: Response;
    try {
      response = await requestHandler(request, {
        cloudflare: { env, ctx, ownerId },
      });
    } catch (error) {
      console.error("SSR error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }

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

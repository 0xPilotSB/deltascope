/**
 * DeltaScope Edge Proxy Worker
 *
 * Deploy on your Cloudflare account with deltascope.site
 * Proxies to the camelAI-hosted app with maximum performance + security
 */

// ─── Configuration ─────────────────────────────────────────
const ORIGIN = "https://deltascope-btatu5.camelai.app";

// Assets that contain content hashes — safe to cache forever
const IMMUTABLE_PATTERN = /\/assets\/.*[-.][\da-zA-Z]{6,}\.(js|css|woff2?|png|jpg|svg)$/;

// Static assets — cache for 1 day
const STATIC_PATTERN = /\.(ico|svg|png|jpg|jpeg|webp|gif|woff2?|ttf|eot)$/;

// API endpoints — short cache with stale-while-revalidate
const API_PATTERN = /^\/api\/(prices|hip3|latency|orderbook|funding)/;

// Security headers applied to all responses
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-DNS-Prefetch-Control": "on",
};

// CSP — allow self + upstream data sources
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' wss: https://hermes.pyth.network https://hermes-beta.pyth.network https://api.hyperliquid.xyz",
  "img-src 'self' data: blob:",
  "frame-ancestors 'none'",
].join("; ");

// ─── Main Handler ──────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // ── WebSocket upgrade — pass through directly ──
    if (request.headers.get("Upgrade") === "websocket") {
      const originUrl = new URL(pathname + url.search, ORIGIN);
      const originReq = new Request(originUrl, {
        method: request.method,
        headers: rewriteHeaders(request.headers, url.hostname),
      });
      return fetch(originReq);
    }

    // ── Try edge cache first for cacheable requests ──
    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default;

    if (request.method === "GET") {
      const cached = await cache.match(cacheKey);
      if (cached) return addSecurityHeaders(cached);
    }

    // ── Proxy to origin ──
    const originUrl = new URL(pathname + url.search, ORIGIN);
    const originReq = new Request(originUrl, {
      method: request.method,
      headers: rewriteHeaders(request.headers, url.hostname),
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      redirect: "manual",
    });

    let response;
    try {
      response = await fetch(originReq, {
        cf: {
          // Cloudflare optimizations
          minify: { javascript: true, css: true, html: true },
          mirage: true,      // Image optimization
          polish: "lossy",   // Image compression
        },
      });
    } catch (err) {
      return new Response("Origin unavailable", { status: 502 });
    }

    // ── Build response with optimized headers ──
    const resp = new Response(response.body, response);

    // Set cache headers based on content type
    if (IMMUTABLE_PATTERN.test(pathname)) {
      resp.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    } else if (STATIC_PATTERN.test(pathname)) {
      resp.headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    } else if (API_PATTERN.test(pathname)) {
      resp.headers.set("Cache-Control", "public, max-age=1, stale-while-revalidate=5");
    } else if (pathname === "/" || !pathname.includes(".")) {
      // HTML pages — short cache for fast updates
      resp.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    }

    // Apply security headers
    const secured = addSecurityHeaders(resp);

    // Store cacheable responses in edge cache
    if (request.method === "GET" && response.status === 200) {
      if (IMMUTABLE_PATTERN.test(pathname) || STATIC_PATTERN.test(pathname)) {
        ctx.waitUntil(cache.put(cacheKey, secured.clone()));
      }
    }

    return secured;
  },
};

// ─── Helpers ───────────────────────────────────────────────

function rewriteHeaders(headers, hostname) {
  const rewritten = new Headers(headers);
  rewritten.set("Host", new URL(ORIGIN).hostname);
  rewritten.set("X-Forwarded-Host", hostname);
  rewritten.set("X-Real-IP", headers.get("CF-Connecting-IP") || "");
  // Remove CF headers that would confuse origin
  rewritten.delete("CF-Ray");
  rewritten.delete("CF-Visitor");
  return rewritten;
}

function addSecurityHeaders(response) {
  const resp = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    resp.headers.set(key, value);
  }
  resp.headers.set("Content-Security-Policy", CSP);
  return resp;
}

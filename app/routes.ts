import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("chat", "routes/chat.tsx"),
  route("analysis", "routes/analysis.tsx"),
  route("latency", "routes/latency.tsx"),
  route("market-hours", "routes/market-hours.tsx"),
  route("developers", "routes/developers.tsx"),
  route("predict", "routes/predict.tsx"),
  route("api/prices", "routes/api.prices.ts"),
  route("api/orderbook", "routes/api.orderbook.ts"),
  route("api/funding", "routes/api.funding.ts"),
  route("api/hip3", "routes/api.hip3.ts"),
] satisfies RouteConfig;

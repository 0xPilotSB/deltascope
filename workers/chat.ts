import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  stepCountIs,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { createPythTools } from "./pyth-tools";

/**
 * DeltaScope AI Chat Agent
 *
 * An AI assistant specialized in Pyth Network oracle data and Hyperliquid markets.
 * Has access to 6 MCP-style tools for querying real-time and historical price data.
 */
export class Chat extends AIChatAgent<Env> {
  async deleteAllMessages(): Promise<void> {
    this.messages = [];
  }

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ): Promise<Response> {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const pythTools = createPythTools();

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const result = streamText({
          model: workersai("auto", {}),
          messages: await convertToModelMessages(this.messages),
          system: `You are DeltaScope AI — an expert assistant for real-time cryptocurrency and financial market data.

You have access to these tools:

1. **searchPriceFeeds** — Search 1,930+ Pyth price feeds by symbol or asset type (crypto, equity, fx, metal, rates)
2. **getLatestPrices** — Get real-time oracle prices with confidence intervals for specific feed IDs
3. **getHistoricalPrice** — Query prices at any historical timestamp for backtesting
4. **getTwap** — Calculate time-weighted average prices (1-600 second windows)
5. **getHyperliquidData** — Get Hyperliquid perps data: mark price, funding rate, open interest, orderbook
6. **analyzePriceFeed** — Full analysis: current price, TWAP, deviation, confidence metrics

## Common feed IDs (use these directly when users ask about major assets):
- BTC/USD: 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
- ETH/USD: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
- SOL/USD: 0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
- HYPE/USD: 0x4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b
- ARB/USD: 0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5
- DOGE/USD: 0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c
- AVAX/USD: 0x93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7
- LINK/USD: 0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221

## Guidelines:
- When users ask about prices, use the tools to get REAL data — never make up numbers
- For unknown assets, use searchPriceFeeds first to find the feed ID, then getLatestPrices
- Format prices with appropriate decimals ($XX,XXX.XX for BTC, $X.XXXX for small assets)
- Include confidence intervals when relevant
- For comparisons, fetch data for all requested assets and present side-by-side
- Explain oracle discrepancies and funding rates when relevant to the question
- Be concise but thorough — traders value accuracy over length`,
          tools: pythTools,
          stopWhen: stepCountIs(100),
          onFinish,
          // Note: abortSignal intentionally omitted — Workers AI binding (env.AI.run())
          // cannot serialize AbortSignal across the RPC boundary (DataCloneError)
        });
        writer.merge(result.toUIMessageStream());
      },
    });

    return createUIMessageStreamResponse({ stream });
  }
}

import React, { useEffect, useRef, useCallback, useMemo } from "react";
import type { TickData } from "~/stores/price-store";
import { usePriceStore, aggregateLine, aggregateCandles } from "~/stores/price-store";

export const TIMEFRAMES = [
  { label: "1s", seconds: 1 },
  { label: "5s", seconds: 5 },
  { label: "15s", seconds: 15 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
] as const;

export type TimeframeLabel = (typeof TIMEFRAMES)[number]["label"];
export type ChartType = "line" | "candlestick";

interface TVChartProps {
  symbol: string;
  ticks: TickData[]; // Initial ticks for first render
  currentPrice?: number;
  height?: number;
  className?: string;
  timeframe: number; // seconds
  chartType: ChartType;
}

/**
 * High-performance TradingView chart that subscribes directly to the
 * Zustand store for 60fps updates. Bypasses React's render cycle entirely
 * for the hot path (tick → series.update). React only handles cold paths
 * like symbol/timeframe/chartType changes.
 */
function TVChartInner({
  symbol,
  ticks,
  currentPrice,
  height = 340,
  className,
  timeframe,
  chartType,
}: TVChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);
  const seriesRef = useRef<any>(null);
  const priceLineRef = useRef<any>(null);
  const modulesRef = useRef<any>(null);

  // Track current config in refs so the store subscription can read them
  const symbolRef = useRef(symbol);
  const timeframeRef = useRef(timeframe);
  const chartTypeRef = useRef(chartType);
  const lastTickVersionRef = useRef(0);
  const seededRef = useRef(false); // Has chart received initial setData with real data?
  const prevChartTypeRef = useRef(chartType); // Track previous chartType for swap detection
  const lastCandleStartRef = useRef(-1); // Track last bar time for auto-scroll on new bar

  // Keep refs in sync with props
  symbolRef.current = symbol;
  timeframeRef.current = timeframe;
  chartTypeRef.current = chartType;

  const chartOptions = useMemo(() => ({
    layout: {
      background: { color: "#111111" },
      textColor: "#666",
      fontFamily: "'Space Grotesk Variable', sans-serif",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: "rgba(255,255,255,0.03)" },
      horzLines: { color: "rgba(255,255,255,0.03)" },
    },
    crosshair: { mode: 0 as const },
    rightPriceScale: { borderColor: "rgba(255,255,255,0.05)" },
    timeScale: {
      borderColor: "rgba(255,255,255,0.05)",
      timeVisible: true,
      secondsVisible: true,
      rightOffset: 5,
      shiftVisibleRangeOnNewBar: true,
    },
  }), []);

  const setupSeries = useCallback((chart: any, modules: any, type: ChartType) => {
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
      priceLineRef.current = null;
    }

    if (type === "candlestick") {
      seriesRef.current = chart.addSeries(modules.CandlestickSeries, {
        upColor: "#10b981",
        downColor: "#ef4444",
        borderUpColor: "#10b981",
        borderDownColor: "#ef4444",
        wickUpColor: "#10b981",
        wickDownColor: "#ef4444",
        priceLineVisible: false,
        lastValueVisible: true,
      });
    } else {
      seriesRef.current = chart.addSeries(modules.LineSeries, {
        color: "#10b981",
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBackgroundColor: "#10b981",
        priceLineVisible: false,
        lastValueVisible: true,
      });
    }
  }, []);

  // ─── Initialize chart + subscribe to store for 60fps updates ──
  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    const initChart = async () => {
      const modules = await import("lightweight-charts");
      modulesRef.current = modules;

      if (disposed || !containerRef.current) return;

      const chart = modules.createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height,
        ...chartOptions,
      });

      chartRef.current = chart;
      setupSeries(chart, modules, chartType);

      // Set initial data from props
      const sym = symbolRef.current;
      const tf = timeframeRef.current;
      const ct = chartTypeRef.current;

      if (ct === "candlestick") {
        const candles = aggregateCandles(ticks, tf);
        if (candles.length > 0) {
          seriesRef.current.setData(
            candles.map((d) => ({ time: d.time as any, open: d.open, high: d.high, low: d.low, close: d.close })),
          );
        }
      } else {
        const line = aggregateLine(ticks, tf);
        if (line.length > 0) {
          seriesRef.current.setData(
            line.map((d) => ({ time: d.time as any, value: d.value })),
          );
        }
      }
      chart.timeScale().fitContent();
      chart.timeScale().scrollToRealTime();

      // Price line
      if (currentPrice && seriesRef.current) {
        priceLineRef.current = seriesRef.current.createPriceLine({
          price: currentPrice,
          color: "rgba(16, 185, 129, 0.4)",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
        });
      }

      // Resize observer
      const resizeObserver = new ResizeObserver((entries) => {
        if (disposed || !containerRef.current) return;
        const { width } = entries[0].contentRect;
        chart.applyOptions({ width });
      });
      resizeObserver.observe(containerRef.current);
      (chart as any).__resizeObserver = resizeObserver;

      // ─── 60fps hot path: subscribe directly to Zustand store ──
      // This runs outside React's render cycle — no reconciliation overhead.
      unsubscribe = usePriceStore.subscribe((state) => {
        if (disposed || !seriesRef.current) return;
        if (state.tickVersion === lastTickVersionRef.current) return;
        lastTickVersionRef.current = state.tickVersion;

        const curSymbol = symbolRef.current;
        const curTf = timeframeRef.current;
        const curType = chartTypeRef.current;

        const arr = state.rawTicks.get(curSymbol);
        if (!arr || arr.length === 0) return;

        // First time we have real data — do full setData() to seed the chart
        if (!seededRef.current || arr.length < 3) {
          if (curType === "candlestick") {
            const candles = aggregateCandles(arr, curTf);
            if (candles.length > 0) {
              seriesRef.current.setData(
                candles.map((d) => ({ time: d.time as any, open: d.open, high: d.high, low: d.low, close: d.close })),
              );
              seededRef.current = true;
            }
          } else {
            const line = aggregateLine(arr, curTf);
            if (line.length > 0) {
              seriesRef.current.setData(
                line.map((d) => ({ time: d.time as any, value: d.value })),
              );
              seededRef.current = true;
            }
          }
          if (seededRef.current) {
            chart.timeScale().fitContent();
            chart.timeScale().scrollToRealTime();
          }
          return;
        }

        // Only compute the latest candle/point from recent ticks
        // instead of re-aggregating the entire array
        const lastTick = arr[arr.length - 1];
        const s = Math.floor(lastTick.time / 1000);
        const candleStart = s - (s % curTf);

        const isNewBar = candleStart !== lastCandleStartRef.current;
        lastCandleStartRef.current = candleStart;

        if (curType === "candlestick") {
          // Find all ticks in the current candle period
          let o = lastTick.price, h = lastTick.price, l = lastTick.price, c = lastTick.price;
          for (let i = arr.length - 1; i >= 0; i--) {
            const ts = Math.floor(arr[i].time / 1000);
            const cs = ts - (ts % curTf);
            if (cs !== candleStart) break;
            const p = arr[i].price;
            o = p; // earliest tick becomes open
            if (p > h) h = p;
            if (p < l) l = p;
          }
          seriesRef.current.update({
            time: candleStart as any,
            open: o, high: h, low: l, close: c,
          });
        } else {
          seriesRef.current.update({
            time: candleStart as any,
            value: lastTick.price,
          });
        }

        // Auto-scroll to real-time when a new bar appears
        if (isNewBar) {
          chart.timeScale().scrollToRealTime();
        }

        // Update price line
        if (priceLineRef.current) {
          try { seriesRef.current.removePriceLine(priceLineRef.current); } catch {}
          priceLineRef.current = null;
        }
        const asset = state.data?.assets.find((a) => a.symbol === curSymbol);
        const price = asset?.pythPrice;
        if (price && seriesRef.current) {
          priceLineRef.current = seriesRef.current.createPriceLine({
            price,
            color: "rgba(16, 185, 129, 0.4)",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
          });
        }
      });
    };

    initChart();

    return () => {
      disposed = true;
      if (unsubscribe) unsubscribe();
      if (chartRef.current) {
        const ro = (chartRef.current as any).__resizeObserver;
        if (ro) ro.disconnect();
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
        priceLineRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Cold path: symbol, timeframe, or chartType change (rare) ──
  useEffect(() => {
    if (!chartRef.current || !modulesRef.current || !seriesRef.current) return;

    const needsSeriesSwap = chartType !== prevChartTypeRef.current;
    prevChartTypeRef.current = chartType;
    const sym = symbol;
    const tf = timeframe;

    // Full data reset on symbol/timeframe/chartType change
    const rawTicks = usePriceStore.getState().rawTicks;
    const arr = rawTicks.get(sym) ?? [];
    seededRef.current = arr.length > 0; // Reset seed tracking

    if (needsSeriesSwap) {
      setupSeries(chartRef.current, modulesRef.current, chartType);
    }

    if (chartType === "candlestick") {
      const candles = aggregateCandles(arr, tf);
      seriesRef.current.setData(
        candles.map((d) => ({ time: d.time as any, open: d.open, high: d.high, low: d.low, close: d.close })),
      );
    } else {
      const line = aggregateLine(arr, tf);
      seriesRef.current.setData(
        line.map((d) => ({ time: d.time as any, value: d.value })),
      );
    }
    chartRef.current.timeScale().fitContent();
    chartRef.current.timeScale().scrollToRealTime();
    lastCandleStartRef.current = -1; // Reset bar tracking
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, chartType]);

  // Handle height changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height });
    }
  }, [height]);

  const formatPrice = useCallback((price: number) => {
    if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    return price.toPrecision(4);
  }, []);

  return (
    <div className={className} style={{ position: "relative" }}>
      {/* Overlay: symbol + current price */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 10,
          pointerEvents: "none",
          display: "flex",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span
          style={{
            color: "#888",
            fontSize: 12,
            fontFamily: "'Space Grotesk Variable', sans-serif",
            fontWeight: 500,
            letterSpacing: "0.02em",
          }}
        >
          {symbol}
        </span>
        {currentPrice !== undefined && (
          <span
            style={{
              color: "#fff",
              fontSize: 14,
              fontFamily: "'Space Grotesk Variable', sans-serif",
              fontWeight: 600,
            }}
          >
            ${formatPrice(currentPrice)}
          </span>
        )}
      </div>

      {/* Empty state */}
      {ticks.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5,
            color: "#555",
            fontSize: 13,
            fontFamily: "'Space Grotesk Variable', sans-serif",
          }}
        >
          Waiting for data...
        </div>
      )}

      {/* Chart container */}
      <div ref={containerRef} style={{ width: "100%", height }} />
    </div>
  );
}

export const TVChart = React.memo(TVChartInner);

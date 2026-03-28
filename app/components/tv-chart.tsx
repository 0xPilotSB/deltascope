import React, { useEffect, useRef, useCallback, useMemo } from "react";
import type { TickData } from "~/stores/price-store";
import { aggregateLine, aggregateCandles } from "~/stores/price-store";

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
  ticks: TickData[];
  currentPrice?: number;
  height?: number;
  className?: string;
  timeframe: number; // seconds
  chartType: ChartType;
}

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
  const prevSymbolRef = useRef<string>(symbol);
  const prevTimeframeRef = useRef<number>(timeframe);
  const prevChartTypeRef = useRef<ChartType>(chartType);
  const modulesRef = useRef<any>(null);

  // Aggregate ticks based on chart type
  const lineData = useMemo(
    () => (chartType === "line" ? aggregateLine(ticks, timeframe) : []),
    [ticks, timeframe, chartType],
  );

  const candleData = useMemo(
    () => (chartType === "candlestick" ? aggregateCandles(ticks, timeframe) : []),
    [ticks, timeframe, chartType],
  );

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
    },
  }), []);

  // Recreate series when chart type changes
  const setupSeries = useCallback((chart: any, modules: any, type: ChartType) => {
    // Remove old series
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
      priceLineRef.current = null;
    }

    if (type === "candlestick") {
      const series = chart.addSeries(modules.CandlestickSeries, {
        upColor: "#10b981",
        downColor: "#ef4444",
        borderUpColor: "#10b981",
        borderDownColor: "#ef4444",
        wickUpColor: "#10b981",
        wickDownColor: "#ef4444",
        priceLineVisible: false,
        lastValueVisible: true,
      });
      seriesRef.current = series;
    } else {
      const series = chart.addSeries(modules.LineSeries, {
        color: "#10b981",
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBackgroundColor: "#10b981",
        priceLineVisible: false,
        lastValueVisible: true,
      });
      seriesRef.current = series;
    }
  }, []);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;

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
      prevSymbolRef.current = symbol;
      prevTimeframeRef.current = timeframe;
      prevChartTypeRef.current = chartType;

      setupSeries(chart, modules, chartType);

      // Set initial data
      if (chartType === "candlestick" && candleData.length > 0) {
        seriesRef.current.setData(
          candleData.map((d) => ({ time: d.time as any, open: d.open, high: d.high, low: d.low, close: d.close })),
        );
      } else if (chartType === "line" && lineData.length > 0) {
        seriesRef.current.setData(
          lineData.map((d) => ({ time: d.time as any, value: d.value })),
        );
      }
      chart.timeScale().fitContent();

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
    };

    initChart();

    return () => {
      disposed = true;
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

  // Handle chart type change — swap series
  useEffect(() => {
    if (!chartRef.current || !modulesRef.current) return;
    if (chartType === prevChartTypeRef.current) return;

    prevChartTypeRef.current = chartType;
    setupSeries(chartRef.current, modulesRef.current, chartType);

    if (chartType === "candlestick" && candleData.length > 0) {
      seriesRef.current.setData(
        candleData.map((d) => ({ time: d.time as any, open: d.open, high: d.high, low: d.low, close: d.close })),
      );
    } else if (chartType === "line" && lineData.length > 0) {
      seriesRef.current.setData(
        lineData.map((d) => ({ time: d.time as any, value: d.value })),
      );
    }
    chartRef.current.timeScale().fitContent();

    // Re-add price line
    if (currentPrice && seriesRef.current) {
      priceLineRef.current = seriesRef.current.createPriceLine({
        price: currentPrice,
        color: "rgba(16, 185, 129, 0.4)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
      });
    }
  }, [chartType, candleData, lineData, currentPrice, setupSeries]);

  // Handle symbol or timeframe change — full data reset
  useEffect(() => {
    if (!seriesRef.current) return;
    if (symbol !== prevSymbolRef.current || timeframe !== prevTimeframeRef.current) {
      prevSymbolRef.current = symbol;
      prevTimeframeRef.current = timeframe;

      if (chartType === "candlestick") {
        seriesRef.current.setData(
          candleData.map((d) => ({ time: d.time as any, open: d.open, high: d.high, low: d.low, close: d.close })),
        );
      } else {
        seriesRef.current.setData(
          lineData.map((d) => ({ time: d.time as any, value: d.value })),
        );
      }
      chartRef.current?.timeScale().fitContent();
    }
  }, [symbol, timeframe, lineData, candleData, chartType]);

  // Handle data updates — incremental
  useEffect(() => {
    if (!seriesRef.current) return;
    if (symbol !== prevSymbolRef.current || timeframe !== prevTimeframeRef.current) return;

    if (chartType === "candlestick" && candleData.length > 0) {
      const latest = candleData[candleData.length - 1];
      seriesRef.current.update({
        time: latest.time as any,
        open: latest.open,
        high: latest.high,
        low: latest.low,
        close: latest.close,
      });
    } else if (chartType === "line" && lineData.length > 0) {
      const latest = lineData[lineData.length - 1];
      seriesRef.current.update({ time: latest.time as any, value: latest.value });
    }
  }, [lineData, candleData, symbol, timeframe, chartType]);

  // Handle price line updates
  useEffect(() => {
    if (!seriesRef.current) return;
    if (priceLineRef.current) {
      try {
        seriesRef.current.removePriceLine(priceLineRef.current);
      } catch { /* already removed */ }
      priceLineRef.current = null;
    }
    if (currentPrice) {
      priceLineRef.current = seriesRef.current.createPriceLine({
        price: currentPrice,
        color: "rgba(16, 185, 129, 0.4)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
      });
    }
  }, [currentPrice]);

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

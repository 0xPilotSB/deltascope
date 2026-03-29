import React, { useEffect, useRef } from "react";

export interface HistoricalMinute {
  t: number;
  pythP50: number; pythP95: number; pythP99: number; pythMax: number;
  hlRestP50: number; hlRestP95: number; hlRestMax: number;
  hlWsP50: number; hlWsP95: number; hlWsMax: number;
  publishDelayAvg: number; publishDelayMax: number;
  samples: number;
}

export interface SourceEvent {
  t: number;
  source: string;
  event: string;
  detail: string | null;
}

interface Props {
  minutes: HistoricalMinute[];
  height?: number;
  className?: string;
}

function HistoricalLatencyChartInner({ minutes, height = 300, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || minutes.length === 0) return;
    let disposed = false;

    const init = async () => {
      const { createChart, LineSeries } = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      // Clean up previous chart
      if (chartRef.current) {
        const ro = (chartRef.current as any).__ro;
        if (ro) ro.disconnect();
        chartRef.current.remove();
        chartRef.current = null;
      }

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height,
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
        crosshair: { mode: 0 },
        rightPriceScale: {
          borderColor: "rgba(255,255,255,0.05)",
        },
        timeScale: {
          borderColor: "rgba(255,255,255,0.05)",
          timeVisible: true,
          secondsVisible: false,
        },
      });

      // Pyth p50 (solid green)
      const pythP50 = chart.addSeries(LineSeries, {
        color: "#10b981",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "Pyth p50",
      });

      // Pyth p95 (dashed green — lighter)
      const pythP95 = chart.addSeries(LineSeries, {
        color: "rgba(16,185,129,0.5)",
        lineWidth: 1,
        lineStyle: 2, // dashed
        priceLineVisible: false,
        lastValueVisible: false,
        title: "Pyth p95",
      });

      // Pyth p99 (dotted green — lightest)
      const pythP99 = chart.addSeries(LineSeries, {
        color: "rgba(16,185,129,0.25)",
        lineWidth: 1,
        lineStyle: 3, // dotted
        priceLineVisible: false,
        lastValueVisible: false,
        title: "Pyth p99",
      });

      // HL REST p50 (solid blue)
      const hlP50 = chart.addSeries(LineSeries, {
        color: "#3b82f6",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "HL REST p50",
      });

      // HL REST p95 (dashed blue)
      const hlP95 = chart.addSeries(LineSeries, {
        color: "rgba(59,130,246,0.5)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        title: "HL REST p95",
      });

      // HL WS p50 (solid orange)
      const hlWsP50S = chart.addSeries(LineSeries, {
        color: "#f59e0b",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "HL WS p50",
      });

      // HL WS p95 (dashed orange)
      const hlWsP95S = chart.addSeries(LineSeries, {
        color: "rgba(245,158,11,0.5)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        title: "HL WS p95",
      });

      // Set data
      const toTime = (t: number) => Math.floor(t / 1000) as any;

      pythP50.setData(minutes.filter((m) => m.pythP50 > 0).map((m) => ({ time: toTime(m.t), value: m.pythP50 })));
      pythP95.setData(minutes.filter((m) => m.pythP95 > 0).map((m) => ({ time: toTime(m.t), value: m.pythP95 })));
      pythP99.setData(minutes.filter((m) => m.pythP99 > 0).map((m) => ({ time: toTime(m.t), value: m.pythP99 })));
      hlP50.setData(minutes.filter((m) => m.hlRestP50 > 0).map((m) => ({ time: toTime(m.t), value: m.hlRestP50 })));
      hlP95.setData(minutes.filter((m) => m.hlRestP95 > 0).map((m) => ({ time: toTime(m.t), value: m.hlRestP95 })));
      hlWsP50S.setData(minutes.filter((m) => m.hlWsP50 > 0).map((m) => ({ time: toTime(m.t), value: m.hlWsP50 })));
      hlWsP95S.setData(minutes.filter((m) => m.hlWsP95 > 0).map((m) => ({ time: toTime(m.t), value: m.hlWsP95 })));

      chart.timeScale().fitContent();
      chartRef.current = chart;

      // Resize
      const ro = new ResizeObserver((entries) => {
        if (disposed || !containerRef.current) return;
        chart.applyOptions({ width: entries[0].contentRect.width });
      });
      ro.observe(containerRef.current);
      (chart as any).__ro = ro;
    };

    init();

    return () => {
      disposed = true;
      if (chartRef.current) {
        const ro = (chartRef.current as any).__ro;
        if (ro) ro.disconnect();
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [minutes, height]);

  return (
    <div className={className} style={{ position: "relative" }}>
      {/* Legend */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 10,
          pointerEvents: "none",
          display: "flex",
          gap: 12,
          fontSize: 10,
          fontFamily: "'Space Grotesk Variable', sans-serif",
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "#10b981" }}>● Pyth p50</span>
        <span style={{ color: "rgba(16,185,129,0.5)" }}>┄ Pyth p95</span>
        <span style={{ color: "#3b82f6" }}>● HL REST p50</span>
        <span style={{ color: "rgba(59,130,246,0.5)" }}>┄ HL REST p95</span>
        <span style={{ color: "#f59e0b" }}>● HL WS p50</span>
        <span style={{ color: "rgba(245,158,11,0.5)" }}>┄ HL WS p95</span>
      </div>

      <div ref={containerRef} style={{ width: "100%", height }} />
    </div>
  );
}

export const HistoricalLatencyChart = React.memo(HistoricalLatencyChartInner);

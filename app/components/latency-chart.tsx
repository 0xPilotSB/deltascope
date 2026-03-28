import React, { useEffect, useRef } from "react";

export interface LatencySample {
  t: number;
  pyth: number;
  hlRest: number;
  hlWs: number;
  publishDelay: number;
  wsRtt: number;
}

interface LatencyChartProps {
  history: LatencySample[];
  height?: number;
  className?: string;
}

function LatencyChartInner({ history, height = 300, className }: LatencyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRefs = useRef<{ pyth: any; hlRest: any; hlWs: any }>({ pyth: null, hlRest: null, hlWs: null });

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    const init = async () => {
      const { createChart, LineSeries } = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

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
          secondsVisible: true,
        },
      });

      // Pyth Oracle Delay (green)
      const pythSeries = chart.addSeries(LineSeries, {
        color: "#10b981",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "Pyth",
      });

      // HL REST API (blue)
      const hlRestSeries = chart.addSeries(LineSeries, {
        color: "#3b82f6",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "HL API",
      });

      // HL WS Interval (orange)
      const hlWsSeries = chart.addSeries(LineSeries, {
        color: "#f59e0b",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "HL WS",
      });

      chartRef.current = chart;
      seriesRefs.current = { pyth: pythSeries, hlRest: hlRestSeries, hlWs: hlWsSeries };

      // Set initial data
      if (history.length > 0) {
        const pythData = history.map((s) => ({ time: Math.floor(s.t / 1000) as any, value: s.pyth || 0 }));
        const hlRestData = history.map((s) => ({ time: Math.floor(s.t / 1000) as any, value: s.hlRest || 0 }));
        const hlWsData = history.map((s) => ({ time: Math.floor(s.t / 1000) as any, value: s.hlWs || 0 }));
        pythSeries.setData(pythData);
        hlRestSeries.setData(hlRestData);
        hlWsSeries.setData(hlWsData);
        chart.timeScale().fitContent();
      }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data when history changes
  useEffect(() => {
    const { pyth, hlRest, hlWs } = seriesRefs.current;
    if (!pyth || !hlRest || !hlWs || history.length === 0) return;

    const pythData = history.map((s) => ({ time: Math.floor(s.t / 1000) as any, value: s.pyth || 0 }));
    const hlRestData = history.map((s) => ({ time: Math.floor(s.t / 1000) as any, value: s.hlRest || 0 }));
    const hlWsData = history.map((s) => ({ time: Math.floor(s.t / 1000) as any, value: s.hlWs || 0 }));

    pyth.setData(pythData);
    hlRest.setData(hlRestData);
    hlWs.setData(hlWsData);
    chartRef.current?.timeScale().fitContent();
  }, [history]);

  // Height changes
  useEffect(() => {
    if (chartRef.current) chartRef.current.applyOptions({ height });
  }, [height]);

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
          gap: 16,
          fontSize: 11,
          fontFamily: "'Space Grotesk Variable', sans-serif",
        }}
      >
        <span style={{ color: "#10b981" }}>● Pyth Oracle</span>
        <span style={{ color: "#3b82f6" }}>● HL REST API</span>
        <span style={{ color: "#f59e0b" }}>● HL WS Interval</span>
      </div>

      {history.length === 0 && (
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
          Collecting latency data...
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%", height }} />
    </div>
  );
}

export const LatencyChart = React.memo(LatencyChartInner);

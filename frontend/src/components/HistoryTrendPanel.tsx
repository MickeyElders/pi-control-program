import { useMemo } from "react";
import type { TankKey } from "../api";

export type HistorySample = {
  ts: number;
  values: Record<TankKey, { temp: number | null; ph: number | null; level: number | null }>;
};

export type TrendMetric = "temp" | "ph" | "level";
export type TrendRange = "30m" | "2h" | "24h";

export type HistoryTrendPanelProps = {
  samples: HistorySample[];
  metric: TrendMetric;
  tank: TankKey;
  range: TrendRange;
  onMetricChange: (metric: TrendMetric) => void;
  onTankChange: (tank: TankKey) => void;
  onRangeChange: (range: TrendRange) => void;
};

const RANGE_MS: Record<TrendRange, number> = {
  "30m": 30 * 60 * 1000,
  "2h": 2 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

const metricLabel: Record<TrendMetric, string> = {
  temp: "温度",
  ph: "pH",
  level: "液位",
};

const tankLabel: Record<TankKey, string> = {
  soak: "浸泡桶",
  fresh: "清水桶",
  heat: "加热桶",
};

const formatMetric = (metric: TrendMetric, value: number) => {
  if (metric === "temp") return `${value.toFixed(1)}°C`;
  if (metric === "ph") return value.toFixed(2);
  return `${Math.round(value)}%`;
};

const normalizeLevel = (value: number | null) => {
  if (!Number.isFinite(value)) return null;
  const num = Number(value);
  return num > 1 ? num : num * 100;
};

export default function HistoryTrendPanel({
  samples,
  metric,
  tank,
  range,
  onMetricChange,
  onTankChange,
  onRangeChange,
}: HistoryTrendPanelProps) {
  const filtered = useMemo(() => {
    const cutoff = Date.now() - RANGE_MS[range];
    return samples.filter((sample) => sample.ts >= cutoff);
  }, [samples, range]);

  const values = useMemo(() => {
    return filtered
      .map((sample) => {
        const reading = sample.values[tank];
        const raw = metric === "level" ? normalizeLevel(reading.level) : reading[metric];
        return raw;
      })
      .filter((value): value is number => Number.isFinite(value));
  }, [filtered, metric, tank]);

  const chart = useMemo(() => {
    const width = 860;
    const height = 240;
    if (filtered.length < 2 || values.length < 2) {
      return { path: "", area: "", min: 0, max: 0, latest: null as number | null };
    }

    const points: Array<{ x: number; y: number; v: number }> = [];
    const min = metric === "level" ? 0 : Math.min(...values);
    const max = metric === "level" ? 100 : Math.max(...values);
    const pad = min === max ? 1 : (max - min) * 0.15;
    const yMin = min - pad;
    const yMax = max + pad;

    filtered.forEach((sample, index) => {
      const reading = sample.values[tank];
      const raw = metric === "level" ? normalizeLevel(reading.level) : reading[metric];
      if (raw === null || !Number.isFinite(raw)) return;
      const value = Number(raw);
      const ratio = (value - yMin) / (yMax - yMin || 1);
      const x = (index / (filtered.length - 1 || 1)) * width;
      const y = height - ratio * height;
      points.push({ x, y, v: value });
    });

    if (points.length < 2) {
      return { path: "", area: "", min, max, latest: null as number | null };
    }

    const path = points.map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const area = `${path} L ${width},${height} L 0,${height} Z`;
    const latest = points[points.length - 1]?.v ?? null;
    return { path, area, min, max, latest };
  }, [filtered, values, metric, tank]);

  return (
    <section className="trend-zone">
      <div className="card-title">历史趋势</div>
      <div className="trend-toolbar">
        <div className="group">
          {(["temp", "ph", "level"] as TrendMetric[]).map((item) => (
            <button
              type="button"
              key={item}
              className={`mini-btn ${metric === item ? "active" : ""}`}
              onClick={() => onMetricChange(item)}
            >
              {metricLabel[item]}
            </button>
          ))}
        </div>
        <div className="group">
          {(["soak", "fresh", "heat"] as TankKey[]).map((item) => (
            <button
              type="button"
              key={item}
              className={`mini-btn ${tank === item ? "active" : ""}`}
              onClick={() => onTankChange(item)}
            >
              {tankLabel[item]}
            </button>
          ))}
        </div>
        <div className="group">
          {(["30m", "2h", "24h"] as TrendRange[]).map((item) => (
            <button
              type="button"
              key={item}
              className={`mini-btn ${range === item ? "active" : ""}`}
              onClick={() => onRangeChange(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="trend-chart-wrap">
        <svg viewBox="0 0 860 240" className="trend-chart">
          <defs>
            <linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(90, 228, 255, 0.45)" />
              <stop offset="100%" stopColor="rgba(90, 228, 255, 0.04)" />
            </linearGradient>
          </defs>
          <g>
            <line x1="0" y1="240" x2="860" y2="240" className="axis" />
            <line x1="0" y1="180" x2="860" y2="180" className="grid" />
            <line x1="0" y1="120" x2="860" y2="120" className="grid" />
            <line x1="0" y1="60" x2="860" y2="60" className="grid" />
          </g>
          {chart.area ? <path d={chart.area} className="trend-area" /> : null}
          {chart.path ? <path d={chart.path} className="trend-line" /> : null}
        </svg>
      </div>

      <div className="trend-stats">
        <span>当前：{chart.latest === null ? "--" : formatMetric(metric, chart.latest)}</span>
        <span>最小：{values.length ? formatMetric(metric, Math.min(...values)) : "--"}</span>
        <span>最大：{values.length ? formatMetric(metric, Math.max(...values)) : "--"}</span>
        <span>样本：{filtered.length}</span>
      </div>
    </section>
  );
}

import { useMemo } from "react";
import type { TankKey } from "../api";

export type HistorySample = {
  ts: number;
  values: Record<TankKey, { temp: number | null; ph: number | null; level: number | null }>;
};

type TrendMetric = "temp" | "ph" | "level";

export type HistoryTrendPanelProps = {
  samples: HistorySample[];
};

const RANGE_MS = 2 * 60 * 60 * 1000;
const CHART_W = 860;
const ROW_H = 74;
const ROW_GAP = 8;

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

const tankColor: Record<TankKey, string> = {
  soak: "#8cf1b5",
  fresh: "#76d4ff",
  heat: "#ffbe87",
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

const readMetric = (sample: HistorySample, tank: TankKey, metric: TrendMetric) => {
  const raw = sample.values[tank][metric];
  if (metric === "level") return normalizeLevel(raw);
  return raw;
};

export default function HistoryTrendPanel({ samples }: HistoryTrendPanelProps) {
  const filtered = useMemo(() => {
    const cutoff = Date.now() - RANGE_MS;
    return samples.filter((sample) => sample.ts >= cutoff);
  }, [samples]);

  const chartRows = useMemo(() => {
    return (["temp", "ph", "level"] as TrendMetric[]).map((metric) => {
      const allValues: number[] = [];
      for (const tank of ["soak", "fresh", "heat"] as TankKey[]) {
        for (const sample of filtered) {
          const value = readMetric(sample, tank, metric);
          if (Number.isFinite(value)) allValues.push(Number(value));
        }
      }
      const minValue = metric === "level" ? 0 : (allValues.length ? Math.min(...allValues) : 0);
      const maxValue = metric === "level" ? 100 : (allValues.length ? Math.max(...allValues) : 1);
      const pad = minValue === maxValue ? 1 : (maxValue - minValue) * 0.15;
      const yMin = minValue - pad;
      const yMax = maxValue + pad;

      const series = (["soak", "fresh", "heat"] as TankKey[]).map((tank) => {
        const points: string[] = [];
        const values: number[] = [];
        filtered.forEach((sample, index) => {
          const value = readMetric(sample, tank, metric);
          if (!Number.isFinite(value)) return;
          const numeric = Number(value);
          const x = (index / (Math.max(filtered.length - 1, 1))) * CHART_W;
          const ratio = (numeric - yMin) / (yMax - yMin || 1);
          const y = ROW_H - ratio * ROW_H;
          points.push(`${points.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
          values.push(numeric);
        });
        return {
          tank,
          path: points.join(" "),
          latest: values.length ? values[values.length - 1] : null,
        };
      });

      return {
        metric,
        min: allValues.length ? Math.min(...allValues) : null,
        max: allValues.length ? Math.max(...allValues) : null,
        series,
      };
    });
  }, [filtered]);

  const latestText = useMemo(() => {
    return (["temp", "ph", "level"] as TrendMetric[]).map((metric) => {
      const parts = (["soak", "fresh", "heat"] as TankKey[]).map((tank) => {
        const latest = chartRows.find((row) => row.metric === metric)?.series.find((s) => s.tank === tank)?.latest;
        return `${tankLabel[tank]} ${Number.isFinite(latest) ? formatMetric(metric, Number(latest)) : "--"}`;
      });
      return `${metricLabel[metric]}: ${parts.join(" / ")}`;
    });
  }, [chartRows]);

  const chartHeight = ROW_H * 3 + ROW_GAP * 2;

  return (
    <section className="trend-zone">
      <div className="card-title">历史趋势（最近2小时，全量展示）</div>
      <div className="trend-legend">
        {(["soak", "fresh", "heat"] as TankKey[]).map((tank) => (
          <span className="legend-item" key={tank}>
            <i style={{ background: tankColor[tank] }} />
            {tankLabel[tank]}
          </span>
        ))}
      </div>

      <div className="trend-chart-wrap">
        <svg viewBox={`0 0 ${CHART_W} ${chartHeight}`} className="trend-chart">
          {chartRows.map((row, rowIndex) => {
            const yBase = rowIndex * (ROW_H + ROW_GAP);
            return (
              <g key={row.metric} transform={`translate(0 ${yBase})`}>
                <line x1="0" y1={ROW_H} x2={CHART_W} y2={ROW_H} className="axis" />
                <line x1="0" y1={ROW_H / 2} x2={CHART_W} y2={ROW_H / 2} className="grid" />
                <line x1="0" y1={ROW_H / 4} x2={CHART_W} y2={ROW_H / 4} className="grid" />
                <text className="metric-tag" x="8" y="14">
                  {metricLabel[row.metric]}
                </text>
                {row.series.map((series) =>
                  series.path ? (
                    <path
                      key={`${row.metric}-${series.tank}`}
                      d={series.path}
                      className="trend-line"
                      stroke={tankColor[series.tank]}
                    />
                  ) : null
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="trend-stats">
        {latestText.map((text) => (
          <span key={text}>{text}</span>
        ))}
        <span>样本：{filtered.length}</span>
        <span>
          统计范围：
          {chartRows
            .map((row) => `${metricLabel[row.metric]} ${row.min === null ? "--" : formatMetric(row.metric, row.min)}~${row.max === null ? "--" : formatMetric(row.metric, row.max)}`)
            .join(" | ")}
        </span>
      </div>
    </section>
  );
}

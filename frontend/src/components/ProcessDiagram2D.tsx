import { type CSSProperties } from "react";
import type { TankKey, TankReading } from "../api";

export type ProcessDiagram2DProps = {
  tanks: Partial<Record<TankKey, TankReading>>;
  flows: {
    pump1: boolean;
    pump2: boolean;
    pump3: boolean;
    valveFresh: boolean;
    valveHeat: boolean;
  };
  alarms: {
    comm: boolean;
    soak: boolean;
    fresh: boolean;
    heat: boolean;
  };
};

const formatValue = (value: number | null | undefined, digits: number) => {
  if (!Number.isFinite(value)) return "--";
  return Number(value).toFixed(digits);
};

const normalizeLevel = (value: number | null | undefined) => {
  if (!Number.isFinite(value)) return 0;
  const numeric = Number(value);
  const normalized = numeric > 1 ? numeric : numeric * 100;
  return Math.max(0, Math.min(100, normalized));
};

const pickColor = (reading?: TankReading | null) => {
  if (reading?.color && reading.color.length === 3) {
    return `rgb(${reading.color[0]}, ${reading.color[1]}, ${reading.color[2]})`;
  }
  return "rgb(70, 160, 220)";
};

const Tank = ({
  kind,
  label,
  reading,
  running,
  alarm,
}: {
  kind: "fresh" | "heat" | "soak";
  label: string;
  reading?: TankReading;
  running: boolean;
  alarm: boolean;
}) => {
  const levelValue = reading?.level;
  const level = normalizeLevel(levelValue);
  const levelText = Number.isFinite(levelValue) ? `${Math.round(level)}%` : "--";
  const style = {
    "--level": `${level}%`,
    "--water-color": pickColor(reading),
  } as CSSProperties;

  return (
    <div className={`tank ${kind}`} style={style}>
      <div className={`tank-model ${running ? "running" : ""} ${alarm ? "alarm" : ""}`}>
        <div className="tank-rim top" />
        <div className="tank-column">
          <div className="tank-liquid">
            <div className="tank-liquid-fill" />
            <div className="tank-liquid-top" />
            <div className="tank-wave one" />
            <div className="tank-wave two" />
          </div>
          <div className="tank-glass-glow" />
        </div>
        <div className="tank-rim bottom" />
        <div className="tank-port left" />
        <div className="tank-port right" />
      </div>
      <div className="tank-label">{label}</div>
      <div className="tank-metrics">
        <div className="metric">液位 {levelText}</div>
        <div className="metric">温度 {formatValue(reading?.temp, 1)}°C</div>
        <div className="metric">pH {formatValue(reading?.ph, 2)}</div>
      </div>
    </div>
  );
};

export default function ProcessDiagram2D({ tanks, flows, alarms }: ProcessDiagram2DProps) {
  const valveFreshOn = flows.pump3 && flows.valveFresh;
  const valveHeatOn = flows.pump3 && flows.valveHeat;
  const freshRunning = flows.pump1 || valveFreshOn;
  const heatRunning = flows.pump2 || valveHeatOn;
  const soakRunning = flows.pump1 || flows.pump2 || valveFreshOn || valveHeatOn;

  return (
    <div className="process-board">
      <svg className="pipe-layer" viewBox="0 0 1440 1600" preserveAspectRatio="none">
        <defs>
          <linearGradient id="pipeBaseGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1d3a57" />
            <stop offset="100%" stopColor="#0f243d" />
          </linearGradient>
          <linearGradient id="pipeGlowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#66ecff" />
            <stop offset="100%" stopColor="#1f7bff" />
          </linearGradient>
          <marker id="pipeArrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
            <path d="M0,0 L8,4.5 L0,9 Z" fill="#9af1ff" />
          </marker>
        </defs>

        <path className="pipe-base" d="M1040 430 C1040 540 940 580 880 600" />
        <path className="pipe-shell" d="M1040 430 C1040 540 940 580 880 600" />
        <path
          className={`pipe-flow ${flows.pump1 ? "on" : ""}`}
          markerEnd={flows.pump1 ? "url(#pipeArrow)" : undefined}
          d="M1040 430 C1040 540 940 580 880 600"
        />

        <path className="pipe-base" d="M400 430 C400 540 500 580 560 600" />
        <path className="pipe-shell" d="M400 430 C400 540 500 580 560 600" />
        <path
          className={`pipe-flow ${flows.pump2 ? "on" : ""}`}
          markerEnd={flows.pump2 ? "url(#pipeArrow)" : undefined}
          d="M400 430 C400 540 500 580 560 600"
        />

        <path className="pipe-base" d="M820 700 C920 520 980 440 1040 280" />
        <path className="pipe-shell" d="M820 700 C920 520 980 440 1040 280" />
        <path
          className={`pipe-flow ${valveFreshOn ? "on" : ""}`}
          markerEnd={valveFreshOn ? "url(#pipeArrow)" : undefined}
          d="M820 700 C920 520 980 440 1040 280"
        />

        <path className="pipe-base" d="M620 700 C520 520 460 440 400 280" />
        <path className="pipe-shell" d="M620 700 C520 520 460 440 400 280" />
        <path
          className={`pipe-flow ${valveHeatOn ? "on" : ""}`}
          markerEnd={valveHeatOn ? "url(#pipeArrow)" : undefined}
          d="M620 700 C520 520 460 440 400 280"
        />
      </svg>

      <div className={`flow-tag a ${flows.pump1 ? "on" : ""}`}>A 清水桶 → 浸泡桶</div>
      <div className={`flow-tag b ${flows.pump2 ? "on" : ""}`}>B 加热桶 → 浸泡桶</div>
      <div className={`flow-tag c ${valveFreshOn ? "on" : ""}`}>C 浸泡桶 → 清水桶</div>
      <div className={`flow-tag d ${valveHeatOn ? "on" : ""}`}>D 浸泡桶 → 加热桶</div>

      <Tank
        kind="fresh"
        label="清水桶"
        reading={tanks.fresh}
        running={freshRunning}
        alarm={alarms.fresh}
      />
      <Tank
        kind="heat"
        label="加热桶"
        reading={tanks.heat}
        running={heatRunning}
        alarm={alarms.heat}
      />
      <Tank
        kind="soak"
        label="浸泡桶"
        reading={tanks.soak}
        running={soakRunning}
        alarm={alarms.soak}
      />
    </div>
  );
}

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

const ActuatorNode = ({
  kind,
  label,
  on,
  style,
}: {
  kind: "pump" | "valve";
  label: string;
  on: boolean;
  style: CSSProperties;
}) => {
  return (
    <div className={`actuator ${kind} ${on ? "on" : "off"}`} style={style}>
      <div className={`machine ${kind}`}>
        {kind === "pump" ? (
          <>
            <span className="pump-foot" />
            <span className="pump-motor" />
            <span className="pump-fan" />
            <span className="pump-port left" />
            <span className="pump-port right" />
          </>
        ) : (
          <>
            <span className="valve-body" />
            <span className="valve-stem" />
            <span className="valve-wheel" />
            <span className="valve-port left" />
            <span className="valve-port right" />
          </>
        )}
      </div>
      <div className="actuator-meta">
        <span className="name">{label}</span>
        <span className={`lamp ${on ? "on" : "off"}`} />
      </div>
    </div>
  );
};

export default function ProcessDiagram2D({ tanks, flows, alarms }: ProcessDiagram2DProps) {
  const valveFreshOn = flows.pump3 && flows.valveFresh;
  const valveHeatOn = flows.pump3 && flows.valveHeat;
  const inletFreshValveOn = flows.pump1;
  const inletHeatValveOn = flows.pump2;
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
          <marker id="pipeArrow" markerWidth="10" markerHeight="10" refX="7" refY="5" orient="auto">
            <path d="M0,0 L9,5 L0,10 Z" fill="#a8f5ff" />
          </marker>
        </defs>

        <path className="pipe-base" d="M1040 432 L1040 560 L860 560 L860 648" />
        <path className="pipe-shell" d="M1040 432 L1040 560 L860 560 L860 648" />
        <path
          className={`pipe-flow ${flows.pump1 ? "on" : ""}`}
          markerEnd={flows.pump1 ? "url(#pipeArrow)" : undefined}
          d="M1040 432 L1040 560 L860 560 L860 648"
        />

        <path className="pipe-base" d="M400 432 L400 560 L580 560 L580 648" />
        <path className="pipe-shell" d="M400 432 L400 560 L580 560 L580 648" />
        <path
          className={`pipe-flow ${flows.pump2 ? "on" : ""}`}
          markerEnd={flows.pump2 ? "url(#pipeArrow)" : undefined}
          d="M400 432 L400 560 L580 560 L580 648"
        />

        <path className="pipe-base" d="M720 1216 L720 1280 L720 1320" />
        <path className="pipe-shell" d="M720 1216 L720 1280 L720 1320" />
        <path
          className={`pipe-flow ${flows.pump3 ? "on" : ""}`}
          markerEnd={flows.pump3 ? "url(#pipeArrow)" : undefined}
          d="M720 1216 L720 1280 L720 1320"
        />

        <path className="pipe-base" d="M720 1320 L1040 1320 L1040 300 L1060 300" />
        <path className="pipe-shell" d="M720 1320 L1040 1320 L1040 300 L1060 300" />
        <path
          className={`pipe-flow ${valveFreshOn ? "on" : ""}`}
          markerEnd={valveFreshOn ? "url(#pipeArrow)" : undefined}
          d="M720 1320 L1040 1320 L1040 300 L1060 300"
        />

        <path className="pipe-base" d="M720 1320 L400 1320 L400 300 L380 300" />
        <path className="pipe-shell" d="M720 1320 L400 1320 L400 300 L380 300" />
        <path
          className={`pipe-flow ${valveHeatOn ? "on" : ""}`}
          markerEnd={valveHeatOn ? "url(#pipeArrow)" : undefined}
          d="M720 1320 L400 1320 L400 300 L380 300"
        />

        <circle className="pipe-joint" cx="1040" cy="560" r="8" />
        <circle className="pipe-joint" cx="860" cy="560" r="8" />
        <circle className="pipe-joint" cx="400" cy="560" r="8" />
        <circle className="pipe-joint" cx="580" cy="560" r="8" />
        <circle className="pipe-joint" cx="720" cy="1280" r="8" />
        <circle className="pipe-joint" cx="720" cy="1320" r="8" />
        <circle className="pipe-joint" cx="1040" cy="1320" r="8" />
        <circle className="pipe-joint" cx="400" cy="1320" r="8" />
      </svg>

      <div className={`flow-tag a ${flows.pump1 ? "on" : ""}`}>A 清水桶 → 浸泡桶</div>
      <div className={`flow-tag b ${flows.pump2 ? "on" : ""}`}>B 加热桶 → 浸泡桶</div>
      <div className={`flow-tag c ${valveFreshOn ? "on" : ""}`}>C 浸泡桶 → 清水桶</div>
      <div className={`flow-tag d ${valveHeatOn ? "on" : ""}`}>D 浸泡桶 → 加热桶</div>

      <ActuatorNode kind="pump" label="P1" on={flows.pump1} style={{ left: 1007, top: 476 }} />
      <ActuatorNode kind="valve" label="V3" on={inletFreshValveOn} style={{ left: 878, top: 532 }} />
      <ActuatorNode kind="pump" label="P2" on={flows.pump2} style={{ left: 367, top: 476 }} />
      <ActuatorNode kind="valve" label="V4" on={inletHeatValveOn} style={{ left: 496, top: 532 }} />
      <ActuatorNode kind="pump" label="P3" on={flows.pump3} style={{ left: 687, top: 1240 }} />
      <ActuatorNode kind="valve" label="V1" on={valveFreshOn} style={{ left: 970, top: 1278 }} />
      <ActuatorNode kind="valve" label="V2" on={valveHeatOn} style={{ left: 367, top: 1278 }} />

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

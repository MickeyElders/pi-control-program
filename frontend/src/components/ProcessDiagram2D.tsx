import { type CSSProperties } from "react";
import type { AutoSwitchKey, LiftState, TankKey, TankReading } from "../api";

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
  heaterOn: boolean;
  heaterConfigured: boolean;
  liftState: LiftState;
  liftEstimatedMm: number;
  liftEstimatedPercent: number;
  online: boolean;
  valveConfigured: boolean;
  busy: Record<string, boolean>;
  onTogglePump: (index: number, next: boolean) => void;
  onToggleValve: (which: AutoSwitchKey, next: boolean) => void;
  onToggleHeater: (next: boolean) => void;
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
  onToggle,
  disabled,
}: {
  kind: "pump" | "valve";
  label: string;
  on: boolean;
  style: CSSProperties;
  onToggle?: () => void;
  disabled?: boolean;
}) => {
  const className = `actuator ${kind} ${on ? "on" : "off"} ${onToggle ? "clickable" : ""}`;
  const machine = (
    <>
      <div className={`machine ${kind}`}>
        {kind === "pump" ? (
          <>
            <span className="pump-skid" />
            <span className="pump-motor" />
            <span className="pump-ribs" />
            <span className="pump-endcap" />
            <span className="pump-coupling" />
            <span className="pump-volute" />
            <span className="pump-port left" />
            <span className="pump-port right" />
            <span className="pump-bolt a" />
            <span className="pump-bolt b" />
          </>
        ) : (
          <>
            <span className="valve-pedestal" />
            <span className="valve-flange left" />
            <span className="valve-flange right" />
            <span className="valve-main" />
            <span className="valve-neck" />
            <span className="valve-bonnet" />
            <span className="valve-stem" />
            <span className="valve-wheel-ring" />
            <span className="valve-wheel-spoke s1" />
            <span className="valve-wheel-spoke s2" />
            <span className="valve-wheel-spoke s3" />
            <span className="valve-wheel-spoke s4" />
            <span className="valve-bolt a" />
            <span className="valve-bolt b" />
          </>
        )}
      </div>
      <div className="actuator-meta">
        <span className="name">{label}</span>
        <span className={`lamp ${on ? "on" : "off"}`} />
      </div>
    </>
  );

  if (onToggle) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        onClick={onToggle}
        disabled={disabled}
        title={disabled ? `${label} 不可操作` : `点击切换 ${label}`}
      >
        {machine}
      </button>
    );
  }

  return (
    <div className={className} style={style}>
      {machine}
    </div>
  );
};

export default function ProcessDiagram2D({
  tanks,
  flows,
  alarms,
  heaterOn,
  heaterConfigured,
  liftState,
  liftEstimatedMm,
  liftEstimatedPercent,
  online,
  valveConfigured,
  busy,
  onTogglePump,
  onToggleValve,
  onToggleHeater,
}: ProcessDiagram2DProps) {
  const valveFreshOn = flows.pump3 && flows.valveFresh;
  const valveHeatOn = flows.pump3 && flows.valveHeat;
  const inletFreshValveOn = flows.pump1;
  const inletHeatValveOn = flows.pump2;
  const freshRunning = flows.pump1 || valveFreshOn;
  const heatRunning = flows.pump2 || valveHeatOn;
  const soakRunning = flows.pump1 || flows.pump2 || valveFreshOn || valveHeatOn;
  const heaterBusy = Boolean(busy["heater"]);
  const heaterDisabled = !online || !heaterConfigured || heaterBusy;
  const liftOffsetPx = 50 - (Math.max(0, Math.min(100, liftEstimatedPercent)) / 100) * 100;
  const liftCableHeight = Math.max(120, 164 + liftOffsetPx);

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

        <path className="pipe-base" d="M1040 432 L1040 560 L900 560 L900 700 L840 700" />
        <path className="pipe-shell" d="M1040 432 L1040 560 L900 560 L900 700 L840 700" />
        <path
          className={`pipe-flow ${flows.pump2 ? "on" : ""}`}
          markerEnd={flows.pump2 ? "url(#pipeArrow)" : undefined}
          d="M1040 432 L1040 560 L900 560 L900 700 L840 700"
        />

        <path className="pipe-base" d="M400 432 L400 560 L540 560 L540 700 L600 700" />
        <path className="pipe-shell" d="M400 432 L400 560 L540 560 L540 700 L600 700" />
        <path
          className={`pipe-flow ${flows.pump1 ? "on" : ""}`}
          markerEnd={flows.pump1 ? "url(#pipeArrow)" : undefined}
          d="M400 432 L400 560 L540 560 L540 700 L600 700"
        />

        <path className="pipe-base" d="M720 1216 L720 1340" />
        <path className="pipe-shell" d="M720 1216 L720 1340" />
        <path
          className={`pipe-flow ${flows.pump3 ? "on" : ""}`}
          markerEnd={flows.pump3 ? "url(#pipeArrow)" : undefined}
          d="M720 1216 L720 1340"
        />

        <path className="pipe-base" d="M720 1340 L1240 1340 L1240 320 L1210 320" />
        <path className="pipe-shell" d="M720 1340 L1240 1340 L1240 320 L1210 320" />
        <path
          className={`pipe-flow ${valveHeatOn ? "on" : ""}`}
          markerEnd={valveHeatOn ? "url(#pipeArrow)" : undefined}
          d="M720 1340 L1240 1340 L1240 320 L1210 320"
        />

        <path className="pipe-base" d="M720 1340 L200 1340 L200 320 L230 320" />
        <path className="pipe-shell" d="M720 1340 L200 1340 L200 320 L230 320" />
        <path
          className={`pipe-flow ${valveFreshOn ? "on" : ""}`}
          markerEnd={valveFreshOn ? "url(#pipeArrow)" : undefined}
          d="M720 1340 L200 1340 L200 320 L230 320"
        />

        <path className="pipe-base heater-link" d="M1278 410 L1218 410 L1218 348 L1130 348" />
        <path className="pipe-shell heater-link" d="M1278 410 L1218 410 L1218 348 L1130 348" />
        <path
          className={`pipe-flow heater-flow ${heaterOn ? "on" : ""}`}
          markerEnd={heaterOn ? "url(#pipeArrow)" : undefined}
          d="M1278 410 L1218 410 L1218 348 L1130 348"
        />

        <path className="pipe-base heater-link" d="M1130 376 L1198 376 L1198 440 L1278 440" />
        <path className="pipe-shell heater-link" d="M1130 376 L1198 376 L1198 440 L1278 440" />
        <path
          className={`pipe-flow heater-flow ${heaterOn ? "on" : ""}`}
          markerEnd={heaterOn ? "url(#pipeArrow)" : undefined}
          d="M1130 376 L1198 376 L1198 440 L1278 440"
        />

        <circle className="pipe-joint" cx="1040" cy="560" r="8" />
        <circle className="pipe-joint" cx="900" cy="560" r="8" />
        <circle className="pipe-joint" cx="900" cy="700" r="8" />
        <circle className="pipe-joint" cx="400" cy="560" r="8" />
        <circle className="pipe-joint" cx="540" cy="560" r="8" />
        <circle className="pipe-joint" cx="540" cy="700" r="8" />
        <circle className="pipe-joint" cx="720" cy="1340" r="8" />
        <circle className="pipe-joint" cx="1240" cy="1340" r="8" />
        <circle className="pipe-joint" cx="200" cy="1340" r="8" />
      </svg>

      <div className={`flow-tag a ${flows.pump1 ? "on" : ""}`}>A 清水桶 → 浸泡桶</div>
      <div className={`flow-tag b ${flows.pump2 ? "on" : ""}`}>B 加热桶 → 浸泡桶</div>
      <div className={`flow-tag c ${valveFreshOn ? "on" : ""}`}>C 浸泡桶 → 清水桶</div>
      <div className={`flow-tag d ${valveHeatOn ? "on" : ""}`}>D 浸泡桶 → 加热桶</div>

      <ActuatorNode
        kind="pump"
        label="P1"
        on={flows.pump1}
        style={{ left: 367, top: 476 }}
        onToggle={() => onTogglePump(0, !flows.pump1)}
        disabled={!online || Boolean(busy["relay-0"])}
      />
      <ActuatorNode kind="valve" label="V3" on={inletFreshValveOn} style={{ left: 493, top: 670 }} />
      <ActuatorNode
        kind="pump"
        label="P2"
        on={flows.pump2}
        style={{ left: 1007, top: 476 }}
        onToggle={() => onTogglePump(1, !flows.pump2)}
        disabled={!online || Boolean(busy["relay-1"])}
      />
      <ActuatorNode kind="valve" label="V4" on={inletHeatValveOn} style={{ left: 853, top: 670 }} />
      <ActuatorNode
        kind="pump"
        label="P3"
        on={flows.pump3}
        style={{ left: 687, top: 1260 }}
        onToggle={() => onTogglePump(2, !flows.pump3)}
        disabled={!online || Boolean(busy["relay-2"])}
      />
      <ActuatorNode
        kind="valve"
        label="V1"
        on={valveFreshOn}
        style={{ left: 153, top: 1278 }}
        onToggle={() => onToggleValve("fresh", !flows.valveFresh)}
        disabled={!online || !valveConfigured || Boolean(busy["auto-fresh"])}
      />
      <ActuatorNode
        kind="valve"
        label="V2"
        on={valveHeatOn}
        style={{ left: 1193, top: 1278 }}
        onToggle={() => onToggleValve("heat", !flows.valveHeat)}
        disabled={!online || !valveConfigured || Boolean(busy["auto-heat"])}
      />

      <button
        type="button"
        className={`heater-unit ${heaterOn ? "on" : "off"} ${heaterDisabled ? "disabled" : "clickable"}`}
        disabled={heaterDisabled}
        onClick={() => onToggleHeater(!heaterOn)}
        title={heaterDisabled ? "加热器不可操作" : heaterOn ? "停止加热" : "开始加热"}
      >
        <div className="heater-core" />
        <div className="heater-grill" />
        <div className="heater-lamp" />
        <div className="heater-label">HEATER</div>
      </button>

      <div className={`lift-visual ${liftState}`}>
        <div className="lift-top-unit">
          <span className="motor" />
          <span className="drum" />
        </div>
        <div className="lift-track left" />
        <div className="lift-track right" />
        <div className="lift-cable left" style={{ height: `${liftCableHeight}px` }} />
        <div className="lift-cable right" style={{ height: `${liftCableHeight}px` }} />
        <div className="lift-basket" style={{ transform: `translateY(${liftOffsetPx.toFixed(1)}px)` }}>
          <span className="basket-grid" />
          <span className="basket-hook left" />
          <span className="basket-hook right" />
        </div>
        <div className={`lift-arrow up ${liftState === "up" ? "on" : ""}`}>↑↑</div>
        <div className={`lift-arrow down ${liftState === "down" ? "on" : ""}`}>↓↓</div>
        <div className="lift-readout">
          <span>升降状态：{liftState === "up" ? "上升" : liftState === "down" ? "下降" : "停止"}</span>
          <span>位置(估算)：{liftEstimatedPercent}% / {Math.round(liftEstimatedMm)}mm</span>
        </div>
      </div>

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

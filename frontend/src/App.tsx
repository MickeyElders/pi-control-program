import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchStatus,
  resolveApiBase,
  resolvePollMs,
  setAutoSwitch,
  setHeater,
  setLift,
  setRelay,
  type AutoSwitchKey,
  type StatusResponse,
  type TankKey,
  type TankReading,
} from "./api";
import HeaterCard from "./components/HeaterCard";
import LiftPanel from "./components/LiftPanel";
import ProcessDiagram2D from "./components/ProcessDiagram2D";
import PumpDeck, { type PumpItem } from "./components/PumpDeck";

const DEFAULT_LEVELS: Record<TankKey, number> = {
  soak: 72,
  fresh: 58,
  heat: 46,
};

const DEFAULT_TEMPS: Record<TankKey, number> = {
  soak: 32.5,
  fresh: 22.0,
  heat: 45.0,
};

const DEFAULT_PHS: Record<TankKey, number> = {
  soak: 6.8,
  fresh: 7.2,
  heat: 6.5,
};

const DEFAULT_COLORS: Record<TankKey, [number, number, number]> = {
  soak: [88, 168, 140],
  fresh: [70, 160, 220],
  heat: [90, 150, 235],
};

const DEFAULT_TANK_READINGS: Record<TankKey, TankReading> = {
  soak: {
    temp: DEFAULT_TEMPS.soak,
    ph: DEFAULT_PHS.soak,
    level: DEFAULT_LEVELS.soak,
    color: DEFAULT_COLORS.soak,
  },
  fresh: {
    temp: DEFAULT_TEMPS.fresh,
    ph: DEFAULT_PHS.fresh,
    level: DEFAULT_LEVELS.fresh,
    color: DEFAULT_COLORS.fresh,
  },
  heat: {
    temp: DEFAULT_TEMPS.heat,
    ph: DEFAULT_PHS.heat,
    level: DEFAULT_LEVELS.heat,
    color: DEFAULT_COLORS.heat,
  },
};

const DEFAULT_STATUS: StatusResponse = {
  relays: [
    { index: 0, pin: 0, on: false },
    { index: 1, pin: 0, on: false },
    { index: 2, pin: 0, on: false },
  ],
  auto: {
    fresh: false,
    heat: false,
    configured: false,
  },
  lift: {
    configured: false,
    state: "stop",
  },
  heater: {
    configured: false,
    on: false,
  },
  tank: {
    soak: DEFAULT_TANK_READINGS.soak,
    fresh: DEFAULT_TANK_READINGS.fresh,
    heat: DEFAULT_TANK_READINGS.heat,
  },
};

const getRelayOn = (status: StatusResponse | null, index: number) =>
  status?.relays?.find((relay) => relay.index === index)?.on ?? false;

const hasTankAlarm = (reading?: TankReading) => {
  if (!reading) return false;
  const temp = reading.temp;
  const ph = reading.ph;
  const level = reading.level;
  const highTemp = Number.isFinite(temp) && Number(temp) > 55;
  const lowTemp = Number.isFinite(temp) && Number(temp) < 5;
  const lowPh = Number.isFinite(ph) && Number(ph) < 6.0;
  const highPh = Number.isFinite(ph) && Number(ph) > 8.5;
  const lowLevel =
    Number.isFinite(level) &&
    (Number(level) > 1 ? Number(level) : Number(level) * 100) < 15;
  return highTemp || lowTemp || lowPh || highPh || lowLevel;
};

const pumpMeta = [
  { index: 0, title: "1号水泵", route: "清水桶 → 浸泡桶" },
  { index: 1, title: "2号水泵", route: "加热桶 → 浸泡桶" },
  { index: 2, title: "3号水泵", route: "浸泡桶 → 自动阀" },
];

export default function App() {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const apiBase = useMemo(() => resolveApiBase(), []);
  const pollMs = useMemo(() => resolvePollMs(), []);

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const setBusyFlag = useCallback((key: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [key]: value }));
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await fetchStatus(apiBase);
      setStatus(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError("后端离线");
      setLastUpdated(null);
    }
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const loop = async () => {
      if (!active) return;
      await refreshStatus();
      timer = window.setTimeout(loop, pollMs);
    };

    loop();

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [pollMs, refreshStatus]);

  const isOnline = Boolean(status) && !error;
  const effectiveStatus = isOnline ? status : DEFAULT_STATUS;

  const tankReadings: Partial<Record<TankKey, TankReading>> = {
    soak: effectiveStatus?.tank?.soak,
    fresh: effectiveStatus?.tank?.fresh,
    heat: effectiveStatus?.tank?.heat,
  };

  const flows = {
    pump1: getRelayOn(effectiveStatus, 0),
    pump2: getRelayOn(effectiveStatus, 1),
    pump3: getRelayOn(effectiveStatus, 2),
    valveFresh: effectiveStatus?.auto?.fresh ?? false,
    valveHeat: effectiveStatus?.auto?.heat ?? false,
  };

  const pumps: PumpItem[] = pumpMeta.map((meta) => {
    const relay = effectiveStatus?.relays?.find((item) => item.index === meta.index);
    return {
      ...meta,
      on: relay?.on ?? false,
      gpio: relay?.pin,
    };
  });

  const autoStatus = effectiveStatus?.auto ?? { fresh: false, heat: false, configured: false };
  const liftState = effectiveStatus?.lift?.state ?? "stop";
  const heaterConfigured = effectiveStatus?.heater?.configured !== false;
  const heaterOn = effectiveStatus?.heater?.on ?? false;
  const alarms = {
    comm: !isOnline,
    soak: hasTankAlarm(tankReadings.soak),
    fresh: hasTankAlarm(tankReadings.fresh),
    heat: hasTankAlarm(tankReadings.heat),
  };
  const hasAnyAlarm = alarms.comm || alarms.soak || alarms.fresh || alarms.heat;

  const handleRelay = useCallback(
    async (index: number, next: boolean) => {
      const key = `relay-${index}`;
      setBusyFlag(key, true);
      try {
        await setRelay(apiBase, { index, on: next });
        await refreshStatus();
      } catch (err) {
        setError("指令发送失败");
      } finally {
        setBusyFlag(key, false);
      }
    },
    [apiBase, refreshStatus, setBusyFlag]
  );

  const handleAuto = useCallback(
    async (which: AutoSwitchKey, next: boolean) => {
      const key = `auto-${which}`;
      setBusyFlag(key, true);
      try {
        await setAutoSwitch(apiBase, { which, on: next });
        await refreshStatus();
      } catch (err) {
        setError("指令发送失败");
      } finally {
        setBusyFlag(key, false);
      }
    },
    [apiBase, refreshStatus, setBusyFlag]
  );

  const handleLift = useCallback(
    async (state: "up" | "down") => {
      setBusyFlag("lift", true);
      try {
        await setLift(apiBase, { state });
        await refreshStatus();
      } catch (err) {
        setError("指令发送失败");
      } finally {
        setBusyFlag("lift", false);
      }
    },
    [apiBase, refreshStatus, setBusyFlag]
  );

  const handleHeater = useCallback(
    async (next: boolean) => {
      setBusyFlag("heater", true);
      try {
        await setHeater(apiBase, { on: next });
        await refreshStatus();
      } catch (err) {
        setError("指令发送失败");
      } finally {
        setBusyFlag("heater", false);
      }
    },
    [apiBase, refreshStatus, setBusyFlag]
  );

  useEffect(() => {
    const updateScale = () => {
      const targetWidth = 1440;
      const targetHeight = 2560;
      const scale = Math.min(
        window.innerWidth / targetWidth,
        window.innerHeight / targetHeight
      );
      screenRef.current?.style.setProperty("--scale", scale.toString());
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  return (
    <div className="screen-root">
      <div className="screen" ref={screenRef}>
        <header className="app-header">
          <div className="title-block">
            <div className="eyebrow">RELAY DECK</div>
            <h1>PID水循环控制</h1>
          </div>
          <div className="mode-pill">泡泡模式</div>
          <div className="header-right">
            <div className={`status-pill ${isOnline ? "ok" : "error"}`}>
              {isOnline ? "在线" : "离线"}
            </div>
            <div className={`alarm-lamp ${hasAnyAlarm ? "on" : "off"}`}>
              <span className="dot" />
              <span>{hasAnyAlarm ? "告警" : "正常"}</span>
            </div>
            <HeaterCard
              online={isOnline}
              configured={heaterConfigured}
              on={heaterOn}
              busy={busy["heater"]}
              onToggle={handleHeater}
            />
          </div>
        </header>

        <main className="stage-portrait">
          <LiftPanel
            liftState={liftState}
            online={isOnline}
            busy={Boolean(busy["lift"])}
            onLift={handleLift}
          />

          <ProcessDiagram2D tanks={tankReadings} flows={flows} alarms={alarms} />
        </main>

        <PumpDeck
          pumps={pumps}
          autoStatus={autoStatus}
          online={isOnline}
          busy={busy}
          onToggleRelay={handleRelay}
          onToggleValve={handleAuto}
        />

        <footer className="foot-bar">
          <span>Last update: {lastUpdated ? lastUpdated.toLocaleTimeString() : "--"}</span>
          <span>API: {apiBase || "(相对地址)"}</span>
          <span>刷新: {pollMs}ms</span>
          {error ? <span className="foot-error">{error}</span> : null}
        </footer>
      </div>
    </div>
  );
}

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
  type SystemStatus,
  type TankKey,
  type TankReading,
} from "./api";
import type { CommLog } from "./components/TopInfoPanels";
import HistoryTrendPanel, { type HistorySample } from "./components/HistoryTrendPanel";
import OpsPanels, { type AlarmItem, type EventItem, type RuntimeStats } from "./components/OpsPanels";
import ProcessDiagram2D from "./components/ProcessDiagram2D";
import TopInfoPanels from "./components/TopInfoPanels";

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
  system: {
    host: "--",
    gpio_backend: "--",
    cpu_percent: null,
    memory_percent: null,
    disk_percent: null,
    cpu_temp: null,
    uptime_sec: null,
    load1: null,
    load5: null,
    load15: null,
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

const HISTORY_MAX = 4000;
const LOG_MAX = 18;
const EVENT_MAX = 80;
const LIFT_SPEED_MM_S = 10;
const LIFT_MAX_MM_DEFAULT = 1000;

const numericOrNull = (value: number | null | undefined) => (Number.isFinite(value) ? Number(value) : null);

const levelOrNull = (value: number | null | undefined) => {
  if (!Number.isFinite(value)) return null;
  const numeric = Number(value);
  return numeric > 1 ? numeric : numeric * 100;
};

const buildHistorySample = (data: StatusResponse): HistorySample => ({
  ts: Date.now(),
  values: {
    soak: {
      temp: numericOrNull(data.tank?.soak?.temp),
      ph: numericOrNull(data.tank?.soak?.ph),
      level: levelOrNull(data.tank?.soak?.level),
    },
    fresh: {
      temp: numericOrNull(data.tank?.fresh?.temp),
      ph: numericOrNull(data.tank?.fresh?.ph),
      level: levelOrNull(data.tank?.fresh?.level),
    },
    heat: {
      temp: numericOrNull(data.tank?.heat?.temp),
      ph: numericOrNull(data.tank?.heat?.ph),
      level: levelOrNull(data.tank?.heat?.level),
    },
  },
});

export default function App() {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const prevStatusRef = useRef<StatusResponse | null>(null);
  const prevOnlineRef = useRef<boolean>(false);
  const lastOkTsRef = useRef<number>(0);
  const apiBase = useMemo(() => resolveApiBase(), []);
  const pollMs = useMemo(() => resolvePollMs(), []);

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [commLogs, setCommLogs] = useState<CommLog[]>([]);
  const [requestOk, setRequestOk] = useState(0);
  const [requestFail, setRequestFail] = useState(0);
  const [lastLatencyMs, setLastLatencyMs] = useState(0);
  const [latestError, setLatestError] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [liftEstimatedMm, setLiftEstimatedMm] = useState(0);
  const [liftMaxMm, setLiftMaxMm] = useState(LIFT_MAX_MM_DEFAULT);
  const [runtime, setRuntime] = useState<RuntimeStats>({
    pumpRuntimeSec: { 0: 0, 1: 0, 2: 0 },
    pumpStarts: { 0: 0, 1: 0, 2: 0 },
    valveSwitches: { fresh: 0, heat: 0 },
  });

  const setBusyFlag = useCallback((key: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [key]: value }));
  }, []);

  const appendCommLog = useCallback((log: CommLog) => {
    setCommLogs((prev) => [log, ...prev].slice(0, LOG_MAX));
  }, []);

  const appendEvent = useCallback((event: EventItem) => {
    setEvents((prev) => [event, ...prev].slice(0, EVENT_MAX));
  }, []);

  const refreshStatus = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const data = await fetchStatus(apiBase);
      const latencyMs = performance.now() - startedAt;
      setStatus(data);
      setLastUpdated(new Date());
      setError(null);
      setLastLatencyMs(latencyMs);
      setRequestOk((prev) => prev + 1);
      setLatestError("");
      lastOkTsRef.current = Date.now();
      const backendLiftMax = data.lift?.max_mm;
      if (Number.isFinite(backendLiftMax) && Number(backendLiftMax) > 0) {
        setLiftMaxMm(Number(backendLiftMax));
      }
      const backendLiftMm = data.lift?.estimated_mm;
      if (Number.isFinite(backendLiftMm)) {
        const targetMax = Number.isFinite(backendLiftMax) && Number(backendLiftMax) > 0 ? Number(backendLiftMax) : liftMaxMm;
        setLiftEstimatedMm(Math.max(0, Math.min(targetMax, Number(backendLiftMm))));
      }
      appendCommLog({
        ts: Date.now(),
        endpoint: "/api/status",
        latencyMs,
        ok: true,
        message: "状态同步成功",
      });
      setHistory((prev) => [...prev, buildHistorySample(data)].slice(-HISTORY_MAX));

      const prev = prevStatusRef.current;
      if (prev) {
        for (let i = 0; i < 3; i += 1) {
          const prevOn = prev.relays?.find((item) => item.index === i)?.on ?? false;
          const nextOn = data.relays?.find((item) => item.index === i)?.on ?? false;
          if (prevOn !== nextOn) {
            appendEvent({
              ts: Date.now(),
              level: "info",
              text: `${i + 1}号水泵 ${nextOn ? "开启" : "关闭"}`,
            });
            if (nextOn) {
              setRuntime((prevRuntime) => ({
                ...prevRuntime,
                pumpStarts: {
                  ...prevRuntime.pumpStarts,
                  [i]: (prevRuntime.pumpStarts[i] ?? 0) + 1,
                },
              }));
            }
          }
        }

        const prevFresh = prev.auto?.fresh ?? false;
        const nextFresh = data.auto?.fresh ?? false;
        if (prevFresh !== nextFresh) {
          appendEvent({
            ts: Date.now(),
            level: "info",
            text: `阀门1 ${nextFresh ? "开启" : "关闭"}`,
          });
          setRuntime((prevRuntime) => ({
            ...prevRuntime,
            valveSwitches: {
              ...prevRuntime.valveSwitches,
              fresh: prevRuntime.valveSwitches.fresh + 1,
            },
          }));
        }
        const prevHeat = prev.auto?.heat ?? false;
        const nextHeat = data.auto?.heat ?? false;
        if (prevHeat !== nextHeat) {
          appendEvent({
            ts: Date.now(),
            level: "info",
            text: `阀门2 ${nextHeat ? "开启" : "关闭"}`,
          });
          setRuntime((prevRuntime) => ({
            ...prevRuntime,
            valveSwitches: {
              ...prevRuntime.valveSwitches,
              heat: prevRuntime.valveSwitches.heat + 1,
            },
          }));
        }

        const prevLift = prev.lift?.state ?? "stop";
        const nextLift = data.lift?.state ?? "stop";
        if (prevLift !== nextLift) {
          appendEvent({
            ts: Date.now(),
            level: "warn",
            text: `升降状态切换：${prevLift} -> ${nextLift}`,
          });
        }

        const prevHeater = prev.heater?.on ?? false;
        const nextHeater = data.heater?.on ?? false;
        if (prevHeater !== nextHeater) {
          appendEvent({
            ts: Date.now(),
            level: "info",
            text: `加热器 ${nextHeater ? "开启" : "关闭"}`,
          });
        }
      }
      prevStatusRef.current = data;
    } catch (err) {
      const latencyMs = performance.now() - startedAt;
      setError("后端离线");
      setLastUpdated(null);
      setLastLatencyMs(latencyMs);
      setRequestFail((prev) => prev + 1);
      const message = err instanceof Error ? err.message : "请求失败";
      setLatestError(message);
      appendCommLog({
        ts: Date.now(),
        endpoint: "/api/status",
        latencyMs,
        ok: false,
        message,
      });
    }
  }, [apiBase, appendCommLog, appendEvent, liftMaxMm]);

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
  const systemStatus: SystemStatus | undefined = effectiveStatus?.system;

  const flows = {
    pump1: getRelayOn(effectiveStatus, 0),
    pump2: getRelayOn(effectiveStatus, 1),
    pump3: getRelayOn(effectiveStatus, 2),
    valveFresh: effectiveStatus?.auto?.fresh ?? false,
    valveHeat: effectiveStatus?.auto?.heat ?? false,
  };

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
  const heartbeat =
    Date.now() - lastOkTsRef.current <= Math.max(3 * pollMs, 3000) ? "正常" : "超时";
  const successRate =
    requestOk + requestFail > 0 ? (requestOk / (requestOk + requestFail)) * 100 : 100;

  const alarmList: AlarmItem[] = useMemo(() => {
    const list: AlarmItem[] = [];
    if (!isOnline) {
      list.push({ level: "critical", text: "通信中断：后端离线" });
    }

    const inspectTank = (name: string, reading?: TankReading) => {
      const temp = reading?.temp;
      const ph = reading?.ph;
      const level = reading?.level;
      const levelPct = Number.isFinite(level)
        ? (Number(level) > 1 ? Number(level) : Number(level) * 100)
        : null;
      if (Number.isFinite(temp) && Number(temp) > 55) {
        list.push({ level: "critical", text: `${name}温度过高：${Number(temp).toFixed(1)}°C` });
      }
      if (Number.isFinite(temp) && Number(temp) < 5) {
        list.push({ level: "warn", text: `${name}温度过低：${Number(temp).toFixed(1)}°C` });
      }
      if (Number.isFinite(ph) && Number(ph) > 8.5) {
        list.push({ level: "warn", text: `${name} pH 偏高：${Number(ph).toFixed(2)}` });
      }
      if (Number.isFinite(ph) && Number(ph) < 6.0) {
        list.push({ level: "warn", text: `${name} pH 偏低：${Number(ph).toFixed(2)}` });
      }
      if (Number.isFinite(levelPct) && Number(levelPct) < 15) {
        list.push({ level: "critical", text: `${name}液位过低：${Math.round(Number(levelPct))}%` });
      }
    };

    inspectTank("浸泡桶", tankReadings.soak);
    inspectTank("清水桶", tankReadings.fresh);
    inspectTank("加热桶", tankReadings.heat);

    if (flows.pump3 && !flows.valveFresh && !flows.valveHeat) {
      list.push({ level: "warn", text: "状态冲突：3号泵开启但阀门均关闭" });
    }
    if (!list.length) {
      list.push({ level: "info", text: "系统运行正常，未发现阈值越界" });
    }
    return list.slice(0, 10);
  }, [flows.pump3, flows.valveFresh, flows.valveHeat, isOnline, tankReadings]);
  const activeAlarmCount = alarmList.filter((item) => item.level !== "info").length;

  useEffect(() => {
    if (prevOnlineRef.current === isOnline) return;
    appendEvent({
      ts: Date.now(),
      level: isOnline ? "info" : "critical",
      text: isOnline ? "通信恢复：后端重新在线" : "通信异常：后端离线",
    });
    prevOnlineRef.current = isOnline;
  }, [appendEvent, isOnline]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!isOnline) return;
      setRuntime((prevRuntime) => ({
        ...prevRuntime,
        pumpRuntimeSec: {
          0: prevRuntime.pumpRuntimeSec[0] + (flows.pump1 ? 1 : 0),
          1: prevRuntime.pumpRuntimeSec[1] + (flows.pump2 ? 1 : 0),
          2: prevRuntime.pumpRuntimeSec[2] + (flows.pump3 ? 1 : 0),
        },
      }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [flows.pump1, flows.pump2, flows.pump3, isOnline]);

  useEffect(() => {
    const stepMs = 100;
    const timer = window.setInterval(() => {
      setLiftEstimatedMm((prev) => {
        const delta = (LIFT_SPEED_MM_S * stepMs) / 1000;
        if (liftState === "up") return Math.min(liftMaxMm, prev + delta);
        if (liftState === "down") return Math.max(0, prev - delta);
        return prev;
      });
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [liftState, liftMaxMm]);

  const liftEstimatedPercent = liftMaxMm > 0 ? Math.round((liftEstimatedMm / liftMaxMm) * 100) : 0;

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
    async (state: "up" | "down" | "stop") => {
      try {
        await setLift(apiBase, { state });
        await refreshStatus();
      } catch (err) {
        setError("指令发送失败");
      }
    },
    [apiBase, refreshStatus]
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
      const safePadX = 24;
      const safePadY = 24;
      const availWidth = Math.max(320, window.innerWidth - safePadX);
      const availHeight = Math.max(320, window.innerHeight - safePadY);
      const scale = Math.min(
        availWidth / targetWidth,
        availHeight / targetHeight
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
          <div className="header-right">
            <div className={`status-pill ${isOnline ? "ok" : "error"}`}>
              {isOnline ? "在线" : "离线"}
            </div>
            <div className={`alarm-lamp ${hasAnyAlarm ? "on" : "off"}`}>
              <span className="dot" />
              <span>{hasAnyAlarm ? "告警" : "正常"}</span>
            </div>
          </div>
        </header>

        <TopInfoPanels
          online={isOnline}
          pollMs={pollMs}
          lastUpdated={lastUpdated}
          lastLatencyMs={lastLatencyMs}
          heartbeat={heartbeat}
          successRate={successRate}
          errorCount={requestFail}
          tankReadings={tankReadings}
          systemStatus={systemStatus}
          alarmCount={activeAlarmCount}
          commLogs={commLogs}
        />

        <main className="stage-portrait">
          <ProcessDiagram2D
            tanks={tankReadings}
            flows={flows}
            alarms={alarms}
            heaterOn={heaterOn}
            heaterConfigured={heaterConfigured}
            liftState={liftState}
            liftEstimatedMm={liftEstimatedMm}
            liftEstimatedPercent={liftEstimatedPercent}
            online={isOnline}
            valveConfigured={autoStatus.configured !== false}
            busy={busy}
            onLift={handleLift}
            onTogglePump={handleRelay}
            onToggleValve={handleAuto}
            onToggleHeater={handleHeater}
          />
        </main>

        <HistoryTrendPanel samples={history} />

        <OpsPanels events={events} alarms={alarmList} runtime={runtime} />

        <footer className="foot-bar">
          <span>Last update: {lastUpdated ? lastUpdated.toLocaleTimeString() : "--"}</span>
          <span>API: {apiBase || "(相对地址)"}</span>
          <span>刷新: {pollMs}ms</span>
          {error ? <span className="foot-error">{error}</span> : null}
          {latestError ? <span className="foot-error">{latestError}</span> : null}
        </footer>
      </div>
    </div>
  );
}

import type { TankKey, TankReading } from "../api";

export type CommLog = {
  ts: number;
  endpoint: string;
  latencyMs: number;
  ok: boolean;
  message: string;
};

export type TopInfoPanelsProps = {
  online: boolean;
  pollMs: number;
  lastUpdated: Date | null;
  lastLatencyMs: number;
  heartbeat: string;
  successRate: number;
  errorCount: number;
  tankReadings: Partial<Record<TankKey, TankReading>>;
  alarmCount: number;
  commLogs: CommLog[];
};

const formatValue = (value: number | null | undefined, digits: number) => {
  if (!Number.isFinite(value)) return "--";
  return Number(value).toFixed(digits);
};

const levelText = (value: number | null | undefined) => {
  if (!Number.isFinite(value)) return "--";
  const numeric = Number(value);
  const percent = numeric > 1 ? numeric : numeric * 100;
  return `${Math.round(percent)}%`;
};

export default function TopInfoPanels({
  online,
  pollMs,
  lastUpdated,
  lastLatencyMs,
  heartbeat,
  successRate,
  errorCount,
  tankReadings,
  alarmCount,
  commLogs,
}: TopInfoPanelsProps) {
  const soak = tankReadings.soak;

  return (
    <section className="top-info-zone">
      <article className="info-card overview-card">
        <div className="card-title">实时总览</div>
        <div className="kpi-grid">
          <div className="kpi-item">
            <span>在线状态</span>
            <strong className={online ? "ok" : "err"}>{online ? "在线" : "离线"}</strong>
          </div>
          <div className="kpi-item">
            <span>轮询间隔</span>
            <strong>{pollMs} ms</strong>
          </div>
          <div className="kpi-item">
            <span>请求延迟</span>
            <strong>{Math.round(lastLatencyMs)} ms</strong>
          </div>
          <div className="kpi-item">
            <span>最后更新</span>
            <strong>{lastUpdated ? lastUpdated.toLocaleTimeString() : "--"}</strong>
          </div>
          <div className="kpi-item">
            <span>告警数量</span>
            <strong>{alarmCount}</strong>
          </div>
          <div className="kpi-item">
            <span>浸泡桶温度</span>
            <strong>{formatValue(soak?.temp, 1)}°C</strong>
          </div>
          <div className="kpi-item">
            <span>浸泡桶 pH</span>
            <strong>{formatValue(soak?.ph, 2)}</strong>
          </div>
          <div className="kpi-item">
            <span>浸泡桶液位</span>
            <strong>{levelText(soak?.level)}</strong>
          </div>
        </div>
      </article>

      <article className="info-card comm-card">
        <div className="card-title">实时通讯</div>
        <div className="comm-meta">
          <span>心跳：{heartbeat}</span>
          <span>成功率：{successRate.toFixed(1)}%</span>
          <span>错误：{errorCount}</span>
        </div>
        <div className="comm-log-list">
          {commLogs.length === 0 ? <div className="log-empty">暂无通讯日志</div> : null}
          {commLogs.map((log) => (
            <div className={`comm-log ${log.ok ? "ok" : "err"}`} key={`${log.ts}-${log.endpoint}-${log.latencyMs}`}>
              <span className="time">{new Date(log.ts).toLocaleTimeString()}</span>
              <span className="endpoint">{log.endpoint}</span>
              <span className="latency">{Math.round(log.latencyMs)}ms</span>
              <span className="result">{log.ok ? "OK" : "ERR"}</span>
              <span className="message">{log.message}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

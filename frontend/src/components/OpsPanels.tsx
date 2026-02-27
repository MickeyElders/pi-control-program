export type EventItem = {
  ts: number;
  level: "info" | "warn" | "critical";
  text: string;
};

export type AlarmItem = {
  level: "info" | "warn" | "critical";
  text: string;
};

export type RuntimeStats = {
  pumpRuntimeSec: Record<number, number>;
  pumpStarts: Record<number, number>;
  valveSwitches: { fresh: number; heat: number };
};

export type OpsPanelsProps = {
  events: EventItem[];
  alarms: AlarmItem[];
  runtime: RuntimeStats;
};

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
};

export default function OpsPanels({ events, alarms, runtime }: OpsPanelsProps) {
  return (
    <section className="ops-zone">
      <article className="ops-card timeline-card">
        <div className="card-title">事件时间轴</div>
        <div className="scroll-list">
          {events.length === 0 ? <div className="empty">暂无事件</div> : null}
          {events.map((event) => (
            <div key={`${event.ts}-${event.text}`} className={`event-item ${event.level}`}>
              <span className="time">{new Date(event.ts).toLocaleTimeString()}</span>
              <span className="msg">{event.text}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="ops-card alarm-card">
        <div className="card-title">告警面板</div>
        <div className="scroll-list">
          {alarms.length === 0 ? <div className="empty">当前无告警</div> : null}
          {alarms.map((alarm, idx) => (
            <div key={`${alarm.text}-${idx}`} className={`alarm-item ${alarm.level}`}>
              <span className="level">{alarm.level.toUpperCase()}</span>
              <span className="msg">{alarm.text}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="ops-card runtime-card">
        <div className="card-title">运行统计</div>
        <div className="runtime-grid">
          <div className="runtime-item">
            <span>P1 累计运行</span>
            <strong>{formatDuration(runtime.pumpRuntimeSec[0] ?? 0)}</strong>
          </div>
          <div className="runtime-item">
            <span>P2 累计运行</span>
            <strong>{formatDuration(runtime.pumpRuntimeSec[1] ?? 0)}</strong>
          </div>
          <div className="runtime-item">
            <span>P3 累计运行</span>
            <strong>{formatDuration(runtime.pumpRuntimeSec[2] ?? 0)}</strong>
          </div>
          <div className="runtime-item">
            <span>P1 启动次数</span>
            <strong>{runtime.pumpStarts[0] ?? 0}</strong>
          </div>
          <div className="runtime-item">
            <span>P2 启动次数</span>
            <strong>{runtime.pumpStarts[1] ?? 0}</strong>
          </div>
          <div className="runtime-item">
            <span>P3 启动次数</span>
            <strong>{runtime.pumpStarts[2] ?? 0}</strong>
          </div>
          <div className="runtime-item">
            <span>阀1 切换次数</span>
            <strong>{runtime.valveSwitches.fresh}</strong>
          </div>
          <div className="runtime-item">
            <span>阀2 切换次数</span>
            <strong>{runtime.valveSwitches.heat}</strong>
          </div>
        </div>
      </article>
    </section>
  );
}

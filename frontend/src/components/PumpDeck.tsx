import type { AutoSwitchKey, AutoStatus } from "../api";

export type PumpItem = {
  index: number;
  title: string;
  route: string;
  gpio?: number;
  on: boolean;
};

export type PumpDeckProps = {
  pumps: PumpItem[];
  autoStatus: AutoStatus;
  online: boolean;
  busy: Record<string, boolean>;
  onToggleRelay: (index: number, next: boolean) => void;
  onToggleValve: (which: AutoSwitchKey, next: boolean) => void;
};

const valveMeta: Array<{ key: AutoSwitchKey; label: string }> = [
  { key: "fresh", label: "浸泡桶 → 清水桶" },
  { key: "heat", label: "浸泡桶 → 加热桶" },
];

export default function PumpDeck({
  pumps,
  autoStatus,
  online,
  busy,
  onToggleRelay,
  onToggleValve,
}: PumpDeckProps) {
  const valveEnabled = online && autoStatus.configured !== false;

  return (
    <section className="pump-deck">
      <div className="deck-title">动力与阀门控制</div>
      <div className="pump-row">
        {pumps.map((pump) => {
          const key = `relay-${pump.index}`;
          const isBusy = busy[key];
          return (
            <article className={`pump-card ${pump.on ? "on" : "off"}`} key={pump.index}>
              <div className="card-corners" aria-hidden="true" />
              <div className="pump-card-head">
                <div className="pump-icon" aria-hidden="true">
                  <span className="pump-body" />
                  <span className="pump-fan" />
                  <span className="pump-nozzle" />
                </div>
                <div>
                  <div className="pump-title">{pump.title}</div>
                  <div className="pump-route">{pump.route}</div>
                  <div className="pump-meta">GPIO {pump.gpio ?? "--"}</div>
                </div>
              </div>
              <div className="pump-foot">
                <div className={`pump-status ${pump.on ? "on" : "off"}`}>
                  <span className="dot lamp" />
                  <span>{pump.on ? "开启" : "关闭"}</span>
                </div>
                <button
                  className={`pump-btn ${pump.on ? "on" : "off"}`}
                  type="button"
                  disabled={!online || isBusy}
                  onClick={() => onToggleRelay(pump.index, !pump.on)}
                >
                  {pump.on ? "关闭" : "打开"}
                </button>
              </div>
            </article>
          );
        })}

        <article className="valve-card">
          <div className="card-corners" aria-hidden="true" />
          <div className="valve-title">阀门模块</div>
          {valveMeta.map((valve) => {
            const on = autoStatus[valve.key] ?? false;
            const isBusy = busy[`auto-${valve.key}`];
            return (
              <div className="valve-row" key={valve.key}>
                <span className="valve-label">{valve.label}</span>
                <span className={`valve-state ${on ? "on" : "off"}`}>{on ? "开" : "关"}</span>
                <button
                  className={`switch ${on ? "on" : "off"}`}
                  type="button"
                  aria-pressed={on}
                  disabled={!valveEnabled || isBusy}
                  onClick={() => onToggleValve(valve.key, !on)}
                >
                  <span className="switch-dot" />
                </button>
              </div>
            );
          })}
        </article>
      </div>
    </section>
  );
}

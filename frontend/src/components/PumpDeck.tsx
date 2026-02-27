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
};

const valveMeta: Array<{ key: AutoSwitchKey; label: string }> = [
  { key: "fresh", label: "浸泡桶 → 清水桶" },
  { key: "heat", label: "浸泡桶 → 加热桶" },
];

export default function PumpDeck({ pumps, autoStatus, online }: PumpDeckProps) {
  return (
    <section className="pump-deck">
      <div className="deck-title">动力与阀门状态</div>
      <div className="pump-row">
        {pumps.map((pump) => {
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
                <span className="pump-meta">{online ? "模型可点控" : "离线"}</span>
              </div>
            </article>
          );
        })}

        <article className="valve-card">
          <div className="card-corners" aria-hidden="true" />
          <div className="valve-title">阀门模块</div>
          {valveMeta.map((valve) => {
            const on = autoStatus[valve.key] ?? false;
            return (
              <div className="valve-row" key={valve.key}>
                <span className="valve-label">{valve.label}</span>
                <span className={`valve-state ${on ? "on" : "off"}`}>{on ? "开" : "关"}</span>
                <span className="pump-meta">{online && autoStatus.configured !== false ? "模型可点控" : "不可控"}</span>
              </div>
            );
          })}
        </article>
      </div>
    </section>
  );
}

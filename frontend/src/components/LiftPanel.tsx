import type { LiftState } from "../api";

export type LiftPanelProps = {
  liftState: LiftState;
  online: boolean;
  busy: boolean;
  onLift: (state: "up" | "down") => void;
};

const statusText: Record<LiftState, string> = {
  up: "正在升高",
  down: "正在下降",
  stop: "已停止",
};

export default function LiftPanel({ liftState, online, busy, onLift }: LiftPanelProps) {
  const liftUpActive = liftState === "up";
  const liftDownActive = liftState === "down";
  const liftUpDisabled = !online || busy || liftDownActive;
  const liftDownDisabled = !online || busy || liftUpActive;

  return (
    <aside className="lift-panel">
      <div className="lift-status">{statusText[liftState]}</div>
      <button
        className={`lift-btn ${liftUpActive ? "active" : ""}`}
        type="button"
        disabled={liftUpDisabled}
        onClick={() => onLift("up")}
      >
        {liftUpActive ? "停止升高" : "升高"}
      </button>
      <button
        className={`lift-btn ${liftDownActive ? "active" : ""}`}
        type="button"
        disabled={liftDownDisabled}
        onClick={() => onLift("down")}
      >
        {liftDownActive ? "停止下降" : "下降"}
      </button>
    </aside>
  );
}

export type HeaterCardProps = {
  online: boolean;
  configured: boolean;
  on: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
};

export default function HeaterCard({ online, configured, on, busy, onToggle }: HeaterCardProps) {
  const disabled = !online || !configured || busy;

  return (
    <div className="heater-card">
      <div className="heater-title">加热状态：{configured ? (on ? "开启" : "关闭") : "未配置"}</div>
      <button
        className={`heater-btn ${on ? "on" : "off"}`}
        type="button"
        disabled={disabled}
        onClick={() => onToggle(!on)}
      >
        {on ? "停止加热" : "开始加热"}
      </button>
    </div>
  );
}

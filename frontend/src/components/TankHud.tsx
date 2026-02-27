import type { TankKey, TankReading } from "../api";

const tankMeta: Array<{ key: TankKey; label: string; className: string }> = [
  { key: "soak", label: "浸泡桶", className: "soak" },
  { key: "fresh", label: "清水桶", className: "fresh" },
  { key: "heat", label: "加热桶", className: "heat" },
];

const formatValue = (value: number | null | undefined, digits: number) => {
  if (!Number.isFinite(value)) return "--";
  return Number(value).toFixed(digits);
};

const formatLevel = (value: number | null | undefined) => {
  if (!Number.isFinite(value)) return "--";
  const numeric = Number(value);
  const normalized = numeric > 1 ? numeric : numeric * 100;
  return `${Math.round(normalized)}%`;
};

export type TankHudProps = {
  tanks: Partial<Record<TankKey, TankReading>>;
};

export default function TankHud({ tanks }: TankHudProps) {
  return (
    <>
      {tankMeta.map((tank) => {
        const reading = tanks[tank.key];
        return (
          <div className={`tank-hud ${tank.className}`} key={tank.key}>
            <div className="hud-percent">{formatLevel(reading?.level)}</div>
            <div className="hud-metric">温度 {formatValue(reading?.temp, 1)}°C</div>
            <div className="hud-metric">pH {formatValue(reading?.ph, 2)}</div>
          </div>
        );
      })}

      {tankMeta.map((tank) => (
        <div className={`tank-label ${tank.className}`} key={`${tank.key}-label`}>
          {tank.label}
        </div>
      ))}
    </>
  );
}

export type RelayStatus = {
  index: number;
  pin: number;
  on: boolean;
};

export type AutoSwitchKey = "fresh" | "heat";

export type AutoStatus = {
  fresh: boolean;
  heat: boolean;
  configured?: boolean;
};

export type LiftState = "up" | "down" | "stop";

export type LiftStatus = {
  configured?: boolean;
  state?: LiftState;
  estimated_mm?: number | null;
  estimated_percent?: number | null;
  max_mm?: number | null;
  speed_mm_s?: number | null;
};

export type HeaterStatus = {
  configured?: boolean;
  on?: boolean;
};

export type TankKey = "soak" | "fresh" | "heat";

export type TankReading = {
  temp?: number | null;
  ph?: number | null;
  level?: number | null;
  color?: [number, number, number] | null;
};

export type SystemStatus = {
  host?: string;
  gpio_backend?: string;
  cpu_percent?: number | null;
  memory_percent?: number | null;
  disk_percent?: number | null;
  cpu_temp?: number | null;
  uptime_sec?: number | null;
  load1?: number | null;
  load5?: number | null;
  load15?: number | null;
};

export type StatusResponse = {
  relays?: RelayStatus[];
  auto?: AutoStatus;
  lift?: LiftStatus;
  heater?: HeaterStatus;
  system?: SystemStatus;
  tank?: Partial<Record<TankKey, TankReading>>;
};

export type RelayCommand = {
  index: number;
  on: boolean;
};

export type AutoSwitchCommand = {
  which: AutoSwitchKey;
  on: boolean;
};

export type HeaterCommand = {
  on: boolean;
};

export type LiftCommand = {
  state: LiftState;
};

const DEFAULT_POLL_MS = 1000;

const trimSlash = (value: string) => value.replace(/\/$/, "");

export const resolveApiBase = () => {
  if (typeof window === "undefined") return "";
  const param = new URLSearchParams(window.location.search).get("api");
  const env = import.meta.env.VITE_API_BASE as string | undefined;
  const base = param || env || "";
  return base ? trimSlash(base) : "";
};

export const resolvePollMs = () => {
  if (typeof window === "undefined") return DEFAULT_POLL_MS;
  const param = new URLSearchParams(window.location.search).get("poll");
  const env = import.meta.env.VITE_POLL_MS as string | undefined;
  const raw = param || env;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_POLL_MS;
  if (!Number.isFinite(parsed)) return DEFAULT_POLL_MS;
  return Math.max(250, parsed);
};

const apiUrl = (base: string, path: string) => (base ? `${base}${path}` : path);

const request = async <T>(base: string, path: string, options?: RequestInit): Promise<T> => {
  const res = await fetch(apiUrl(base, path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
};

export const fetchStatus = (base: string) => request<StatusResponse>(base, "/api/status");

export const setRelay = (base: string, cmd: RelayCommand) =>
  request<{ on: boolean }>(base, "/api/relay", {
    method: "POST",
    body: JSON.stringify(cmd),
  });

export const setAutoSwitch = (base: string, cmd: AutoSwitchCommand) =>
  request<{ auto: AutoStatus }>(base, "/api/auto", {
    method: "POST",
    body: JSON.stringify(cmd),
  });

export const setLift = (base: string, cmd: LiftCommand) =>
  request<{ configured: boolean; state: LiftState }>(base, "/api/lift", {
    method: "POST",
    body: JSON.stringify(cmd),
  });

export const setHeater = (base: string, cmd: HeaterCommand) =>
  request<{ configured: boolean; on: boolean }>(base, "/api/heater", {
    method: "POST",
    body: JSON.stringify(cmd),
  });

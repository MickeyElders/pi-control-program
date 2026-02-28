import os
import sqlite3
import threading
import time
from typing import Any, Dict, List, Optional


class PersistenceStore:
    def __init__(self, db_path: str, retention_days: int = 30, busy_timeout_ms: int = 5000) -> None:
        self.db_path = db_path
        self.retention_days = max(1, int(retention_days))
        self.busy_timeout_ms = int(busy_timeout_ms)

        self._db_lock = threading.Lock()
        self._db_conn: Optional[sqlite3.Connection] = None
        self._runtime_prev_state: Optional[Dict[str, bool]] = None
        self._runtime_last_ts = time.time()

    def _connect_locked(self) -> sqlite3.Connection:
        if self._db_conn is not None:
            return self._db_conn

        db_dir = os.path.dirname(self.db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)

        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute(f"PRAGMA busy_timeout={self.busy_timeout_ms}")
        self._db_conn = conn
        return conn

    def init_schema(self) -> None:
        schema = """
        CREATE TABLE IF NOT EXISTS process_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            soak_temp REAL,
            soak_ph REAL,
            soak_level REAL,
            fresh_level REAL,
            heat_level REAL,
            pump1 INTEGER NOT NULL,
            pump2 INTEGER NOT NULL,
            pump3 INTEGER NOT NULL,
            valve_fresh INTEGER NOT NULL,
            valve_heat INTEGER NOT NULL,
            lift_state TEXT NOT NULL,
            lift_estimated_mm REAL,
            heater_on INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_process_samples_ts ON process_samples(ts);

        CREATE TABLE IF NOT EXISTS system_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            host TEXT,
            gpio_backend TEXT,
            cpu_percent REAL,
            memory_percent REAL,
            disk_percent REAL,
            cpu_temp REAL,
            uptime_sec INTEGER,
            load1 REAL,
            load5 REAL,
            load15 REAL
        );
        CREATE INDEX IF NOT EXISTS idx_system_samples_ts ON system_samples(ts);

        CREATE TABLE IF NOT EXISTS control_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            prev_value TEXT,
            next_value TEXT,
            ok INTEGER NOT NULL,
            message TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_control_events_ts ON control_events(ts);

        CREATE TABLE IF NOT EXISTS runtime_daily (
            day TEXT PRIMARY KEY,
            pump1_runtime_sec INTEGER NOT NULL DEFAULT 0,
            pump2_runtime_sec INTEGER NOT NULL DEFAULT 0,
            pump3_runtime_sec INTEGER NOT NULL DEFAULT 0,
            heater_runtime_sec INTEGER NOT NULL DEFAULT 0,
            pump1_starts INTEGER NOT NULL DEFAULT 0,
            pump2_starts INTEGER NOT NULL DEFAULT 0,
            pump3_starts INTEGER NOT NULL DEFAULT 0,
            heater_starts INTEGER NOT NULL DEFAULT 0,
            valve_fresh_switches INTEGER NOT NULL DEFAULT 0,
            valve_heat_switches INTEGER NOT NULL DEFAULT 0,
            updated_ts INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS kv_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_ts INTEGER NOT NULL
        );
        """
        with self._db_lock:
            conn = self._connect_locked()
            conn.executescript(schema)
            conn.commit()

    def _execute(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        with self._db_lock:
            conn = self._connect_locked()
            conn.execute(sql, params)
            conn.commit()

    def _query_all(self, sql: str, params: tuple[Any, ...] = ()) -> List[Dict[str, Any]]:
        with self._db_lock:
            conn = self._connect_locked()
            rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]

    def _query_one(self, sql: str, params: tuple[Any, ...] = ()) -> Optional[Dict[str, Any]]:
        with self._db_lock:
            conn = self._connect_locked()
            row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None

    def set_kv(self, key: str, value: str) -> None:
        now_ms = int(time.time() * 1000)
        self._execute(
            """
            INSERT INTO kv_state(key, value, updated_ts)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value=excluded.value,
                updated_ts=excluded.updated_ts
            """,
            (key, value, now_ms),
        )

    def get_kv(self, key: str) -> Optional[str]:
        row = self._query_one("SELECT value FROM kv_state WHERE key=?", (key,))
        return row["value"] if row else None

    def restore_lift_estimate(self, lift_max_mm: float) -> Optional[float]:
        persisted = self.get_kv("lift_estimated_mm")
        if persisted is None:
            return None
        try:
            value = float(persisted)
        except ValueError:
            return None
        return max(0.0, min(float(lift_max_mm), value))

    def record_control_event(
        self,
        source: str,
        target: str,
        prev_value: Any,
        next_value: Any,
        ok: bool,
        message: str = "",
    ) -> None:
        self._execute(
            """
            INSERT INTO control_events(ts, source, target, prev_value, next_value, ok, message)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(time.time() * 1000),
                source,
                target,
                str(prev_value) if prev_value is not None else None,
                str(next_value) if next_value is not None else None,
                1 if ok else 0,
                message,
            ),
        )

    def persist_snapshot(self, snapshot: Dict[str, Any], now_ts: float) -> None:
        now_ms = int(now_ts * 1000)
        relays = snapshot.get("relays", [])
        auto = snapshot.get("auto", {})
        lift = snapshot.get("lift", {})
        heater = snapshot.get("heater", {})
        tank = snapshot.get("tank", {})
        system = snapshot.get("system", {})

        def relay_on(index: int) -> int:
            for relay in relays:
                if relay.get("index") == index:
                    return 1 if relay.get("on") else 0
            return 0

        self._execute(
            """
            INSERT INTO process_samples(
                ts, soak_temp, soak_ph, soak_level, fresh_level, heat_level,
                pump1, pump2, pump3, valve_fresh, valve_heat, lift_state, lift_estimated_mm, heater_on
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now_ms,
                tank.get("soak", {}).get("temp"),
                tank.get("soak", {}).get("ph"),
                tank.get("soak", {}).get("level"),
                tank.get("fresh", {}).get("level"),
                tank.get("heat", {}).get("level"),
                relay_on(0),
                relay_on(1),
                relay_on(2),
                1 if auto.get("fresh") else 0,
                1 if auto.get("heat") else 0,
                str(lift.get("state", "stop")),
                lift.get("estimated_mm"),
                1 if heater.get("on") else 0,
            ),
        )
        self._execute(
            """
            INSERT INTO system_samples(
                ts, host, gpio_backend, cpu_percent, memory_percent, disk_percent,
                cpu_temp, uptime_sec, load1, load5, load15
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now_ms,
                system.get("host"),
                system.get("gpio_backend"),
                system.get("cpu_percent"),
                system.get("memory_percent"),
                system.get("disk_percent"),
                system.get("cpu_temp"),
                system.get("uptime_sec"),
                system.get("load1"),
                system.get("load5"),
                system.get("load15"),
            ),
        )
        self.set_kv("lift_estimated_mm", str(lift.get("estimated_mm", 0.0)))

    def update_runtime_daily(self, snapshot: Dict[str, Any], now_ts: float) -> None:
        relays = snapshot.get("relays", [])
        auto = snapshot.get("auto", {})
        heater = snapshot.get("heater", {})

        current = {
            "pump1": any(r.get("index") == 0 and r.get("on") for r in relays),
            "pump2": any(r.get("index") == 1 and r.get("on") for r in relays),
            "pump3": any(r.get("index") == 2 and r.get("on") for r in relays),
            "heater": bool(heater.get("on")),
            "valve_fresh": bool(auto.get("fresh")),
            "valve_heat": bool(auto.get("heat")),
        }

        day = time.strftime("%Y-%m-%d", time.localtime(now_ts))
        elapsed_sec = max(0, int(round(now_ts - self._runtime_last_ts)))
        self._runtime_last_ts = now_ts

        if self._runtime_prev_state is None:
            self._runtime_prev_state = current
            return

        runtime_inc = {
            "pump1_runtime_sec": elapsed_sec if current["pump1"] else 0,
            "pump2_runtime_sec": elapsed_sec if current["pump2"] else 0,
            "pump3_runtime_sec": elapsed_sec if current["pump3"] else 0,
            "heater_runtime_sec": elapsed_sec if current["heater"] else 0,
            "pump1_starts": 1 if (not self._runtime_prev_state["pump1"] and current["pump1"]) else 0,
            "pump2_starts": 1 if (not self._runtime_prev_state["pump2"] and current["pump2"]) else 0,
            "pump3_starts": 1 if (not self._runtime_prev_state["pump3"] and current["pump3"]) else 0,
            "heater_starts": 1 if (not self._runtime_prev_state["heater"] and current["heater"]) else 0,
            "valve_fresh_switches": 1 if self._runtime_prev_state["valve_fresh"] != current["valve_fresh"] else 0,
            "valve_heat_switches": 1 if self._runtime_prev_state["valve_heat"] != current["valve_heat"] else 0,
        }

        self._execute(
            """
            INSERT INTO runtime_daily(
                day, pump1_runtime_sec, pump2_runtime_sec, pump3_runtime_sec, heater_runtime_sec,
                pump1_starts, pump2_starts, pump3_starts, heater_starts,
                valve_fresh_switches, valve_heat_switches, updated_ts
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(day) DO UPDATE SET
                pump1_runtime_sec = runtime_daily.pump1_runtime_sec + excluded.pump1_runtime_sec,
                pump2_runtime_sec = runtime_daily.pump2_runtime_sec + excluded.pump2_runtime_sec,
                pump3_runtime_sec = runtime_daily.pump3_runtime_sec + excluded.pump3_runtime_sec,
                heater_runtime_sec = runtime_daily.heater_runtime_sec + excluded.heater_runtime_sec,
                pump1_starts = runtime_daily.pump1_starts + excluded.pump1_starts,
                pump2_starts = runtime_daily.pump2_starts + excluded.pump2_starts,
                pump3_starts = runtime_daily.pump3_starts + excluded.pump3_starts,
                heater_starts = runtime_daily.heater_starts + excluded.heater_starts,
                valve_fresh_switches = runtime_daily.valve_fresh_switches + excluded.valve_fresh_switches,
                valve_heat_switches = runtime_daily.valve_heat_switches + excluded.valve_heat_switches,
                updated_ts = excluded.updated_ts
            """,
            (
                day,
                runtime_inc["pump1_runtime_sec"],
                runtime_inc["pump2_runtime_sec"],
                runtime_inc["pump3_runtime_sec"],
                runtime_inc["heater_runtime_sec"],
                runtime_inc["pump1_starts"],
                runtime_inc["pump2_starts"],
                runtime_inc["pump3_starts"],
                runtime_inc["heater_starts"],
                runtime_inc["valve_fresh_switches"],
                runtime_inc["valve_heat_switches"],
                int(now_ts * 1000),
            ),
        )

        self._runtime_prev_state = current

    def prune_old_data(self, now_ts: float) -> None:
        cutoff_ms = int((now_ts - self.retention_days * 86400) * 1000)
        cutoff_day = time.strftime("%Y-%m-%d", time.localtime(now_ts - self.retention_days * 86400))

        self._execute("DELETE FROM process_samples WHERE ts < ?", (cutoff_ms,))
        self._execute("DELETE FROM system_samples WHERE ts < ?", (cutoff_ms,))
        self._execute("DELETE FROM control_events WHERE ts < ?", (cutoff_ms,))
        self._execute("DELETE FROM runtime_daily WHERE day < ?", (cutoff_day,))

    def get_history(self, hours: float = 2.0, limit: int = 1500) -> Dict[str, Any]:
        bounded_hours = max(0.1, min(168.0, float(hours)))
        bounded_limit = max(50, min(5000, int(limit)))
        cutoff_ms = int((time.time() - bounded_hours * 3600) * 1000)

        process_rows = self._query_all(
            """
            SELECT
                ts, soak_temp, soak_ph, soak_level, fresh_level, heat_level,
                pump1, pump2, pump3, valve_fresh, valve_heat, lift_state, lift_estimated_mm, heater_on
            FROM process_samples
            WHERE ts >= ?
            ORDER BY ts ASC
            LIMIT ?
            """,
            (cutoff_ms, bounded_limit),
        )
        system_rows = self._query_all(
            """
            SELECT
                ts, host, gpio_backend, cpu_percent, memory_percent, disk_percent,
                cpu_temp, uptime_sec, load1, load5, load15
            FROM system_samples
            WHERE ts >= ?
            ORDER BY ts ASC
            LIMIT ?
            """,
            (cutoff_ms, bounded_limit),
        )
        return {
            "hours": bounded_hours,
            "process": process_rows,
            "system": system_rows,
        }

    def get_events(self, limit: int = 120) -> Dict[str, Any]:
        bounded_limit = max(20, min(1000, int(limit)))
        rows = self._query_all(
            """
            SELECT ts, source, target, prev_value, next_value, ok, message
            FROM control_events
            ORDER BY ts DESC
            LIMIT ?
            """,
            (bounded_limit,),
        )
        return {"events": rows}

    def get_runtime(self, days: int = 7) -> Dict[str, Any]:
        bounded_days = max(1, min(90, int(days)))
        rows = self._query_all(
            """
            SELECT
                day,
                pump1_runtime_sec, pump2_runtime_sec, pump3_runtime_sec, heater_runtime_sec,
                pump1_starts, pump2_starts, pump3_starts, heater_starts,
                valve_fresh_switches, valve_heat_switches, updated_ts
            FROM runtime_daily
            ORDER BY day DESC
            LIMIT ?
            """,
            (bounded_days,),
        )
        today = time.strftime("%Y-%m-%d")
        today_row = next((row for row in rows if row["day"] == today), None)
        return {
            "today": today_row,
            "days": rows,
        }

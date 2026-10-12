import { useEffect, useState } from "react";

/** Floating travel dates stay as authored; only Today's reference uses this device's calendar. */
function deviceDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function useDeviceDate(): string {
  const [date, setDate] = useState(deviceDate);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule() {
      clearTimeout(timer);
      if (document.hidden) return;
      const now = new Date();
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      // Re-read the clock at least once a minute while visible, including clock
      // or timezone changes. Recompute local midnight after each wake for DST.
      timer = setTimeout(
        refresh,
        Math.max(1, Math.min(60_000, midnight.getTime() - now.getTime())),
      );
    }
    function refresh() {
      clearTimeout(timer);
      if (document.hidden) return;
      setDate(deviceDate());
      schedule();
    }
    schedule();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, []);
  return date;
}

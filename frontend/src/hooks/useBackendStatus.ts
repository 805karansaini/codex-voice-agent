import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../services/api";

export type BackendStatus = {
  kind: "checking" | "ready" | "missing_key" | "offline";
  label: string;
};

const CHECK_INTERVAL_MS = 15_000;

export function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus>({
    kind: "checking",
    label: "Checking backend",
  });
  const checkingRef = useRef(false);

  const refresh = useCallback(async (showChecking = true) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    if (showChecking) {
      setStatus({ kind: "checking", label: "Checking backend" });
    }
    try {
      const data = await api.fetchHealth();
      setStatus(
        data.has_google_api_key
          ? { kind: "ready", label: "Ready" }
          : { kind: "missing_key", label: "Missing Google API key" },
      );
    } catch {
      setStatus({ kind: "offline", label: "Backend offline" });
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(false);
    }, CHECK_INTERVAL_MS);
    const handleOnline = () => void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  return { status, refresh };
}

import { useEffect, useState } from "react";

import * as api from "../services/api";

export type BackendStatus = {
  kind: "checking" | "ready" | "missing_key" | "offline";
  label: string;
};

export function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus>({
    kind: "checking",
    label: "Checking backend",
  });

  useEffect(() => {
    api
      .fetchHealth()
      .then((data) => {
        setStatus(
          data.has_google_api_key
            ? { kind: "ready", label: "Ready" }
            : { kind: "missing_key", label: "Missing Google API key" },
        );
      })
      .catch(() => setStatus({ kind: "offline", label: "Backend offline" }));
  }, []);

  return status;
}

import { useEffect, useState } from "react";

import * as api from "../services/api";

export function useBackendStatus() {
  const [status, setStatus] = useState("Checking backend");

  useEffect(() => {
    api
      .fetchHealth()
      .then((data) => {
        setStatus(data.has_google_api_key ? "Ready" : "Missing Google API key");
      })
      .catch(() => setStatus("Backend offline"));
  }, []);

  return status;
}

import { useCallback, useEffect, useState } from "react";

import * as api from "../services/api";
import { DoctorCheck } from "../types";

export function useSetupDoctor() {
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>([]);

  const refreshDoctor = useCallback(() => {
    api
      .fetchDoctor()
      .then(async (report) => {
        const canRequestMic = typeof navigator.mediaDevices?.getUserMedia === "function";
        let micCheck: DoctorCheck = {
          name: "Microphone permission",
          ok: canRequestMic,
          message: canRequestMic
            ? "Browser can request microphone access"
            : "Microphone API unavailable",
          fix: "Use a browser with microphone support and allow microphone access when prompted.",
        };
        try {
          const permissions = navigator.permissions;
          if (permissions?.query) {
            const status = await permissions.query({ name: "microphone" });
            micCheck = {
              name: "Microphone permission",
              ok: status.state === "granted" || status.state === "prompt",
              message:
                status.state === "granted"
                  ? "Allowed"
                  : status.state === "prompt"
                    ? "Will ask when voice starts"
                    : "Blocked",
              fix: "Allow microphone access in the browser or system privacy settings.",
            };
          }
        } catch {
          // Some browsers do not expose microphone permission through Permissions API.
        }
        setDoctorChecks([...(report.checks || []), micCheck]);
      })
      .catch(() => setDoctorChecks([]));
  }, []);

  useEffect(() => {
    refreshDoctor();
  }, [refreshDoctor]);

  return { doctorChecks, refreshDoctor };
}

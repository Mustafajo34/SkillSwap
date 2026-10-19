import { useEffect, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useRealtime } from "../realtime/useRealtime";
import { requestJson } from "../utils/api";

// Swap requests waiting for you (the sidebar badge). Re-counts whenever a
// swap of yours changes, live, and after reconnecting.
export function useSwapCount() {
  const { authFetch } = useAuth();
  const { subscribe } = useRealtime();
  const [count, setCount] = useState(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    requestJson(authFetch, "/swaps/count", { signal: controller.signal })
      .then((data) => setCount(data.incoming || 0))
      .catch(() => {}); // the badge is optional
    return () => controller.abort();
  }, [authFetch, version]);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offChange = subscribe("swaps:changed", bump);
    const offReconnect = subscribe("realtime:reconnected", bump);
    return () => {
      offChange();
      offReconnect();
    };
  }, [subscribe]);

  return count;
}

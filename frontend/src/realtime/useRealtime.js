import { createContext, useContext } from "react";

// App-wide live updates (see RealtimeProvider). Kept apart from the provider
// so that file only exports a component (React Fast Refresh requires it).
export const RealtimeContext = createContext({
  connected: false,
  subscribe: () => () => {},
});

export const useRealtime = () => useContext(RealtimeContext);

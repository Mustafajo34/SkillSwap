import { createContext, useContext } from "react";

// Your skill-connect network, shared by every part of the app (see
// ConnectsProvider). Kept apart so the provider file only exports a component.
export const ConnectsContext = createContext(null);

export const useConnects = () => useContext(ConnectsContext);

import { createContext, useContext } from "react";

// Kept apart from AuthProvider.jsx so that file only exports a component
// (React Fast Refresh requires it).
export const authContext = createContext();

export const useAuth = () => useContext(authContext);

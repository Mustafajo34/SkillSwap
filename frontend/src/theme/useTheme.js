import { createContext, useContext } from "react";

// Dashboard light/dark mode, for things rendered outside the .dashboard
// element (modals portaled to <body>) that can't inherit its CSS variables.
export const ThemeContext = createContext({ darkMode: true });

export const useTheme = () => useContext(ThemeContext);

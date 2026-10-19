import { createContext, useContext } from "react";

// Your notifications (navbar bell, call alerts). See NotificationsProvider.
// Kept apart so the provider file only exports a component.
export const NotificationsContext = createContext(null);

export const useNotifications = () => useContext(NotificationsContext);

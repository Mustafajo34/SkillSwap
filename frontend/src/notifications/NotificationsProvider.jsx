import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useRealtime } from "../realtime/useRealtime";
import { requestJson } from "../utils/api";
import { NotificationsContext } from "./useNotifications";
import { describeNotification } from "./describe";

// Your notifications, for the whole dashboard. Saved ones load from
// GET /notifications; new ones arrive instantly as the "notification:new"
// socket event (see backend/services/notifications.js).
//
//   notifications  newest first        unread   count for the bell badge
//   markRead(ids?) some, or all        respond  answer a video invite
//   clearAll()     delete them all (your other tabs clear too)
//
// Replies to your video invites ("Finn accepted…", "Lina joined with your
// link") also pop up as a toast; incoming invites get the call alert
// (IncomingCallAlert) instead.

const TOAST_MS = 6000;

export default function NotificationsProvider({ children }) {
  const { authFetch } = useAuth();
  const { subscribe } = useRealtime();
  const [state, setState] = useState({ status: "loading", notifications: [], unread: 0 });
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    requestJson(authFetch, "/notifications", { signal: controller.signal })
      .then((data) => setState({ status: "ready", ...data }))
      .catch((err) => {
        if (err.name !== "AbortError") setState((s) => ({ ...s, status: "error" }));
      });
    return () => controller.abort();
  }, [authFetch, version]);

  useEffect(() => {
    const offNew = subscribe("notification:new", (n) => {
      if (!n?.id) return;
      setState((s) =>
        s.notifications.some((x) => x.id === n.id)
          ? s
          : {
              ...s,
              notifications: [n, ...s.notifications].slice(0, 30),
              unread: s.unread + (n.read ? 0 : 1),
            },
      );
      if (n.type === "session_response" || n.type === "session_link_join") {
        setToast({ key: n.id, text: describeNotification(n), good: n.data?.response !== "decline" });
      }
    });
    // A call ended: its invites can't be joined any more
    const offEnded = subscribe("session:ended", ({ roomId } = {}) =>
      setState((s) => ({
        ...s,
        notifications: s.notifications.map((n) =>
          n.type === "session_invite" && n.data?.roomId === roomId
            ? { ...n, data: { ...n.data, endedAt: new Date().toISOString() } }
            : n,
        ),
      })),
    );
    // Cleared in another tab
    const offCleared = subscribe("notifications:cleared", () =>
      setState((s) => ({ ...s, notifications: [], unread: 0 })),
    );
    // Back online: pick up anything that arrived while disconnected
    const offReconnect = subscribe("realtime:reconnected", () => setVersion((v) => v + 1));
    return () => {
      offNew();
      offEnded();
      offCleared();
      offReconnect();
    };
  }, [subscribe]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Optimistic; the server's count wins when it answers
  const markRead = useCallback(
    async (ids) => {
      setState((s) => {
        const notifications = s.notifications.map((n) =>
          !ids || ids.includes(n.id) ? { ...n, read: true } : n,
        );
        return { ...s, notifications, unread: notifications.filter((n) => !n.read).length };
      });
      try {
        const { unread } = await requestJson(authFetch, "/notifications/read", {
          method: "POST",
          body: JSON.stringify(ids ? { ids } : {}),
        });
        setState((s) => ({ ...s, unread }));
      } catch {
        // stays read locally; the next load corrects it if needed
      }
    },
    [authFetch],
  );

  // Answer a video invite. Throws (e.g. "This session has ended.") so the
  // caller can show it.
  const respond = useCallback(
    async (roomId, response) => {
      await requestJson(authFetch, `/sessions/${encodeURIComponent(roomId)}/respond`, {
        method: "POST",
        body: JSON.stringify({ response }),
      });
      setState((s) => {
        const notifications = s.notifications.map((n) =>
          n.type === "session_invite" && n.data?.roomId === roomId
            ? { ...n, read: true, data: { ...n.data, answered: response } }
            : n,
        );
        return { ...s, notifications, unread: notifications.filter((n) => !n.read).length };
      });
    },
    [authFetch],
  );

  // Deletes every notification. Throws so the bell can show the message.
  const clearAll = useCallback(async () => {
    await requestJson(authFetch, "/notifications", { method: "DELETE" });
    setState((s) => ({ ...s, notifications: [], unread: 0 }));
  }, [authFetch]);

  const value = useMemo(
    () => ({ ...state, markRead, respond, clearAll }),
    [state, markRead, respond, clearAll],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      {toast && (
        <div
          key={toast.key}
          role="status"
          className="connects-toast fixed bottom-20 right-4 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-2xl shadow-black/20"
        >
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
              toast.good ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 10l5-3v10l-5-3" />
              <rect x="3" y="6" width="12" height="12" rx="2.5" />
            </svg>
          </span>
          <span className="min-w-0 flex-1 font-semibold">{toast.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setToast(null)}
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      )}
    </NotificationsContext.Provider>
  );
}

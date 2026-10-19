import { useEffect, useRef, useState } from "react";
import UserAvatar from "../components/UserAvatar";
import { useNotifications } from "./useNotifications";
import { describeNotification, isSessionInviteActive } from "./describe";
import { desktopAlertPermission, requestDesktopAlerts } from "./desktopAlerts";

// Navbar bell: unread badge + a dropdown of recent notifications. Opening
// it marks everything read. Once the list grows past CLEAR_AFTER, a small
// "Clear all" button appears (it asks to confirm — clearing can't be undone).
//
// Responsive: on phones the dropdown is a full-width panel under the navbar
// (it would otherwise run off the left edge); from 640px up it's a 380px
// dropdown under the bell. Either way it fits the screen height and only
// the list scrolls. Video invites can be joined from here until
// their session expires; connect notifications open Skills Connect and
// swap notifications open Swap Requests.

const CLEAR_AFTER = 5;

function timeAgo(date) {
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function NotificationBell({ onJoinSession, onOpenConnects, onOpenSwaps }) {
  const { notifications, unread, markRead, respond, status, clearAll } = useNotifications();
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [alerts, setAlerts] = useState(desktopAlertPermission);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setError("");
    setConfirmClear(false);
    if (next && unread > 0) markRead();
  };

  const clear = async () => {
    setError("");
    setClearing(true);
    try {
      await clearAll();
      setConfirmClear(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setClearing(false);
    }
  };

  const join = async (n) => {
    setError("");
    try {
      if (!n.data?.answered) await respond(n.data.roomId, "accept");
      setOpen(false);
      onJoinSession(n.data.roomId);
    } catch (err) {
      setError(err.message);
    }
  };

  const action = (n) => {
    if (n.type === "session_invite") {
      if (n.data?.answered === "decline") return <span className="text-[11px] text-muted-foreground">Declined</span>;
      return isSessionInviteActive(n) ? (
        <button
          type="button"
          onClick={() => join(n)}
          className="rounded-full bg-primary px-3 py-1.5 text-[11px] font-bold sm:py-1 text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Join
        </button>
      ) : (
        <span className="text-[11px] text-muted-foreground">Ended</span>
      );
    }
    if (n.type === "connect_request" || n.type === "connect_accept" || n.type.startsWith("swap_")) {
      const isSwap = n.type.startsWith("swap_");
      return (
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            if (isSwap) onOpenSwaps?.();
            else onOpenConnects(n.type === "connect_request" ? "pending" : "connects");
          }}
          className="rounded-full border border-border px-3 py-1.5 text-[11px] font-bold sm:py-1 transition-colors hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
        >
          View
        </button>
      );
    }
    return null;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative grid h-10 w-10 place-items-center rounded-lg transition-colors hover:bg-[var(--muted)]"
        style={{ color: "var(--foreground)" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="connects-toast fixed inset-x-3 top-[4.5rem] z-50 flex max-h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl shadow-black/25 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[380px] sm:max-h-[min(560px,calc(100dvh-6rem))]"
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3">
            <strong className="text-sm">Notifications</strong>
            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
              {notifications.some((n) => !n.read) && !confirmClear && (
                <button
                  type="button"
                  onClick={() => markRead()}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Mark all read
                </button>
              )}
              {notifications.length > CLEAR_AFTER &&
                (confirmClear ? (
                  <span className="flex items-center gap-2 text-xs font-semibold" role="group" aria-label="Confirm clearing notifications">
                    <span className="text-muted-foreground">Clear all?</span>
                    <button
                      type="button"
                      disabled={clearing}
                      onClick={clear}
                      className="rounded-full bg-red-500 px-2.5 py-1 font-bold text-white transition hover:bg-red-600 disabled:opacity-60"
                    >
                      {clearing ? "Clearing…" : "Yes"}
                    </button>
                    <button
                      type="button"
                      disabled={clearing}
                      onClick={() => setConfirmClear(false)}
                      className="rounded-full border border-border px-2.5 py-1 font-bold transition hover:border-primary"
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="rounded-full border border-border px-2.5 py-1 text-[11px] font-bold text-muted-foreground transition hover:border-red-500 hover:text-red-500"
                  >
                    Clear all
                  </button>
                ))}
            </div>
          </div>

          {error && (
            <p role="alert" className="shrink-0 border-b border-border bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-500">
              {error}
            </p>
          )}

          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {status === "loading" && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</li>
            )}
            {status !== "loading" && notifications.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                You’re all caught up.
              </li>
            )}
            {notifications.map((n) => (
              <li
                key={n.id}
                className={`flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 ${
                  n.read ? "" : "bg-primary/5"
                }`}
              >
                <UserAvatar
                  id={n.actor.id}
                  name={n.actor.name}
                  photoV={n.actor.photoV}
                  className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-bold text-[#111]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm leading-5">{describeNotification(n)}</span>
                  <span className="text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                </span>
                <span className="shrink-0 self-center">{action(n)}</span>
              </li>
            ))}
          </ul>

          {alerts === "default" && (
            <button
              type="button"
              onClick={async () => setAlerts(await requestDesktopAlerts())}
              className="w-full shrink-0 border-t border-border px-4 py-3 text-left sm:py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              🔔 Turn on desktop alerts for video invites
            </button>
          )}
        </div>
      )}
    </div>
  );
}

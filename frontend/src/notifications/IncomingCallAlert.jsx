import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRealtime } from "../realtime/useRealtime";
import { useTheme } from "../theme/useTheme";
import UserAvatar from "../components/UserAvatar";
import { useNotifications } from "./useNotifications";
import { isSessionInviteActive } from "./describe";
import "./notifications.css";
import {
  desktopAlertPermission,
  flashTitle,
  requestDesktopAlerts,
  showDesktopAlert,
  startRingtone,
} from "./desktopAlerts";

// "Maya wants to video chat with you" — rings the moment a host invites you
// (live "notification:new" of type session_invite). Accept answers the
// invite and opens the session; Decline tells the host. If nobody answers
// in RING_MS it stops and shows a "missed" note (the invite stays in the
// bell, where it can still be joined until the session expires).

const RING_MS = 30000;
const MISSED_MS = 12000;

export default function IncomingCallAlert({ onJoin }) {
  const { subscribe } = useRealtime();
  const { respond } = useNotifications();
  const { darkMode } = useTheme();
  const [call, setCall] = useState(null); // the ringing invite
  const [missed, setMissed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [alerts, setAlerts] = useState(desktopAlertPermission);

  useEffect(
    () =>
      subscribe("notification:new", (n) => {
        if (n?.type !== "session_invite" || !isSessionInviteActive(n)) return;
        setCall(n);
        setMissed(null);
        setError("");
        setMuted(false);
      }),
    [subscribe],
  );

  // The call ended before you answered: stop ringing / drop the missed note
  useEffect(
    () =>
      subscribe("session:ended", ({ roomId } = {}) => {
        setCall((c) => (c?.data.roomId === roomId ? null : c));
        setMissed((m) => (m?.data.roomId === roomId ? null : m));
      }),
    [subscribe],
  );

  // While ringing: sound, tab-title flash, system notification, timeout
  useEffect(() => {
    if (!call) return;
    const name = call.actor.name;
    const stopTitle = flashTitle(`📞 ${name} is calling…`);
    const closeAlert = showDesktopAlert(`${name} wants to video chat`, {
      body: "Open SkillSwap to answer.",
      tag: `session-${call.data.roomId}`,
    });
    const timer = setTimeout(() => {
      setMissed(call);
      setCall(null);
    }, RING_MS);
    return () => {
      stopTitle();
      closeAlert();
      clearTimeout(timer);
    };
  }, [call]);

  useEffect(() => {
    if (!call || muted) return;
    return startRingtone();
  }, [call, muted]);

  useEffect(() => {
    if (!missed) return;
    const timer = setTimeout(() => setMissed(null), MISSED_MS);
    return () => clearTimeout(timer);
  }, [missed]);

  const answer = async (invite, response) => {
    setBusy(true);
    setError("");
    try {
      await respond(invite.data.roomId, response);
      setCall(null);
      setMissed(null);
      if (response === "accept") onJoin(invite.data.roomId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const enableAlerts = async () => setAlerts(await requestDesktopAlerts());

  if (missed && !call) {
    return (
      <div
        role="status"
        className="connects-toast fixed right-4 top-20 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-2xl shadow-black/25"
      >
        <span className="min-w-0 flex-1">
          <strong className="block">Missed video invite</strong>
          <span className="text-xs text-muted-foreground">from {missed.actor.name}</span>
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => answer(missed, "accept")}
          className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          Join now
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setMissed(null)}
          className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    );
  }

  if (!call) return null;

  const name = call.actor.name;
  // Portaled to <body> (outside .dashboard), so it carries the theme class
  return createPortal(
    <div className={`call-alert-overlay ${darkMode ? "" : "is-light"}`}>
      <div
        className="call-alert"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="call-alert-title"
        aria-describedby="call-alert-text"
      >
        <div className="call-alert-avatar" aria-hidden="true">
          <span className="call-ring" />
          <span className="call-ring call-ring-2" />
          <UserAvatar
            id={call.actor.id}
            name={name}
            photoV={call.actor.photoV}
            className="call-face"
          />
        </div>
        <p className="call-alert-eyebrow">Incoming video chat</p>
        <h2 id="call-alert-title">{name}</h2>
        <p id="call-alert-text">wants to video chat with you on SkillSwap</p>

        {error && (
          <p className="call-alert-error" role="alert">
            {error}
          </p>
        )}

        <div className="call-alert-actions">
          <button
            type="button"
            className="call-decline"
            disabled={busy}
            onClick={() => answer(call, "decline")}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
            Decline
          </button>
          <button
            type="button"
            className="call-accept"
            disabled={busy}
            onClick={() => answer(call, "accept")}
            autoFocus
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 10l5-3v10l-5-3" />
              <rect x="3" y="6" width="12" height="12" rx="2.5" />
            </svg>
            {busy ? "Joining…" : "Accept"}
          </button>
        </div>

        <div className="call-alert-footer">
          <button type="button" onClick={() => setMuted((m) => !m)}>
            {muted ? "Unmute ringtone" : "Silence ringtone"}
          </button>
          {alerts === "default" && (
            <button type="button" onClick={enableAlerts}>
              Alert me when SkillSwap is in the background
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

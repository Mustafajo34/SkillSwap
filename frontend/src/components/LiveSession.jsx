import { useState, useEffect, useRef, useMemo, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useLocalMedia } from "../hooks/useLocalMedia";
import { usePeerRoom } from "../hooks/usePeerRoom";
import { requestJson } from "../utils/api";
import { useTheme } from "../theme/useTheme";
import { useConnects } from "../connects/useConnects";
import UserAvatar from "./UserAvatar";
import SessionNotes from "./SessionNotes";
import SessionChat from "./SessionChat";
import SessionSettings from "./SessionSettings";
import SessionRating from "./SessionRating";
import { useSessionChat } from "../hooks/useSessionChat";
import { recordingSupported, startSessionRecording } from "../utils/sessionRecorder";
import "../css/LiveSession.css";

// Reactions (the React button): 10 emoji — smiles, frowns, hands, a balloon
// and a heart. Keys must match REACTIONS in backend/signaling.js.
const REACTIONS = [
  { key: "grin", emoji: "\u{1F600}", label: "grinning" },
  { key: "joy", emoji: "\u{1F602}", label: "laughing" },
  { key: "love", emoji: "\u{1F60D}", label: "love it" },
  { key: "frown", emoji: "\u{1F641}", label: "frowning" },
  { key: "cry", emoji: "\u{1F622}", label: "sad" },
  { key: "thumbs", emoji: "\u{1F44D}", label: "thumbs up" },
  { key: "clap", emoji: "\u{1F44F}", label: "clapping" },
  { key: "wave", emoji: "\u{1F44B}", label: "waving" },
  { key: "balloon", emoji: "\u{1F388}", label: "balloon" },
  { key: "heart", emoji: "\u{2764}\u{FE0F}", label: "heart" },
];
const REACTION_BY_KEY = Object.fromEntries(REACTIONS.map((r) => [r.key, r]));
const MAX_FLOATS = 30; // on screen at once
// Screen sharing needs getDisplayMedia — desktop browsers; most phones can't
const CAN_SHARE_SCREEN =
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);
const SHARE_NOTICE_MS = 3500;
// 0:07 · 12:30 · 1:02:45
function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
// Settings remembered on this device (camera/mic ones live in useLocalMedia)
const MIRROR_KEY = "skillswap.mirror";
const SPEAKER_KEY = "skillswap.speaker";
function readSetting(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // blocked storage: just not remembered
  }
}
const REACTION_GAP_MS = 180;

// Most friends that can be invited to one session at a time.
const MAX_INVITES = 5;

const ROOM_ID_RE = /^[a-z0-9]{8,32}$/i;

const paths = {
  camera: (
    <>
      <path d="M15 10l5-3v10l-5-3" />
      <rect x="3" y="6" width="12" height="12" rx="2.5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3M9 21h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.9l-2.8 2.8A1.7 1.7 0 0015 19.4 1.7 1.7 0 0014 21h-4a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-2.8-2.8A1.7 1.7 0 004.6 15 1.7 1.7 0 003 14v-4a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l2.8-2.8A1.7 1.7 0 009 4.6 1.7 1.7 0 0010 3h4a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l2.8 2.8a1.7 1.7 0 00-.3 1.9 1.7 1.7 0 001.6 1v4a1.7 1.7 0 00-1.6 1z" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14.5s1.4 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
    </>
  ),
  gallery: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  record: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </>
  ),
  viewList: (
    <>
      <rect x="3" y="4" width="5" height="5" rx="1" />
      <rect x="3" y="15" width="5" height="5" rx="1" />
      <path d="M11 6.5h10M11 17.5h10" />
    </>
  ),
  viewCompact: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="12" cy="6" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="6" cy="14" r="2.2" />
      <circle cx="12" cy="14" r="2.2" />
      <circle cx="18" cy="14" r="2.2" />
    </>
  ),
  share: (
    <>
      <path d="M12 16V3M7 8l5-5 5 5" />
      <path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
    </>
  ),
  notes: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 12h6M9 16h6" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5h16v12H9l-5 4z" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19v-1.5A4.5 4.5 0 018 13h2a4.5 4.5 0 014.5 4.5V19M16 5.5a3 3 0 010 5M17 13a4.5 4.5 0 013.5 4.5V19" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </>
  ),
  send: (
    <>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4z" />
    </>
  ),
  invite: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20v-1A5.5 5.5 0 018 13.5h2a5.5 5.5 0 015.5 5.5v1M19 8v6M16 11h6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cameraOff: (
    <>
      <path d="M15 10l5-3v10l-5-3" />
      <rect x="3" y="6" width="12" height="12" rx="2.5" />
      <path d="M2 2l20 20" />
    </>
  ),
  arrowUp: <path d="M12 19V5M5 12l7-7 7 7" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  shrink: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  exit: (
    <>
      <path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" />
      <path d="M10 17l5-5-5-5M15 12H3" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
    </>
  ),
  hand: (
    <>
      <path d="M7.5 12V6.5a1.5 1.5 0 013 0V10M10.5 10V4.5a1.5 1.5 0 013 0V10M13.5 10V5.5a1.5 1.5 0 013 0V11M16.5 10V8a1.5 1.5 0 013 0v6c0 4.4-2.5 7-7 7-2.8 0-4.5-1.3-6-3l-3.2-3.8a1.6 1.6 0 012.3-2.2l1.9 1.5z" />
    </>
  ),
};

function Icon({ name, size = 21 }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function Control({ icon, label, active, onClick, badge, ...rest }) {
  return (
    <button
      className={`control ${active ? "active" : ""}`}
      onClick={onClick}
      type="button"
      aria-pressed={active}
      {...rest}
    >
      <span className="control-icon">
        <Icon name={icon} />
        {badge && <b>{badge}</b>}
      </span>
      <small>{label}</small>
    </button>
  );
}

// ── Media tiles ──────────────────────────────────────────────────────────────

// Your own camera. Muted so you never hear yourself.
function SelfView({ stream, status, error, mirror, mic, me, className = "", onEnlarge }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div
      className={`self-view is-${status} ${className}`}
      onDoubleClick={onEnlarge && ((e) => !e.target.closest("button") && onEnlarge())}
    >
      <video
        ref={videoRef}
        className={mirror ? "mirrored" : ""}
        autoPlay
        muted
        playsInline
        aria-label="Your camera preview"
      />
      {status === "starting" && (
        <div className="self-state">
          <i className="self-spinner" />
          <span>Starting camera…</span>
        </div>
      )}
      {status === "off" && (
        <div className="self-state">
          <UserAvatar id={me?.id} name={me?.name || "You"} photoV={me?.photoV} className="avatar" />
          <span>Camera is off</span>
        </div>
      )}
      {status === "error" && (
        <div className="self-state error" role="alert">
          <Icon name="cameraOff" size={18} />
          <span>{error}</span>
        </div>
      )}
      {onEnlarge && <EnlargeButton name="your" onClick={onEnlarge} small />}
      <span className="self-tag">
        You
        {!mic && (
          <em aria-label="Muted">
            <Icon name="mic" size={11} />
          </em>
        )}
      </span>
    </div>
  );
}

// Someone else in the session, received peer-to-peer.
function PeerTile({ peer, presenting = false, sinkId = "", onEnlarge }) {
  const videoRef = useRef(null);
  // Browsers can block audio autoplay until the user interacts with the page
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = peer.stream;
    el.play()
      .then(() => setBlocked(false))
      .catch((err) => err?.name === "NotAllowedError" && setBlocked(true));
  }, [peer.stream]);

  // Play through the speaker picked in Settings (where the browser can)
  useEffect(() => {
    const el = videoRef.current;
    if (el?.setSinkId && el.sinkId !== sinkId) el.setSinkId(sinkId).catch(() => {});
  }, [sinkId, peer.stream]);

  const unblock = () =>
    videoRef.current
      ?.play()
      .then(() => setBlocked(false))
      .catch(() => {});

  const linking = peer.connection !== "connected";

  return (
    <div
      className={`peer-tile ${peer.camera || presenting ? "" : "cam-off"} ${presenting ? "is-presenting" : ""}`}
      onDoubleClick={onEnlarge && ((e) => !e.target.closest("button") && onEnlarge())}
    >
      <video ref={videoRef} autoPlay playsInline />
      {!peer.camera && !presenting && (
        <div className="peer-off">
          <UserAvatar
            id={peer.userId || peer.id}
            name={peer.name}
            photoV={peer.photoV}
            className="avatar large"
          />
        </div>
      )}
      {linking && (
        <span className="peer-status">
          <i className="self-spinner" />
          {peer.connection === "failed" || peer.connection === "disconnected"
            ? "Reconnecting…"
            : "Connecting…"}
        </span>
      )}
      {blocked && (
        <button type="button" className="peer-unmute" onClick={unblock}>
          <Icon name="mic" size={15} />
          Tap to hear {peer.name.split(" ")[0]}
        </button>
      )}
      {onEnlarge && <EnlargeButton name={`${peer.name.split(" ")[0]}'s`} onClick={onEnlarge} />}
      <div className="speaker">
        <strong>{peer.name}</strong>
        {presenting && <b className="presenting-badge">Presenting</b>}
        {!peer.mic && (
          <em aria-label="Muted">
            <Icon name="mic" size={12} />
          </em>
        )}
      </div>
    </div>
  );
}

// Corner button on a video tile: show that video filling the browser window
// (double-clicking the tile does the same)
function EnlargeButton({ name, onClick, small = false }) {
  return (
    <button
      type="button"
      className={`enlarge-btn${small ? " is-small" : ""}`}
      onClick={(e) => onClick(e.currentTarget)}
      aria-label={`Enlarge ${name} video`}
      title="Enlarge video"
    >
      <Icon name="expand" size={small ? 14 : 16} />
    </button>
  );
}

// One video filling the whole browser window, over everything. Portaled to
// <body>: the meeting is a size container, which would trap position:fixed
// inside it. Uses its own *muted* <video> on the same stream — the tile
// keeps playing their audio, so nothing cuts out or doubles up.
// Exit: the Exit button, Esc, or double-click.
function EnlargedView({ member, onClose }) {
  const videoRef = useRef(null);
  const exitRef = useRef(null);
  const showVideo = Boolean(member.stream) && (member.camera || member.presenting);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = member.stream;
    el.play().catch(() => {});
  }, [member.stream, showVideo]);

  // Esc exits; the page behind doesn't scroll; focus starts on Exit
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    exitRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      root.style.overflow = overflow;
    };
  }, [onClose]);

  const first = member.name.split(" ")[0];
  return createPortal(
    <div
      className="enlarged-view"
      role="dialog"
      aria-modal="true"
      aria-label={member.you ? "Your video, enlarged" : `${member.name}'s video, enlarged`}
      onDoubleClick={(e) => !e.target.closest("button") && onClose()}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          className={member.mirror && !member.presenting ? "is-mirrored" : ""}
          autoPlay
          playsInline
          muted
        />
      ) : (
        <div className="enlarged-off">
          <UserAvatar
            id={member.userId || member.id}
            name={member.name}
            photoV={member.photoV}
            className="enlarged-avatar"
          />
          <span>{member.you ? "Your camera is off" : `${first}'s camera is off`}</span>
        </div>
      )}
      <div className="enlarged-bar">
        <div className="enlarged-who">
          <strong>{member.you ? "You" : member.name}</strong>
          {member.presenting && <b className="presenting-badge">Presenting</b>}
          {!member.mic && (
            <em aria-label="Muted">
              <Icon name="mic" size={12} />
            </em>
          )}
        </div>
        <button ref={exitRef} type="button" className="enlarged-exit" onClick={onClose}>
          <Icon name="shrink" size={16} />
          <span>Exit full view</span>
        </button>
      </div>
      <p className="enlarged-hint" aria-hidden="true">
        Press Esc or double-click to exit
      </p>
    </div>,
    document.body,
  );
}

// In-app explanation shown before the browser's own permission prompt, plus
// help when access is blocked or a device is missing.
function PermissionGate({ media, who }) {
  const { permission, phase, error, request, skip } = media;

  let view = "prompt";
  if (phase === "requesting") view = "waiting";
  else if (permission === "checking" || (permission === "granted" && phase === "idle"))
    view = "checking";
  else if (permission === "denied" || error?.name === "NotAllowedError")
    view = "denied";
  else if (permission === "unsupported" || phase === "error") view = "error";

  const skipButton = (
    <button type="button" className="gate-secondary" onClick={skip}>
      Join without camera or mic
    </button>
  );

  return (
    <div
      className={`permission-gate gate-${view} ${who ? "over-call" : ""}`}
      role="dialog"
      aria-labelledby="gate-title"
    >
      <div className="gate-card">
        {view === "checking" && (
          <>
            <i className="self-spinner gate-spinner" />
            <h2 id="gate-title">Checking your camera and mic…</h2>
          </>
        )}

        {view === "prompt" && (
          <>
            <div className="gate-icons" aria-hidden="true">
              <span>
                <Icon name="camera" size={22} />
              </span>
              <span>
                <Icon name="mic" size={22} />
              </span>
            </div>
            <h2 id="gate-title">Allow camera and microphone</h2>
            <p>
              {who ? `${who} joined the session. ` : ""}Allow access so you can
              see and hear each other. Your browser will ask you to confirm.
            </p>
            <button type="button" className="gate-primary" onClick={request}>
              Allow access
            </button>
            {skipButton}
            <small>You can turn them off any time from the controls below.</small>
          </>
        )}

        {view === "waiting" && (
          <>
            <span className="gate-arrow" aria-hidden="true">
              <Icon name="arrowUp" size={22} />
            </span>
            <h2 id="gate-title">Check your browser</h2>
            <p>
              Click <b>Allow</b> in the permission popup near the address bar.
            </p>
            {skipButton}
          </>
        )}

        {view === "denied" && (
          <>
            <div className="gate-icons blocked" aria-hidden="true">
              <span>
                <Icon name="cameraOff" size={22} />
              </span>
            </div>
            <h2 id="gate-title">Camera and microphone are blocked</h2>
            <ol>
              <li>Click the lock or settings icon next to the address bar.</li>
              <li>
                Set <b>Camera</b> and <b>Microphone</b> to <b>Allow</b>.
              </li>
              <li>Press Try again (reload the page if it still doesn't work).</li>
            </ol>
            <button type="button" className="gate-primary" onClick={request}>
              Try again
            </button>
            {skipButton}
          </>
        )}

        {view === "error" && (
          <>
            <div className="gate-icons blocked" aria-hidden="true">
              <span>
                <Icon name="cameraOff" size={22} />
              </span>
            </div>
            <h2 id="gate-title">Couldn't start your devices</h2>
            <p>{error?.message || "Camera and microphone aren't available."}</p>
            {permission !== "unsupported" && (
              <button type="button" className="gate-primary" onClick={request}>
                Try again
              </button>
            )}
            {skipButton}
          </>
        )}
      </div>
    </div>
  );
}

// ── Invite links ─────────────────────────────────────────────────────────────
// Sessions are invite-only. The host's link carries a secret code:
//   https://<this site>/dashboard?invite=<32-char code>
// Only links from this site with a well-formed code are accepted here; the
// server then checks the code itself (POST /sessions/join).

const INVITE_CODE_RE = /^[A-Za-z0-9_-]{32}$/;

const inviteLinkFor = (code) =>
  `${window.location.origin}/dashboard?invite=${encodeURIComponent(code)}`;

function inviteCodeFrom(text) {
  let url;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin || url.pathname !== "/dashboard") {
    return null;
  }
  const code = url.searchParams.get("invite");
  return code && INVITE_CODE_RE.test(code) ? code : null;
}

// "Paste an invite link" field. onJoin(code) returns a promise; its error
// message (e.g. "This invite link has expired") is shown under the field.
function JoinLinkForm({ onJoin, autoFocus = false }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const errorId = useId();

  // On any problem: keep the message, but empty the field and put the
  // cursor back in it so the next link can be pasted straight away
  const fail = (message) => {
    setError(message);
    setValue("");
    inputRef.current?.focus();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const code = inviteCodeFrom(value);
    if (!code) {
      fail("That isn't a SkillSwap invite link. Ask the host to copy theirs again.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await onJoin(code);
      setValue("");
    } catch (err) {
      fail(err.message || "Couldn't join with that link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="join-link" onSubmit={submit} noValidate>
      <label className="join-link-field">
        <Icon name="link" size={16} />
        <input
          ref={inputRef}
          type="url"
          inputMode="url"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError("");
          }}
          placeholder="Paste an invite link…"
          aria-label="Invite link"
          aria-describedby={error ? errorId : undefined}
          autoFocus={autoFocus}
        />
        <button type="submit" disabled={busy || !value.trim()}>
          {busy ? "Joining…" : "Join"}
        </button>
      </label>
      {error && (
        <p id={errorId} className="join-link-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

const SEARCH_DELAY_MS = 300;

// Invite people by name: your connects first, then anyone on SkillSwap
// (GET /members?q=). Only the host can invite; everyone can join by link.
function InviteModal({ open, onClose, onSent, session, onJoinCode }) {
  const { darkMode } = useTheme();
  const { authFetch } = useAuth();
  // Your skill connects, live from the shared store (same list as My Skills)
  const { network } = useConnects();
  // Stay mounted while the fade-out plays, then unmount on animation end.
  const [mounted, setMounted] = useState(open);
  const [selected, setSelected] = useState([]); // picked people (objects)
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [others, setOthers] = useState({ status: "idle", members: [] });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  if (open && !mounted) setMounted(true);

  const isHost = Boolean(session?.isHost);
  const term = query.trim();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Search everyone on SkillSwap once there are 2+ characters
  useEffect(() => {
    if (!open || !isHost || term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setOthers((o) => ({ ...o, status: "loading" }));
      const params = new URLSearchParams({ q: term, limit: "8" });
      requestJson(authFetch, `/members?${params}`, { signal: controller.signal })
        .then((data) => setOthers({ status: "ready", members: data.members }))
        .catch((err) => {
          if (err.name !== "AbortError") setOthers({ status: "error", members: [] });
        });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, isHost, term, authFetch]);

  if (!mounted) return null;

  const toPick = (m) => ({
    id: m.id,
    name: m.name,
    photoV: m.photoV || null,
    skill: m.skills?.[0]?.name || "SkillSwap member",
  });
  const lower = term.toLowerCase();
  const connectIds = new Set(network.friends.map((m) => m.id));
  const connects = network.friends
    .map(toPick)
    .filter(
      (f) =>
        !lower ||
        f.name.toLowerCase().includes(lower) ||
        f.skill.toLowerCase().includes(lower),
    );
  const strangers =
    term.length >= 2
      ? others.members.filter((m) => !connectIds.has(m.id)).map(toPick)
      : [];

  const full = selected.length >= MAX_INVITES;
  const isPicked = (id) => selected.some((p) => p.id === id);
  const toggle = (person) =>
    setSelected((cur) =>
      cur.some((p) => p.id === person.id)
        ? cur.filter((p) => p.id !== person.id)
        : cur.length < MAX_INVITES
          ? [...cur, person]
          : cur,
    );

  const finish = () => {
    if (open) return;
    setMounted(false);
    setSelected([]);
    setQuery("");
    setCopied(false);
    setSendError("");
    setOthers({ status: "idle", members: [] });
  };

  const link = isHost && session.inviteCode ? inviteLinkFor(session.inviteCode) : "";
  const copyLink = (e) => {
    const input = e.currentTarget.previousElementSibling;
    if (!navigator.clipboard) return input.select();
    navigator.clipboard.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => input.select(),
    );
  };

  const send = async () => {
    setSending(true);
    setSendError("");
    try {
      await requestJson(authFetch, `/sessions/${session.roomId}/invites`, {
        method: "POST",
        body: JSON.stringify({ userIds: selected.map((p) => p.id) }),
      });
      onSent(selected);
      onClose();
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  const joinWithCode = async (code) => {
    await onJoinCode(code);
    onClose();
  };

  const row = (f) => {
    const checked = isPicked(f.id);
    const disabled = full && !checked;
    return (
      <li key={f.id}>
        <label
          className={`invite-friend ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}`}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() => toggle(f)}
          />
          <UserAvatar id={f.id} name={f.name} photoV={f.photoV} className="avatar" />
          <span>
            <strong>{f.name}</strong>
            <small>{f.skill}</small>
          </span>
          <span className="invite-check" aria-hidden="true">
            <Icon name="check" size={14} />
          </span>
        </label>
      </li>
    );
  };

  return createPortal(
    <div
      className={`invite-overlay ${open ? "is-open" : "is-closing"} ${darkMode ? "" : "is-light"}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onAnimationEnd={(e) => e.target === e.currentTarget && finish()}
    >
      <div
        className="invite-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-title"
      >
        <header>
          <span className="invite-badge">
            <Icon name="invite" size={20} />
          </span>
          <div>
            <h2 id="invite-title">{isHost ? "Invite friends" : "Invites"}</h2>
            <p>
              {isHost
                ? `This session is invite-only. Share your link, or invite one person or up to ${MAX_INVITES} by name.`
                : `Only ${session?.host?.name || "the host"} can invite people to this session.`}
            </p>
          </div>
          <button
            type="button"
            className="invite-x"
            onClick={onClose}
            aria-label="Close invite dialog"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        {isHost && (
          <div className="invite-link">
            <Icon name="link" size={16} />
            <input
              readOnly
              value={link}
              aria-label="Your invite link"
              onFocus={(e) => e.target.select()}
            />
            <button type="button" onClick={copyLink}>
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
        )}

        <div className="invite-join">
          <span>Got an invite link from someone?</span>
          <JoinLinkForm onJoin={joinWithCode} autoFocus={!isHost} />
        </div>

        {isHost && (
          <>
            <label className="invite-search">
              <Icon name="search" size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search anyone on SkillSwap by name or skill"
                aria-label="Search people to invite"
                maxLength={50}
              />
            </label>

            <div className="invite-count" aria-live="polite">
              <span>Invite people</span>
              <b className={full ? "full" : ""}>
                {selected.length} / {MAX_INVITES} selected
              </b>
            </div>

            <ul className="invite-list">
              {/* People picked from an earlier search stay visible */}
              {selected
                .filter((p) => !connects.some((f) => f.id === p.id) && !strangers.some((f) => f.id === p.id))
                .map(row)}

              {connects.length > 0 && (
                <li className="invite-group" aria-hidden="true">
                  Your skill connects
                </li>
              )}
              {connects.map(row)}

              {term.length >= 2 && (
                <li className="invite-group" aria-hidden="true">
                  Everyone on SkillSwap
                </li>
              )}
              {term.length >= 2 && others.status === "loading" && strangers.length === 0 && (
                <li className="invite-empty">Searching…</li>
              )}
              {term.length >= 2 && others.status === "error" && (
                <li className="invite-empty">Couldn’t search right now. Try again.</li>
              )}
              {strangers.map(row)}
              {term.length >= 2 &&
                others.status === "ready" &&
                strangers.length === 0 &&
                connects.length === 0 && (
                  <li className="invite-empty">No one on SkillSwap matches “{term}”.</li>
                )}

              {network.status === "loading" && term.length < 2 && (
                <li className="invite-empty">Loading your skill connects…</li>
              )}
              {network.status !== "loading" &&
                network.friends.length === 0 &&
                term.length < 2 && (
                  <li className="invite-empty">
                    Type a name to find anyone on SkillSwap, or share your
                    invite link.
                  </li>
                )}
            </ul>

            {sendError && (
              <p className="invite-error" role="alert">
                {sendError}
              </p>
            )}
          </>
        )}

        <footer>
          <button type="button" className="invite-cancel" onClick={onClose}>
            {isHost ? "Cancel" : "Close"}
          </button>
          {isHost && (
            <button
              type="button"
              className="invite-send"
              disabled={selected.length === 0 || sending}
              onClick={send}
            >
              {sending
                ? "Sending…"
                : selected.length > 1
                  ? `Send ${selected.length} invites`
                  : "Send invite"}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Sidebar({
  panel,
  close,
  onInvite,
  mirror,
  setMirror,
  media,
  speakerId,
  setSpeakerId,
  participants,
  roomId,
  hostName,
  chat,
  myId,
  typingNames,
  sendTyping,
  isHost,
  onAllowShare,
}) {
  const titles = {
    people: "People",
    chat: "Session chat",
    notes: "Session notes",
    settings: "Settings",
  };
  return (
    <aside className="sidebar">
      <header>
        <div>
          <span>Studio session</span>
          <h2>{titles[panel]}</h2>
        </div>
        <button onClick={close} aria-label="Close panel">
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="side-content">
        {panel === "people" && (
          <>
            <div className="side-meta">
              <span>In this session</span>
              <b>{participants.length}</b>
            </div>
            {participants.length === 0 && (
              <p className="people-empty">
                No one’s in this video session yet. People show up here once
                they join — invite someone to get started.
              </p>
            )}
            <div className="people">
              {participants.map((p) => (
                <div className="person" key={p.id}>
                  {/* Initials only here — no profile photos in this panel */}
                  <UserAvatar
                    id={p.userId || p.id}
                    name={p.name}
                    photo={false}
                    className="avatar"
                  >
                    {p.connected && <em />}
                  </UserAvatar>
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.role}</small>
                  </span>
                  <span
                    className={`person-mic ${p.mic ? "" : "mic-off"}`}
                    aria-label={p.mic ? "Mic on" : "Muted"}
                  >
                    <Icon name="mic" size={14} />
                  </span>
                  {/* Host: let this person share their screen (or stop them) */}
                  {isHost && p.id !== "self" && p.userId && (
                    <button
                      type="button"
                      className={`person-share ${p.canShare ? "is-on" : ""}`}
                      aria-pressed={p.canShare}
                      onClick={() => onAllowShare(p.userId, !p.canShare)}
                      title={
                        p.presenting
                          ? `Stop ${p.name}'s screen share`
                          : p.canShare
                            ? `${p.name} can share their screen — click to turn off`
                            : `Let ${p.name} share their screen`
                      }
                    >
                      {p.presenting ? "Stop share" : p.canShare ? "Can share" : "Allow share"}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button className="wide-button" type="button" onClick={onInvite}>
              Invite people
            </button>
          </>
        )}
        {panel === "chat" && (
          <SessionChat chat={chat} myId={myId} typingNames={typingNames} sendTyping={sendTyping} />
        )}
        {panel === "notes" && (
          // Host shares links/PDFs/images; everyone else opens or downloads
          <SessionNotes roomId={roomId} hostName={hostName} />
        )}
        {panel === "settings" && (
          <SessionSettings
            media={media}
            mirror={mirror}
            setMirror={setMirror}
            speakerId={speakerId}
            setSpeakerId={setSpeakerId}
          />
        )}
      </div>
    </aside>
  );
}

// Leave confirmation. Same fade in/out as the invite modal.
function LeaveModal({ open, onCancel, onConfirm, endsSession = false }) {
  const { darkMode } = useTheme();
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`invite-overlay confirm-overlay ${open ? "is-open" : "is-closing"} ${darkMode ? "" : "is-light"}`}
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
      onAnimationEnd={(e) =>
        e.target === e.currentTarget && !open && setMounted(false)
      }
    >
      <div
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        aria-describedby="leave-desc"
      >
        <span className="confirm-icon" aria-hidden="true">
          <Icon name="exit" size={22} />
        </span>
        <h2 id="leave-title">Are you sure you want to exit?</h2>
        <p id="leave-desc">
          {endsSession
            ? "This ends the video session for both of you. Your camera and microphone will turn off and you'll both be free to start new sessions."
            : "Your camera and microphone will turn off and you'll be disconnected from everyone in this session."}
        </p>
        <div className="confirm-actions">
          <button type="button" className="confirm-yes" onClick={onConfirm}>
            Yes
          </button>
          <button
            type="button"
            className="confirm-no"
            onClick={onCancel}
            autoFocus
          >
            No
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// "Do you want to record?" — the host's confirmation before recording.
// Same look and fade as the leave modal (Yes on the left, No on the right).
function RecordModal({ open, onCancel, onConfirm }) {
  const { darkMode } = useTheme();
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`invite-overlay confirm-overlay ${open ? "is-open" : "is-closing"} ${darkMode ? "" : "is-light"}`}
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
      onAnimationEnd={(e) => e.target === e.currentTarget && !open && setMounted(false)}
    >
      <div
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="record-title"
        aria-describedby="record-desc"
      >
        <span className="confirm-icon is-record" aria-hidden="true">
          <Icon name="record" size={22} />
        </span>
        <h2 id="record-title">Do you want to record?</h2>
        <p id="record-desc">
          Everyone in this session will see that it's being recorded. When you stop, the
          video is saved to your computer.
        </p>
        <div className="confirm-actions">
          <button type="button" className="confirm-yes" onClick={onConfirm}>
            Yes
          </button>
          <button type="button" className="confirm-no" onClick={onCancel} autoFocus>
            No
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Shown after leaving: still on the Live Sessions tab, nothing streaming.
function LeftScreen({ onRejoin, onStartNew }) {
  return (
    <section className="meeting-shell" aria-label="Live session">
      <div className="meeting left-screen">
        <div className="permission-gate">
          <div className="gate-card">
            <div className="gate-icons" aria-hidden="true">
              <span>
                <Icon name="exit" size={22} />
              </span>
            </div>
            <h2>You left the session</h2>
            <p>
              Your camera and microphone are off and you're no longer connected.
            </p>
            <button type="button" className="gate-primary" onClick={onRejoin}>
              Rejoin session
            </button>
            <button
              type="button"
              className="gate-secondary"
              onClick={onStartNew}
            >
              Start a new session
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Gallery ──────────────────────────────────────────────────────────────────

// Everyone actively in this session — just you, or up to the room limit —
// as cards (photo, name, You/Host/Presenting, mic & camera). Only the layout
// changes; videos keep playing underneath so nobody's audio cuts out.
const GALLERY_VIEWS = [
  ["grid", "Grid", "gallery"],
  ["list", "List", "viewList"],
  ["compact", "Compact", "viewCompact"],
];
const GALLERY_VIEW_KEY = "skillswap.galleryView";

function readGalleryView() {
  try {
    const saved = localStorage.getItem(GALLERY_VIEW_KEY);
    return GALLERY_VIEWS.some(([id]) => id === saved) ? saved : "grid";
  } catch {
    return "grid";
  }
}

// A card's live camera. Muted: the main video tiles already play everyone's
// audio (and your own would echo).
function GalleryVideo({ stream, mirror }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
  }, [stream]);
  return (
    <video
      ref={ref}
      className={`gallery-video ${mirror ? "is-mirrored" : ""}`}
      autoPlay
      playsInline
      muted
    />
  );
}

function GalleryView({ members, onClose }) {
  const [view, setView] = useState(readGalleryView);

  const choose = (next) => {
    setView(next);
    try {
      localStorage.setItem(GALLERY_VIEW_KEY, next);
    } catch {
      // Private mode / blocked storage: the choice just isn't remembered
    }
  };

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section className="gallery" aria-label="Gallery">
      <header className="gallery-head">
        <div className="gallery-title">
          <strong>Gallery</strong>
          <small>
            {members.length} {members.length === 1 ? "person" : "people"} in this session
          </small>
        </div>
        <div className="gallery-views" role="radiogroup" aria-label="Gallery layout">
          {GALLERY_VIEWS.map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={view === id}
              className={view === id ? "is-on" : ""}
              onClick={() => choose(id)}
              title={`${label} view`}
            >
              <Icon name={icon} size={15} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="gallery-close" onClick={onClose} aria-label="Close gallery">
          <Icon name="close" size={16} />
        </button>
      </header>

      <ul className={`gallery-cards is-${view}`}>
        {members.map((m) => (
          <li key={m.id} className={`gallery-card ${m.presenting ? "is-presenting" : ""}`}>
            {/* Their camera when it's on; otherwise their photo or initials */}
            <span className={`gallery-media ${m.camera && m.stream ? "has-video" : ""}`}>
              {m.camera && m.stream ? (
                <GalleryVideo stream={m.stream} mirror={m.mirror} />
              ) : (
                <UserAvatar
                  id={m.userId || m.id}
                  name={m.name}
                  photoV={m.photoV}
                  className="gallery-photo"
                  alt={`${m.name}'s photo`}
                />
              )}
            </span>
            <span className="gallery-info">
              <strong title={m.name}>{m.name}</strong>
              {(m.you || m.host || m.presenting || m.connecting) && (
                <span className="gallery-tags">
                  {m.you && <em>You</em>}
                  {m.host && <em className="is-host">Host</em>}
                  {m.presenting && <em className="is-presenting">Presenting</em>}
                  {m.connecting && <em>Joining…</em>}
                </span>
              )}
            </span>
            <span className="gallery-state">
              <i className={m.mic ? "" : "is-off"} title={m.mic ? "Mic on" : "Muted"}>
                <Icon name="mic" size={13} />
                <span className="sr-only">{m.mic ? "Mic on" : "Muted"}</span>
              </i>
              <i className={m.camera ? "" : "is-off"} title={m.camera ? "Camera on" : "Camera off"}>
                <Icon name="camera" size={13} />
                <span className="sr-only">{m.camera ? "Camera on" : "Camera off"}</span>
              </i>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// One connection to a room. Unmounting it (leaving) stops the camera and
// mic and disconnects from every peer — the hooks clean up after themselves.
function SessionRoom({ roomId, session, onJoinCode, onLeave, onCallEnd, onEnded, onCallChange }) {
  const { user, accessToken, reportActivity } = useAuth();
  const [panel, setPanel] = useState("people");
  // Start with the side panel closed on phones/tablets so it doesn't cover the video.
  const [open, setOpen] = useState(
    () => window.matchMedia("(min-width: 1100px)").matches,
  );
  const [mirror, setMirrorState] = useState(() => readSetting(MIRROR_KEY, "1") === "1");
  const setMirror = (on) => {
    setMirrorState(on);
    saveSetting(MIRROR_KEY, on ? "1" : "0");
  };
  const [speakerId, setSpeakerIdState] = useState(() => readSetting(SPEAKER_KEY, ""));
  const setSpeakerId = (id) => {
    setSpeakerIdState(id);
    saveSetting(SPEAKER_KEY, id);
  };
  const [gallery, setGallery] = useState(false);
  const closeGallery = useCallback(() => setGallery(false), []);
  // The video shown filling the browser window ("self" or a peer id), and
  // the button that opened it (focus goes back there on exit)
  const [enlargedId, setEnlargedId] = useState(null);
  const enlargeOpener = useRef(null);
  const enlarge = (id, opener) => {
    enlargeOpener.current = opener instanceof Element ? opener : null;
    setEnlargedId(id);
  };
  const closeEnlarged = useCallback(() => {
    setEnlargedId(null);
    enlargeOpener.current?.focus?.({ preventScroll: true });
  }, []);
  // Reactions: the emoji picker, and the emoji floating up the video
  const [reactOpen, setReactOpen] = useState(false);
  const [floats, setFloats] = useState([]);
  const [lastReaction, setLastReaction] = useState("");
  const floatId = useRef(0);
  const lastSent = useRef(0);
  const peersRef = useRef([]);
  // Screen sharing: our captured screen track while we're presenting
  const [screen, setScreen] = useState(null);
  const screenRef = useRef(null);
  const [shareNotice, setShareNotice] = useState("");
  // Recording (host only): the confirm modal, our recorder, and a clock tick
  const [recordOpen, setRecordOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recNow, setRecNow] = useState(0);
  // Participants: "you're being recorded" banner (stays until dismissed)
  const [recAlert, setRecAlert] = useState(false);
  // Top bar ⋯ menu
  const [moreOpen, setMoreOpen] = useState(false);
  const recorderRef = useRef(null);
  const recTilesRef = useRef([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invited, setInvited] = useState(null);

  // Connect to the room straight away (no camera/mic yet) so we know when
  // someone else arrives.
  const media = useLocalMedia();
  // What we're actually sending, not just the on/off preference
  const liveMic = media.mic && Boolean(media.tracks.audio);
  const liveCamera = Boolean(media.tracks.video);
  // While presenting, the screen goes out in place of the camera (same
  // connections, no renegotiation — and new joiners get it too)
  const outTracks = useMemo(
    () => (screen ? { ...media.tracks, video: screen } : media.tracks),
    [screen, media.tracks],
  );
  const isHost = Boolean(session?.isHost);
  const hostFirst = session?.host?.name?.split(" ")[0] || "the host";
  const myUserId = user?.id;
  // The server changed who's presenting / who may share
  const onShareChange = useCallback(
    (prev, next, selfSocket) => {
      // Our share was ended for us (host took over, permission removed)
      if (prev.presenter === selfSocket && next.presenter !== selfSocket && screenRef.current) {
        const track = screenRef.current;
        screenRef.current = null;
        track.onended = null;
        track.stop();
        setScreen(null);
        setShareNotice(
          next.presenter ? `${hostFirst} is presenting now` : `${hostFirst} stopped your screen share`,
        );
        return;
      }
      if (isHost || !myUserId) return;
      const was = prev.allowed.includes(myUserId);
      const now = next.allowed.includes(myUserId);
      if (!was && now) setShareNotice(`${hostFirst} allowed you to share your screen`);
      if (was && !now) setShareNotice(`${hostFirst} turned off screen sharing for you`);
    },
    [hostFirst, isHost, myUserId],
  );
  // One emoji drifting up from the bottom of the video, then fading out
  const addFloat = useCallback((key, name) => {
    const reaction = REACTION_BY_KEY[key];
    if (!reaction) return;
    floatId.current += 1;
    const float = {
      id: floatId.current,
      emoji: reaction.emoji,
      name,
      x: 12 + Math.random() * 76, // % across the video
      drift: Math.round((Math.random() - 0.5) * 70), // px of sideways sway
      duration: Math.round(2600 + Math.random() * 900), // ms
    };
    setFloats((current) => [...current.slice(-(MAX_FLOATS - 1)), float]);
  }, []);
  const onRemoteReaction = useCallback(
    (peerId, key) => {
      const reaction = REACTION_BY_KEY[key];
      if (!reaction) return;
      const name = peersRef.current.find((p) => p.id === peerId)?.name?.split(" ")[0] || "Someone";
      addFloat(key, name);
      setLastReaction(`${name} reacted ${reaction.label}`);
    },
    [addFloat],
  );
  // Session chat (held here so the Chat button can count unread messages)
  const chat = useSessionChat(roomId, { visible: open && panel === "chat", myId: user?.id });
  const room = usePeerRoom({
    roomId,
    enabled: true,
    token: accessToken,
    tracks: outTracks,
    mic: liveMic,
    camera: liveCamera || Boolean(screen),
    onReaction: onRemoteReaction,
    onTyping: chat.peerTyping,
    onShareChange,
    onRecChange: (next) => {
      if (next.active) {
        if (isHost) setShareNotice("Recording started");
        else setRecAlert(true);
        return;
      }
      setRecAlert(false);
      if (!isHost) setShareNotice(`${hostFirst} stopped recording`);
      // Our recording was ended for us (e.g. we reconnected) — save it
      if (recorderRef.current) finishRecording();
    },
  });
  const peers = room.peers;
  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  // Your own reaction: shows straight away, then goes to everyone else.
  // A short gap between taps stops accidental double-sends.
  const react = (key, event) => {
    const now = event.timeStamp;
    if (now - lastSent.current < REACTION_GAP_MS) return;
    lastSent.current = now;
    addFloat(key, null);
    room.sendReaction(key);
  };
  const removeFloat = (id) => setFloats((current) => current.filter((f) => f.id !== id));

  // Close the picker with Esc or a tap/click anywhere else
  useEffect(() => {
    if (!reactOpen) return;
    const onPointer = (e) => {
      if (!e.target.closest?.(".react-picker, [data-react-toggle]")) setReactOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setReactOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [reactOpen]);
  // A video session needs you plus at least one other person
  const inCall = peers.length > 0;
  // Being in a call counts as activity, so the 15-minute inactivity
  // sign-out (auth/AuthProvider.jsx) never ends a call you're just watching
  useEffect(() => {
    if (!inCall) return;
    reportActivity();
    const timer = setInterval(reportActivity, 60_000);
    return () => clearInterval(timer);
  }, [inCall, reportActivity]);
  // React, Gallery, Share, People, Notes and Chat only work in an active
  // session (you plus someone else). Their panels hide when it isn't;
  // Settings works any time (set up devices before anyone joins).
  const sideOpen = open && (inCall || panel === "settings");

  // Who was in the call (kept after they go, for "Call again")
  const lastPeersRef = useRef([]);
  useEffect(() => {
    if (peers.length) {
      lastPeersRef.current = peers
        .filter((p) => p.userId)
        .map((p) => ({ userId: p.userId, name: p.name }));
    }
  }, [peers]);

  // The server ended the call (the other person left): hand back to the
  // wrapper, which unmounts this room — camera, mic and socket all stop
  useEffect(() => {
    if (room.status === "ended") onEnded(lastPeersRef.current);
  }, [room.status, onEnded]);

  // Camera and mic only start once a video session begins. If access was
  // already allowed they start by themselves; otherwise the permission
  // screen asks first.
  const { permission, phase, request, release } = media;
  useEffect(() => {
    if (inCall && permission === "granted" && phase === "idle") request();
  }, [inCall, permission, phase, request]);
  // No video session any more → nothing to leave (closes the leave dialog)
  useEffect(() => {
    if (!inCall) onCallEnd();
  }, [inCall, onCallEnd]);
  // Tell the dashboard, so switching tabs mid-call keeps this room running
  useEffect(() => {
    onCallChange?.(inCall);
  }, [inCall, onCallChange]);
  useEffect(() => () => onCallChange?.(false), [onCallChange]);

  // Back on your own: turn them off again. The short delay rides out a
  // brief reconnect without flicking the camera off and on.
  useEffect(() => {
    if (inCall || phase !== "ready") return;
    const timer = setTimeout(release, 5000);
    return () => clearTimeout(timer);
  }, [inCall, phase, release]);

  const selfStream = useMemo(
    () => (media.tracks.video ? new MediaStream([media.tracks.video]) : null),
    [media.tracks.video],
  );
  let selfStatus = "off";
  if (media.phase === "requesting") selfStatus = "starting";
  else if (media.tracks.video) selfStatus = "live";
  else if (media.deviceError && !media.camera) selfStatus = "error";

  const selfView = (className) => (
    <SelfView
      stream={selfStream}
      status={selfStatus}
      error={media.deviceError}
      mirror={mirror}
      mic={liveMic}
      me={{ id: user?.id, name: myName, photoV: user?.photoV }}
      className={className}
      onEnlarge={(opener) => enlarge("self", opener)}
    />
  );

  const myName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.userName ||
    "You";
  // People: only who's in this video session with you right now. `peers`
  // comes from this session's room on the signaling server — someone
  // appears when they join it and is gone the moment they leave or drop —
  // so people in other sessions never show up. Alone = nobody listed.
  const PEER_ROLE = {
    connected: "In session",
    disconnected: "Reconnecting…",
    failed: "Reconnecting…",
  };
  const participants = inCall
    ? [
        {
          id: "self",
          userId: user?.id,
          photoV: user?.photoV,
          name: `${myName} (You)`,
          role: screen ? "Presenting" : media.active ? "In session" : "Getting ready",
          mic: liveMic,
          connected: room.status === "connected",
        },
        ...peers.map((p) => ({
          id: p.id,
          userId: p.userId,
          photoV: p.photoV,
          name: p.name || "Joining…",
          role:
            p.id === room.share.presenter
              ? "Presenting"
              : PEER_ROLE[p.connection] || "Joining…",
          presenting: p.id === room.share.presenter,
          canShare: Boolean(p.userId) && room.share.allowed.includes(p.userId),
          mic: p.mic,
          connected: p.connection === "connected",
        })),
      ]
    : [];

  let sessionStatus = "Connecting…";
  if (room.status === "connected")
    sessionStatus = inCall ? `${peers.length + 1} in session` : "Waiting for others";
  else if (room.status === "reconnecting") sessionStatus = "Reconnecting…";
  else if (room.status === "error") sessionStatus = "Not connected";

  // You're the corner preview; the Gallery button shows everyone as cards.
  const presenterId = room.share.presenter;
  const presenterPeer = peers.find((p) => p.id === presenterId) || null;
  const ordered = presenterPeer ? [presenterPeer, ...peers.filter((p) => p !== presenterPeer)] : peers;
  const tiles = ordered;
  // Gallery cards: you, then everyone else actively in the session
  const hostId = session?.host?.id;
  const galleryMembers = [
    {
      id: "self",
      userId: user?.id,
      photoV: user?.photoV,
      name: myName,
      you: true,
      host: isHost,
      mic: liveMic,
      camera: liveCamera,
      stream: selfStream,
      mirror,
      presenting: Boolean(screen),
    },
    ...peers.map((p) => ({
      id: p.id,
      userId: p.userId,
      photoV: p.photoV,
      name: p.name || "Guest",
      host: Boolean(hostId) && p.userId === hostId,
      mic: p.mic,
      // A presenter's video is their screen — show their photo instead
      camera: p.camera && p.id !== presenterId,
      stream: p.stream,
      presenting: p.id === presenterId,
      connecting: p.connection !== "connected" && p.connection !== "disconnected" && p.connection !== "failed",
    })),
  ];

  const enlargedMember =
    (inCall && enlargedId && galleryMembers.find((m) => m.id === enlargedId)) || null;

  // What the recording draws each frame: you (camera, or your screen while
  // presenting) and everyone else, with all voices
  const selfRecStream = useMemo(() => {
    const video = screen || media.tracks.video;
    const list = [video, media.tracks.audio].filter(Boolean);
    return list.length ? new MediaStream(list) : null;
  }, [screen, media.tracks.video, media.tracks.audio]);
  useEffect(() => {
    recTilesRef.current = [
      {
        key: "self",
        name: myName,
        userId: user?.id,
        stream: selfRecStream,
        showVideo: Boolean(screen || liveCamera),
        presenting: Boolean(screen),
      },
      ...peers.map((p) => ({
        key: p.id,
        name: p.name || "Guest",
        userId: p.userId,
        stream: p.stream,
        showVideo: p.camera || p.id === presenterId,
        presenting: p.id === presenterId,
      })),
    ];
  });

  // The REC clock: the server's start time, so it matches the recording
  useEffect(() => {
    if (!room.rec.active) return;
    const tick = () => setRecNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [room.rec.active]);
  const recElapsed = room.rec.active && recNow ? Math.max(0, recNow - room.rec.since) : 0;

  useEffect(() => {
    if (!moreOpen) return;
    const onPointer = (e) => !e.target.closest?.(".more-wrap") && setMoreOpen(false);
    const onKey = (e) => e.key === "Escape" && setMoreOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Yes in the modal: start recording here, then tell everyone
  const startRecording = async () => {
    setRecordOpen(false);
    if (!recordingSupported) {
      return setShareNotice("This browser can't record — try Chrome, Edge or Firefox on a computer");
    }
    let recorder;
    try {
      recorder = startSessionRecording({ getTiles: () => recTilesRef.current, title: "session" });
    } catch {
      return setShareNotice("Couldn't start recording. Please try again.");
    }
    const res = await room.startRec();
    if (res.error) {
      recorder.cancel();
      return setShareNotice(res.error);
    }
    recorderRef.current = recorder;
    setRecording(true);
  };

  // Stop: tell everyone, then save the video file to this computer
  const finishRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setRecording(false);
    room.stopRec();
    const saved = await recorder.stop();
    setShareNotice(saved ? `Recording saved to your Downloads — ${saved.fileName}` : "Nothing was recorded");
  };

  // Leaving (or the session ending) mid-recording still saves the file
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      recorder?.stop();
    },
    [],
  );

  useEffect(() => {
    if (!shareNotice) return;
    const timer = setTimeout(() => setShareNotice(""), SHARE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [shareNotice]);

  // Leaving the room (or the page) stops the capture
  useEffect(
    () => () => {
      const track = screenRef.current;
      if (track) {
        track.onended = null;
        track.stop();
      }
    },
    [],
  );

  const stopSharing = () => {
    const track = screenRef.current;
    screenRef.current = null;
    if (track) {
      track.onended = null;
      track.stop();
    }
    setScreen(null);
    room.stopShare();
  };

  // Share button: check permission first, then let the browser ask which
  // screen/window/tab, then claim the "stage" on the server
  const toggleShare = async () => {
    if (screenRef.current) return stopSharing();
    const { presenter, allowed } = room.share;
    if (!inCall) return setShareNotice("You can share your screen once someone joins");
    if (!CAN_SHARE_SCREEN) {
      return setShareNotice("This browser can't share its screen — try a computer");
    }
    if (!isHost && !allowed.includes(myUserId)) {
      return setShareNotice(`Ask ${hostFirst} to allow you to share your screen`);
    }
    if (presenter && presenter !== room.selfId && !isHost) {
      const name = peers.find((p) => p.id === presenter)?.name?.split(" ")[0] || "Someone";
      return setShareNotice(`${name} is presenting — wait for them to finish`);
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });
    } catch (err) {
      // Cancelled in the browser's picker → nothing to say
      if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
        setShareNotice("Couldn't start screen sharing. Please try again.");
      }
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    if ("contentHint" in track) track.contentHint = "detail"; // keep text sharp
    const res = await room.startShare();
    if (res.error) {
      track.stop();
      return setShareNotice(res.error);
    }
    screenRef.current = track;
    // The browser's own "Stop sharing" bar
    track.onended = () => {
      if (screenRef.current === track) stopSharing();
    };
    setScreen(track);
  };

  useEffect(() => {
    if (!invited) return;
    const timer = setTimeout(() => setInvited(null), 3000);
    return () => clearTimeout(timer);
  }, [invited]);

  const openInvite = () => setInviteOpen(true);
  const closeInvite = () => setInviteOpen(false);

  const show = (next) => {
    if (panel === next && sideOpen) setOpen(false);
    else {
      setPanel(next);
      setOpen(true);
      if (next === "chat") chat.markSeen();
    }
  };
  // First names of the people typing who are still in the call
  const typingNames = chat.typingIds
    .map((id) => peers.find((p) => p.id === id)?.name?.split(" ")[0])
    .filter(Boolean);

  return (
    <section className="meeting-shell" aria-label="Live session">
      <div className="meeting">
        <nav className="topbar">
          {/* Same mark and wordmark as the dashboard's Logo */}
          <div className="brand" aria-label="SkillSwap">
            <b aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L8 8H4l4 4-2 6 6-3 6 3-2-6 4-4h-4L12 2z"
                  fill="#0c0c0c"
                  opacity="0.9"
                />
                <path
                  d="M8 12 Q12 8 16 12 Q12 16 8 12Z"
                  fill="#0c0c0c"
                  opacity="0.5"
                />
              </svg>
            </b>
            <span>
              <strong>
                Skill<em>Swap</em>
              </strong>
              <small>Exchange · Grow</small>
            </span>
          </div>
          <div className="title">
            <h1>Brand direction review</h1>
            <span className={`session-status is-${room.status}`}>
              {sessionStatus}
            </span>
          </div>
          <div className="status">
            {/* Host: start/stop recording. Everyone: see when it's recording */}
            {isHost ? (
              <button
                type="button"
                className={`rec ${room.rec.active ? "is-live" : ""}`}
                onClick={() => (recording ? finishRecording() : setRecordOpen(true))}
                disabled={!inCall && !recording}
                aria-pressed={recording}
                title={
                  recording
                    ? "Stop recording and save the video"
                    : inCall
                      ? "Record this session"
                      : "You can record once someone joins your session"
                }
              >
                <i />
                <span>{room.rec.active ? "REC" : "Record"}</span>
                {room.rec.active && <time>{formatDuration(recElapsed)}</time>}
              </button>
            ) : (
              room.rec.active && (
                <span className="rec is-live" role="status" title={`${hostFirst} is recording this session`}>
                  <i />
                  <span>REC</span>
                  <time>{formatDuration(recElapsed)}</time>
                </span>
              )
            )}
            <div className="more-wrap">
              <button
                type="button"
                className="more-button"
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
              >
                <Icon name="more" />
              </button>
              {moreOpen && (
                <div className="more-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      openInvite();
                    }}
                  >
                    <Icon name="invite" size={16} />
                    Invite people
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      if (!(sideOpen && panel === "settings")) show("settings");
                    }}
                  >
                    <Icon name="settings" size={16} />
                    Settings
                  </button>
                </div>
              )}
            </div>
          </div>
        </nav>
  
        <section className={`stage ${sideOpen ? "open" : ""}`}>
          <div className="video-area">
            <div className="video">
              {tiles.length === 0 ? (
                <div className="invite-stage">
                  <button
                    type="button"
                    className="invite-cta"
                    onClick={openInvite}
                  >
                    <Icon name="invite" size={20} />
                    Invite friends
                  </button>
                  <span>
                    {room.status === "connected"
                      ? `You're the only one here. Your camera stays off until someone joins — bring up to ${MAX_INVITES} friends.`
                      : "Connecting to the session…"}
                  </span>
                </div>
              ) : (
                <div
                  className="peer-grid"
                  data-count={Math.min(tiles.length, 6)}
                  data-layout={presenterPeer && tiles.length > 1 ? "spotlight" : undefined}
                  style={{ "--others": Math.min(Math.max(tiles.length - 1, 1), 5) }}
                >
                  {tiles.map((t) => (
                    <PeerTile
                      key={t.id}
                      peer={t}
                      presenting={t.id === presenterId}
                      sinkId={speakerId}
                      onEnlarge={(opener) => enlarge(t.id, opener)}
                    />
                  ))}
                </div>
              )}
              <div className="tint" />
              {/* Someone joined: ask for camera/mic over their video */}
              {inCall && !media.active && (
                <PermissionGate media={media} who={peers[0]?.name} />
              )}
              {inCall && media.active && !gallery && selfView("")}
              {gallery && inCall && <GalleryView members={galleryMembers} onClose={closeGallery} />}
              {/* Enlarged video — closes by itself if they leave or the call ends */}
              {enlargedMember && <EnlargedView member={enlargedMember} onClose={closeEnlarged} />}
              {(room.status === "error" || room.status === "reconnecting") && (
                <div className={`room-alert is-${room.status}`} role="alert">
                  <span>{room.error || "Reconnecting to the session…"}</span>
                  {room.status === "error" && (
                    <button type="button" onClick={room.retry}>
                      Retry
                    </button>
                  )}
                </div>
              )}
              {/* Reactions float up from the bottom and fade out */}
              <div className="reaction-layer" aria-hidden="true">
                {floats.map((f) => (
                  <span
                    key={f.id}
                    className="reaction-float"
                    style={{ "--x": `${f.x}%`, "--drift": `${f.drift}px`, "--dur": `${f.duration}ms` }}
                    onAnimationEnd={(e) => e.target === e.currentTarget && removeFloat(f.id)}
                  >
                    <span className="reaction-emoji">{f.emoji}</span>
                    {f.name && <small>{f.name}</small>}
                  </span>
                ))}
              </div>
              <p className="sr-only" aria-live="polite">
                {lastReaction}
              </p>
              {screen ? (
                <div className="sharing" role="status">
                  <Icon name="share" size={16} />
                  You’re sharing your screen
                  <button type="button" onClick={stopSharing}>
                    Stop
                  </button>
                </div>
              ) : (
                presenterPeer && (
                  <div className="sharing" role="status">
                    <Icon name="share" size={16} />
                    {presenterPeer.name.split(" ")[0]} is presenting
                  </div>
                )
              )}
              {recAlert && room.rec.active && (
                <div className="rec-alert" role="alert">
                  <i aria-hidden="true" />
                  <span>
                    <b>{hostFirst} started recording</b>
                    <small>You’re being recorded — this is also saved in your notifications.</small>
                  </span>
                  <button type="button" onClick={() => setRecAlert(false)}>
                    Got it
                  </button>
                </div>
              )}
              {shareNotice && !invited && (
                <div className="invite-toast" role="status">
                  <Icon name="share" size={16} />
                  {shareNotice}
                </div>
              )}
              {invited && (
                <div className="invite-toast" role="status">
                  <Icon name="check" size={16} />
                  {invited.length === 1
                    ? `Invite sent to ${invited[0].name}`
                    : `Invites sent to ${invited.length} friends`}
                </div>
              )}
            </div>
            {reactOpen && inCall && (
              <div className="react-picker" role="group" aria-label="Send a reaction">
                {REACTIONS.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={(e) => react(r.key, e)}
                    aria-label={`React ${r.label}`}
                    title={r.label}
                  >
                    <span aria-hidden="true">{r.emoji}</span>
                  </button>
                ))}
              </div>
            )}
            {!sideOpen && inCall && (
              <button type="button" className="panel-peek" onClick={() => show("people")}>
                <Icon name="users" size={18} />
                <span>People</span>
                {participants.length > 0 && <b>{participants.length}</b>}
              </button>
            )}
          </div>
          {sideOpen && (
            <button
              className="side-backdrop"
              type="button"
              aria-label="Close panel"
              onClick={() => setOpen(false)}
            />
          )}
          <div className={`side-wrap ${sideOpen ? "shown" : ""}`}>
            {sideOpen && (
              <Sidebar
                panel={panel}
                close={() => setOpen(false)}
                onInvite={openInvite}
                mirror={mirror}
                setMirror={setMirror}
                media={media}
                speakerId={speakerId}
                setSpeakerId={setSpeakerId}
                participants={participants}
                roomId={roomId}
                hostName={session?.host?.name}
                chat={chat}
                myId={user?.id}
                typingNames={typingNames}
                sendTyping={room.sendTyping}
                isHost={isHost}
                onAllowShare={room.allowShare}
              />
            )}
          </div>
        </section>

        <RecordModal
          open={recordOpen}
          onCancel={() => setRecordOpen(false)}
          onConfirm={startRecording}
        />

        <InviteModal
          open={inviteOpen}
          onClose={closeInvite}
          onSent={setInvited}
          session={session}
          onJoinCode={onJoinCode}
        />
  
        <footer className="dock">
          <div>
            <Control
              icon="mic"
              label={media.mic ? "Mic" : "Unmute"}
              active={media.mic}
              onClick={media.toggleMic}
            />
            <Control
              icon="camera"
              label={media.camera ? "Camera" : "Start video"}
              active={media.camera}
              onClick={media.toggleCamera}
            />
            <Control
              icon="settings"
              label="Settings"
              active={sideOpen && panel === "settings"}
              onClick={() => show("settings")}
            />
          </div>
          <i className="divider" />
          <div>
            <Control
              icon="smile"
              disabled={!inCall}
              title={inCall ? undefined : "Available once someone joins your session"}
              label="React"
              active={reactOpen && inCall}
              onClick={() => setReactOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={reactOpen && inCall}
              data-react-toggle=""
            />
            <Control
              icon="gallery"
              disabled={!inCall}
              title={inCall ? undefined : "Available once someone joins your session"}
              label="Gallery"
              active={gallery && inCall}
              onClick={() => setGallery(!gallery)}
            />
            <Control
              icon="share"
              disabled={!inCall}
              label={screen ? "Stop share" : "Share"}
              active={Boolean(screen)}
              onClick={toggleShare}
              title={
                !inCall
                  ? "Available once someone joins your session"
                  : screen
                  ? "Stop sharing your screen"
                  : isHost || room.share.allowed.includes(myUserId)
                    ? "Share your screen"
                    : `Ask ${hostFirst} to allow you to share`
              }
            />
            <Control
              icon="users"
              disabled={!inCall}
              title={inCall ? undefined : "Available once someone joins your session"}
              label="People"
              active={sideOpen && panel === "people"}
              onClick={() => show("people")}
              badge={participants.length ? String(participants.length) : undefined}
            />
            <Control
              icon="notes"
              disabled={!inCall}
              title={inCall ? undefined : "Available once someone joins your session"}
              label="Notes"
              active={sideOpen && panel === "notes"}
              onClick={() => show("notes")}
            />
            <Control
              icon="chat"
              disabled={!inCall}
              title={inCall ? undefined : "Available once someone joins your session"}
              label="Chat"
              active={sideOpen && panel === "chat"}
              onClick={() => show("chat")}
              badge={chat.unread ? (chat.unread > 9 ? "9+" : String(chat.unread)) : undefined}
              aria-label={chat.unread ? `Chat, ${chat.unread} unread` : undefined}
            />
          </div>
          <i className="divider" />
          {/* Leave only applies to a video session with someone else */}
          <button
            className="leave"
            type="button"
            // With one other person, leaving ends the session for both
            onClick={() =>
              onLeave(
                peers.length <= 1,
                peers.filter((p) => p.userId).map((p) => ({ userId: p.userId, name: p.name })),
              )
            }
            disabled={!inCall}
            title={inCall ? "Leave the video session" : "No video session to leave yet"}
          >
            Leave
          </button>
        </footer>
      </div>
    </section>
  );
}

// Full-area message screen (starting, joining, invite-only, ended…)
// `rating`: the room id of an ended session — shows "Rate your session"
// under the text (for everyone who was in the call; nothing otherwise)
function StatusScreen({ icon = "exit", spinner = false, title, text, rating, children }) {
  return (
    <section className="meeting-shell" aria-label="Live session">
      <div className="meeting left-screen">
        <div className="permission-gate">
          <div
            className={`gate-card${rating ? " has-rating" : ""}`}
            role={spinner ? "status" : undefined}
          >
            {spinner ? (
              <i className="self-spinner gate-spinner" />
            ) : (
              <div className="gate-icons" aria-hidden="true">
                <span>
                  <Icon name={icon} size={22} />
                </span>
              </div>
            )}
            <h2>{title}</h2>
            {text && <p>{text}</p>}
            {rating && <SessionRating roomId={rating} />}
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

// Live Sessions tab. Sessions live on the server and are invite-only:
//   ?room=<id>       a session you host or were invited to
//   ?invite=<code>   an invite link — redeemed, then swapped for ?room=
//   (neither)        start a new session with you as host
const LiveSession = ({ onCallChange }) => {
  const { authFetch } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const roomParam = searchParams.get("room");
  const roomId = roomParam && ROOM_ID_RE.test(roomParam) ? roomParam : null;
  const inviteCode = searchParams.get("invite");

  // Session details for `roomId` (host, your role, the invite code if host)
  const [session, setSession] = useState({ roomId: null, status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Starting / joining problems (no room yet)
  const [setupError, setSetupError] = useState("");
  const [starting, setStarting] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);
  // Which room you left or that ended (so switching rooms shows the room)
  //   { roomId, ended } — ended: the session is over for everyone
  const [exit, setExit] = useState(null);
  // The Leave you're confirming: does it end the session, and who's in it
  const [leaveEnds, setLeaveEnds] = useState(false);
  const [leavePeers, setLeavePeers] = useState([]);
  const [callAgainError, setCallAgainError] = useState("");
  const [callingAgain, setCallingAgain] = useState(false);
  // Bumped on rejoin so the session starts fresh (new media + connection)
  const [joinCount, setJoinCount] = useState(0);

  const goToRoom = useCallback(
    (id) =>
      setSearchParams((params) => {
        params.delete("invite");
        params.set("room", id);
        return params;
      }),
    [setSearchParams],
  );

  const startNew = useCallback(async () => {
    setSetupError("");
    setStarting(true);
    try {
      const { session: created } = await requestJson(authFetch, "/sessions", {
        method: "POST",
      });
      goToRoom(created.roomId);
    } catch (err) {
      setSetupError(err.message);
    } finally {
      setStarting(false);
    }
  }, [authFetch, goToRoom]);

  // Redeem an invite code (from a pasted link or ?invite=); throws on failure
  const joinCode = useCallback(
    async (code) => {
      const { session: joined } = await requestJson(authFetch, "/sessions/join", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setSetupError("");
      goToRoom(joined.roomId);
    },
    [authFetch, goToRoom],
  );

  // Opened from an invite link
  useEffect(() => {
    if (!inviteCode) return;
    const controller = new AbortController();
    requestJson(authFetch, "/sessions/join", {
      method: "POST",
      body: JSON.stringify({ code: inviteCode }),
      signal: controller.signal,
    })
      .then(({ session: joined }) => {
        setSetupError("");
        goToRoom(joined.roomId);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setSetupError(err.message);
        setSearchParams(
          (params) => {
            params.delete("invite");
            return params;
          },
          { replace: true },
        );
      });
    return () => controller.abort();
  }, [inviteCode, authFetch, goToRoom, setSearchParams]);

  // Nothing in the URL: start a session with you as host
  useEffect(() => {
    if (roomId || inviteCode || setupError) return;
    const timer = setTimeout(startNew, 0); // after StrictMode's test unmount
    return () => clearTimeout(timer);
  }, [roomId, inviteCode, setupError, startNew]);

  // Load the session you're in
  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    requestJson(authFetch, `/sessions/${roomId}`, { signal: controller.signal })
      .then((data) => setSession({ roomId, status: "ready", data: data.session }))
      .catch((err) => {
        if (err.name === "AbortError") return;
        setSession({ roomId, status: "error", code: err.status, error: err.message });
      });
    return () => controller.abort();
  }, [authFetch, roomId, attempt]);

  const leave = () => {
    setConfirmOpen(false);
    // Unmounts SessionRoom → stream stops and the socket leaves right away
    setExit({ roomId, ended: leaveEnds, peers: leavePeers });
  };
  const rejoin = () => {
    setExit(null);
    setJoinCount((n) => n + 1);
  };
  const ended = useCallback(
    (peers = []) => {
      setConfirmOpen(false);
      setExit({ roomId, ended: true, peers });
    },
    [roomId],
  );

  // An ended session never reopens. To talk again, start a brand-new
  // session and invite the same people (it rings for them right away).
  const callAgain = async (peers) => {
    setCallAgainError("");
    setCallingAgain(true);
    try {
      const { session: created } = await requestJson(authFetch, "/sessions", {
        method: "POST",
      });
      await requestJson(authFetch, `/sessions/${created.roomId}/invites`, {
        method: "POST",
        body: JSON.stringify({ userIds: peers.slice(0, MAX_INVITES).map((p) => p.userId) }),
      });
      goToRoom(created.roomId);
    } catch (err) {
      setCallAgainError(err.message);
    } finally {
      setCallingAgain(false);
    }
  };

  const current = session.roomId === roomId ? session : { status: "loading" };
  const joinOptions = (
    <>
      <JoinLinkForm onJoin={joinCode} />
      <button
        type="button"
        className="gate-secondary"
        onClick={startNew}
        disabled={starting}
      >
        {starting ? "Starting…" : "Start my own session"}
      </button>
    </>
  );

  let screen;
  if (inviteCode && !setupError) {
    screen = <StatusScreen spinner title="Joining the session…" />;
  } else if (!roomId) {
    screen = setupError ? (
      <StatusScreen
        icon="link"
        title="Couldn't open that session"
        text={setupError}
      >
        {joinOptions}
      </StatusScreen>
    ) : (
      <StatusScreen spinner title="Starting your session…" />
    );
  } else if (current.status === "loading") {
    screen = <StatusScreen spinner title="Loading the session…" />;
  } else if (current.status === "error") {
    screen = (
      <StatusScreen
        icon={current.code === 403 ? "link" : "exit"}
        title={
          current.code === 403
            ? "This session is invite-only"
            : current.code === 404
              ? "This session has ended"
              : "Couldn't load the session"
        }
        text={current.error}
        rating={current.code === 404 ? roomId : undefined}
      >
        {current.code !== 403 && current.code !== 404 && (
          <button
            type="button"
            className="gate-primary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        )}
        {joinOptions}
      </StatusScreen>
    );
  } else if (exit?.roomId === roomId && exit.ended) {
    // Over for good: no way back in, but free to start or join another
    const others = exit.peers || [];
    const againLabel =
      others.length === 1 ? `Call ${others[0].name.split(" ")[0]} again` : "Call them again";
    screen = (
      <StatusScreen
        icon="exit"
        title="The session has ended"
        text="That session is closed for good. Start a new one to talk again, or join someone else's with their invite link."
        rating={roomId}
      >
        {others.length > 0 && (
          <button
            type="button"
            className="gate-primary"
            onClick={() => callAgain(others)}
            disabled={callingAgain || starting}
          >
            {callingAgain ? "Calling…" : againLabel}
          </button>
        )}
        {callAgainError && (
          <p className="join-link-error" role="alert">
            {callAgainError}
          </p>
        )}
        <button
          type="button"
          className={others.length > 0 ? "gate-secondary" : "gate-primary"}
          onClick={startNew}
          disabled={starting || callingAgain}
        >
          {starting ? "Starting…" : "Start a new session"}
        </button>
        <JoinLinkForm onJoin={joinCode} />
      </StatusScreen>
    );
  } else if (exit?.roomId === roomId) {
    screen = <LeftScreen onRejoin={rejoin} onStartNew={startNew} />;
  } else {
    screen = (
      <SessionRoom
        key={`${roomId}-${joinCount}`}
        roomId={roomId}
        session={current.data}
        onJoinCode={joinCode}
        onLeave={(endsSession, peers) => {
          setLeaveEnds(endsSession);
          setLeavePeers(peers);
          setConfirmOpen(true);
        }}
        onCallEnd={closeConfirm}
        onEnded={ended}
        onCallChange={onCallChange}
      />
    );
  }

  return (
    <>
      {screen}
      <LeaveModal
        open={confirmOpen}
        onCancel={closeConfirm}
        onConfirm={leave}
        endsSession={leaveEnds}
      />
    </>
  );
};

export default LiveSession;

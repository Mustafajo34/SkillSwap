import { useEffect, useRef } from "react";

// Bank-style session messages, shown over any page (rendered by
// AuthProvider, outside the dashboard's theme, so they use the app's fixed
// dark + gold colours).
//
//   IdleWarning     "Still there?" with a countdown, before the 15-minute
//                   inactivity sign-out. Only the buttons answer it —
//                   moving the mouse doesn't, as at a bank.
//   SignedOutNotice why you were signed out (inactivity, 8-hour limit…)

const mmss = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;

export function IdleWarning({ secondsLeft, onStay, onSignOut }) {
  const stayRef = useRef(null);
  useEffect(() => {
    stayRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-title"
        aria-describedby="idle-text"
        className="relative w-full max-w-sm rounded-2xl border border-[#3a3833] bg-[#151514] p-6 text-center text-[#f7f5ee] shadow-2xl sm:p-8"
      >
        <div
          className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#282218] text-[#f6d878]"
          aria-hidden="true"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2.5M9 2h6" />
          </svg>
        </div>
        <h2 id="idle-title" className="mt-4 text-xl font-bold">
          Are you still there?
        </h2>
        <p id="idle-text" className="mt-2 text-sm leading-relaxed text-[#c8c4bb]">
          For your security, you'll be signed out after 15 minutes without activity.
        </p>
        <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-[#f6d878]" aria-live="polite">
          {mmss(secondsLeft)}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-11 flex-1 rounded-xl border border-[#3a3833] px-4 py-2.5 text-sm font-semibold text-[#c8c4bb] transition hover:border-[#6b592c] hover:text-[#f6d878] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e4b743]"
          >
            Sign out
          </button>
          <button
            ref={stayRef}
            type="button"
            onClick={onStay}
            className="min-h-11 flex-1 rounded-xl bg-gradient-to-br from-[#f8dd85] via-[#e4b743] to-[#c8941f] px-4 py-2.5 text-sm font-bold text-[#171207] transition hover:brightness-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f6d878] focus-visible:ring-offset-2 focus-visible:ring-offset-[#151514]"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}

export function SignedOutNotice({ message, onClose }) {
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[1000] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-start gap-3 rounded-2xl border border-[#3a3833] bg-[#151514] px-4 py-3 text-sm text-[#f7f5ee] shadow-2xl"
    >
      <span className="mt-0.5 text-[#f6d878]" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </span>
      <span className="min-w-0 flex-1 leading-relaxed">{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#8f8b83] transition hover:text-[#f7f5ee] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e4b743]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}

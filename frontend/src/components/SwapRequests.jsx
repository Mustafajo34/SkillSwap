import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useConnects } from "../connects/useConnects";
import { useRealtime } from "../realtime/useRealtime";
import { requestJson } from "../utils/api";
import { stripInvisible, textSafetyProblem } from "../utils/contentSafety";
import { useProfileCard } from "../hooks/useProfileCard";
import { useMemberUpdates } from "../hooks/useMemberUpdates";
import { patchMember, patchMembers } from "../utils/people";
import ProfileCard, { Avatar, Stars } from "./ProfileCard";
import "../css/SwapRequests.css";

// Swap Requests (sidebar tab): trade one of your skills for one of theirs.
//   • People worth swapping with — members who teach something you don't
//     (GET /swaps/matches), as a carousel; "Propose swap" picks the two skills.
//   • Your swaps (GET /swaps) — Requests (waiting for you), Sent, Active
//     (accepted: mark complete or call off) and History (rate finished ones).
// Every change is live: the other person's tabs reload on "swaps:changed".
// Tapping/hovering a person opens their profile card (as in Browse Skills).

const MESSAGE_MAX = 300;
const AUTOPLAY_MS = 4500;
const RELOAD_DELAY_MS = 150;
const TOAST_MS = 3000;
const SWIPE_PX = 40;
const CARD_ACTION = { none: "connect", requested: "cancel", incoming: "accept" };

const LIST_TABS = [
  ["received", "Requests"],
  ["sent", "Sent"],
  ["active", "Active"],
  ["history", "History"],
];

const TOASTS = {
  accept: (s) => `Swap accepted — time to meet ${firstName(s.other)}.`,
  decline: () => "Swap request declined.",
  cancel: (s) => (s.status === "pending" ? "Request withdrawn." : "Swap called off."),
  complete: (s) => `Nice! Your swap with ${firstName(s.other)} is complete.`,
  review: (s) => `Thanks for rating ${firstName(s.other)}.`,
};

const firstName = (person) => person?.name?.split(" ")[0] || "them";

function timeAgo(date) {
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function groupSwaps(swaps) {
  const groups = { received: [], sent: [], active: [], history: [] };
  for (const s of swaps) {
    if (s.status === "pending") groups[s.direction === "received" ? "received" : "sent"].push(s);
    else if (s.status === "accepted") groups.active.push(s);
    else groups.history.push(s);
  }
  return groups;
}

// ── Icons ────────────────────────────────────────────────────────────────────

const PATHS = {
  swap: (
    <>
      <path d="M7 7h11l-3-3" />
      <path d="m18 7-3 3" />
      <path d="M17 17H6l3 3" />
      <path d="m6 17 3-3" />
    </>
  ),
  arrow: <path d="m9 18 6-6-6-6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4L19 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  location: (
    <>
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M4 14h4l2 2h4l2-2h4" />
    </>
  ),
};

function Icon({ name, className = "h-5 w-5" }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}

function Chips({ skills, tone = "muted", empty }) {
  if (!skills?.length) return <span className="text-xs text-muted-foreground">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {skills.slice(0, 3).map((name) => (
        <span
          key={name}
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
            tone === "primary" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          {name}
        </span>
      ))}
      {skills.length > 3 && (
        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
          +{skills.length - 3}
        </span>
      )}
    </span>
  );
}

// ── Matches carousel ─────────────────────────────────────────────────────────

const POSITIONS = {
  "-1": "left-[calc(50%-8.5rem)] z-10 translate-y-6 -rotate-6 scale-[.8] opacity-50 sm:left-[calc(50%-15rem)] sm:scale-[.84]",
  0: "left-1/2 z-20 translate-y-0 rotate-0 scale-100 opacity-100",
  1: "left-[calc(50%+8.5rem)] z-10 translate-y-6 rotate-6 scale-[.8] opacity-50 sm:left-[calc(50%+15rem)] sm:scale-[.84]",
};
const HIDDEN = "pointer-events-none left-1/2 z-0 translate-y-20 scale-50 opacity-0";

function MatchCard({ person, onPropose, onProfile, className = "", inactive, onShow }) {
  return (
    <article
      aria-hidden={inactive || undefined}
      className={`overflow-hidden rounded-[26px] border border-border bg-card text-card-foreground shadow-xl shadow-black/10 ${className}`}
    >
      {/* Side cards: tapping one brings it to the front */}
      {inactive && (
        <button
          type="button"
          tabIndex={-1}
          onClick={onShow}
          aria-label={`Show ${person.name}`}
          className="absolute inset-0 z-10 cursor-pointer"
        />
      )}
      <div className="relative flex flex-col items-center bg-gradient-to-br from-primary/30 via-primary/10 to-transparent px-5 pb-3 pt-4 text-center">
        <button
          type="button"
          tabIndex={inactive ? -1 : 0}
          onClick={(e) => onProfile(person, e.currentTarget.closest("article"))}
          className="rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`See ${person.name}'s profile`}
        >
          <Avatar person={person} size="h-16 w-16 text-lg rounded-2xl" />
        </button>
        <h3 className="mt-2 w-full truncate text-base font-extrabold tracking-tight">{person.name}</h3>
        <p className="mt-0.5 w-full truncate text-xs text-muted-foreground">
          {person.occupation || "SkillSwap member"}
        </p>
        <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
          {person.location && (
            <span className="flex min-w-0 items-center gap-1">
              <Icon name="location" className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{person.location}</span>
            </span>
          )}
          {person.rating != null ? (
            <span className="flex shrink-0 items-center gap-1">
              <Stars rating={person.rating} size="h-3 w-3" />
              {person.rating.toFixed(1)}
            </span>
          ) : (
            <span className="shrink-0">New member</span>
          )}
        </p>
      </div>
      <div className="space-y-2.5 px-5 pb-4 pt-2.5">
        <div>
          <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-[.16em] text-muted-foreground">
            Can teach you
          </p>
          <Chips skills={person.teachesYou} tone="primary" />
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-[.16em] text-muted-foreground">
            Could learn from you
          </p>
          <Chips skills={person.learnsFromYou} empty="Nothing from your skills yet" />
        </div>
        <button
          type="button"
          tabIndex={inactive ? -1 : 0}
          onClick={() => onPropose(person)}
          className="!mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Propose swap
          <Icon name="arrow" className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

function MatchCarousel({ matches, onPropose, onProfile }) {
  // The front card is tracked by person, not position: the list reloads live
  // (and can come back reordered or shorter), and the same person must stay
  // in front — never jump back to someone you just saw. If they've left the
  // list, whoever moved into their spot is in front.
  const [front, setFront] = useState({ id: null, index: 0 });
  const [paused, setPaused] = useState(false);
  const touchX = useRef(null);
  const count = matches.length;
  const frontIndex = matches.findIndex((m) => m.id === front.id);
  const current = count ? (frontIndex >= 0 ? frontIndex : Math.min(front.index, count - 1)) : 0;

  const go = (index) => {
    const i = ((index % count) + count) % count;
    setFront({ id: matches[i].id, index: i });
  };

  // Auto-advance to the next person — not while hovered/focused/touched, in
  // a background tab, or for people who prefer less motion. Reads the latest
  // step through a ref, so a reload doesn't restart the timer.
  const advance = useRef(null);
  useEffect(() => {
    advance.current = () => go(current + 1);
  });
  useEffect(() => {
    if (paused || count < 2) return;
    const timer = setInterval(() => {
      if (document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      advance.current?.();
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [paused, count]);

  // One or two people: a carousel would look odd, so just show them
  if (count <= 2) {
    return (
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:max-w-[640px]">
        {matches.map((m) => (
          <MatchCard key={m.id} person={m} onPropose={onPropose} onProfile={onProfile} className="relative" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div
        className="relative -mx-4 mt-3 h-[392px] overflow-hidden sm:-mx-6"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setPaused(false)}
        onTouchStart={(e) => {
          setPaused(true);
          touchX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - (touchX.current ?? e.changedTouches[0].clientX);
          if (Math.abs(dx) > SWIPE_PX) go(current + (dx < 0 ? 1 : -1));
          touchX.current = null;
          setPaused(false);
        }}
        aria-roledescription="carousel"
        aria-label="People worth swapping with"
      >
        {matches.map((m, index) => {
          let offset = index - current;
          if (offset > count / 2) offset -= count;
          if (offset < -count / 2) offset += count;
          return (
            <MatchCard
              key={m.id}
              person={m}
              onPropose={onPropose}
              onProfile={onProfile}
              inactive={offset !== 0}
              onShow={() => go(index)}
              className={`sr-slide absolute top-1 w-[76vw] max-w-[290px] -translate-x-1/2 ${
                POSITIONS[offset] ?? HIDDEN
              }`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-center gap-3">
        <button
          type="button"
          aria-label="Previous person"
          onClick={() => go(current - 1)}
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card transition hover:border-primary"
        >
          <Icon name="chevronLeft" />
        </button>
        <div className="flex gap-1.5" role="group" aria-label="Choose a person">
          {matches.map((m, index) => (
            <button
              key={m.id}
              type="button"
              onClick={() => go(index)}
              aria-label={`Show ${m.name}`}
              aria-current={index === current || undefined}
              className={`h-2 rounded-full transition-all ${
                index === current ? "w-5 bg-primary" : "w-2 bg-border hover:bg-muted-foreground"
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Next person"
          onClick={() => go(current + 1)}
          className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground transition hover:bg-accent hover:text-accent-foreground"
        >
          <Icon name="arrow" />
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {matches[current]?.name}, {current + 1} of {count}
      </p>
    </>
  );
}

// ── Propose dialog ───────────────────────────────────────────────────────────

function ProposeDialog({ member, mySkills, onClose, onSent }) {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  // Best guesses first: what they lack from you, what you lack from them
  const offers = [...new Set([...(member.learnsFromYou || []), ...mySkills])];
  const wants = [...new Set([...(member.teachesYou || []), ...member.skills.map((s) => s.name)])];
  const [offer, setOffer] = useState(offers[0] || "");
  const [want, setWant] = useState(wants[0] || "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState({ text: "", field: "" });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !sending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  const send = async (e) => {
    e.preventDefault();
    const text = stripInvisible(message).trim();
    if (text.length > MESSAGE_MAX) {
      return setError({ text: `Keep your message under ${MESSAGE_MAX} characters.`, field: "message" });
    }
    const unsafe = textSafetyProblem(text);
    if (unsafe) return setError({ text: unsafe, field: "message" });
    setSending(true);
    setError({ text: "", field: "" });
    try {
      const { swap } = await requestJson(authFetch, "/swaps", {
        method: "POST",
        body: JSON.stringify({ userId: member.id, offer, want, message: text }),
      });
      onSent(swap);
    } catch (err) {
      setError({ text: err.message, field: err.field || "" });
      setSending(false);
    }
  };

  const fieldClass = (name) =>
    `w-full rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
      error.field === name ? "border-red-500" : "border-border"
    }`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div
        className="bs-fade-in absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => !sending && onClose()}
        aria-hidden="true"
      />
      <form
        onSubmit={send}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sr-propose-title"
        className="bs-pop-in relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl sm:p-6"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={sending}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground sm:h-8 sm:w-8"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-3 pr-10">
          <Avatar person={member} size="h-12 w-12 text-sm rounded-xl" />
          <div className="min-w-0">
            <h2 id="sr-propose-title" className="text-lg font-extrabold tracking-tight">
              Propose a swap
            </h2>
            <p className="truncate text-xs text-muted-foreground">with {member.name}</p>
          </div>
        </div>

        {mySkills.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-border p-4 text-sm">
            <p className="font-bold">Add a skill you can teach first</p>
            <p className="mt-1 text-muted-foreground">
              A swap trades one of your skills for one of theirs.
            </p>
            <button
              type="button"
              onClick={() => navigate("/profile")}
              className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground"
            >
              Edit your skills
            </button>
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <label className="min-w-0 text-xs font-bold text-muted-foreground">
                You teach
                <select
                  autoFocus
                  value={offer}
                  onChange={(e) => setOffer(e.target.value)}
                  className={`mt-1.5 ${fieldClass("offer")}`}
                >
                  {offers.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <span className="mb-1 grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-primary">
                <Icon name="swap" className="h-4 w-4" />
              </span>
              <label className="min-w-0 text-xs font-bold text-muted-foreground">
                You learn
                <select
                  value={want}
                  onChange={(e) => setWant(e.target.value)}
                  className={`mt-1.5 ${fieldClass("want")}`}
                >
                  {wants.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-4 block text-xs font-bold text-muted-foreground">
              Message <span className="font-normal">(optional)</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={MESSAGE_MAX}
                rows={3}
                placeholder={`Hi ${firstName(member)}! When are you free?`}
                className={`mt-1.5 resize-none ${fieldClass("message")}`}
              />
              <span className="mt-1 block text-right font-normal">
                {message.length}/{MESSAGE_MAX}
              </span>
            </label>

            {error.text && (
              <p role="alert" className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-500">
                {error.text}
              </p>
            )}

            <button
              type="submit"
              disabled={sending || !offer || !want}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground transition enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send swap request"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

// ── Swap list ────────────────────────────────────────────────────────────────

function StarPicker({ name, busy, onRate }) {
  const [hover, setHover] = useState(0);
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs font-semibold text-muted-foreground">Rate {name}</span>
      <span className="flex" role="group" aria-label={`Rate ${name}`} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => onRate(n)}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            className={`grid h-8 w-8 place-items-center text-lg leading-none transition ${
              n <= hover ? "text-primary" : "text-border"
            } hover:scale-110`}
          >
            ★
          </button>
        ))}
      </span>
    </span>
  );
}

const pill = (text, tone) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold ${
      tone === "good"
        ? "bg-primary/15 text-primary"
        : tone === "wait"
          ? "bg-muted text-muted-foreground"
          : "bg-muted text-muted-foreground line-through decoration-1"
    }`}
  >
    {text}
  </span>
);

function SwapRow({ swap, busy, onAction, onProfile }) {
  const [confirm, setConfirm] = useState(null); // "cancel" | "complete"
  const name = firstName(swap.other);
  const { status, direction } = swap;

  const button = (label, action, solid, extra = {}) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => onAction(swap, action, extra.body).then(() => setConfirm(null))}
      className={`flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-extrabold transition disabled:opacity-60 ${
        solid
          ? "bg-primary text-primary-foreground enabled:hover:bg-accent enabled:hover:text-accent-foreground"
          : "border border-border enabled:hover:border-primary"
      }`}
    >
      {extra.icon && <Icon name={extra.icon} className="h-3.5 w-3.5" />}
      {label}
    </button>
  );

  let actions;
  if (confirm) {
    actions = (
      <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm">
        <span className="text-xs font-semibold text-muted-foreground">
          {confirm === "complete" ? `Did you meet ${name}?` : "Call off this swap?"}
        </span>
        {button("Yes", confirm, true)}
        <button
          type="button"
          onClick={() => setConfirm(null)}
          className="flex h-9 items-center rounded-full border border-border px-4 text-xs font-extrabold transition hover:border-primary"
        >
          No
        </button>
      </span>
    );
  } else if (status === "pending" && direction === "received") {
    actions = (
      <span className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction(swap, "decline")}
          aria-label={`Decline ${swap.other.name}'s request`}
          className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition enabled:hover:border-red-500 enabled:hover:text-red-500 disabled:opacity-60"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
        {button("Accept", "accept", true, { icon: "check" })}
      </span>
    );
  } else if (status === "pending") {
    actions = (
      <span className="flex flex-wrap items-center gap-2">
        {pill("Waiting for a reply", "wait")}
        {button("Withdraw", "cancel", false)}
      </span>
    );
  } else if (status === "accepted") {
    actions = (
      <span className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirm("complete")}
          className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-extrabold text-primary-foreground transition enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-60"
        >
          <Icon name="check" className="h-3.5 w-3.5" />
          Mark complete
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirm("cancel")}
          className="flex h-9 items-center rounded-full border border-border px-4 text-xs font-extrabold transition enabled:hover:border-red-500 enabled:hover:text-red-500"
        >
          Call off
        </button>
      </span>
    );
  } else if (status === "completed") {
    actions =
      swap.yourRating == null ? (
        <StarPicker name={name} busy={busy} onRate={(rating) => onAction(swap, "review", { rating })} />
      ) : (
        pill(`Completed · you rated ${swap.yourRating}★`, "good")
      );
  } else {
    const who = swap.closedByYou ? "You" : name;
    actions = pill(status === "declined" ? `${who} declined` : `${who} cancelled`, "ended");
  }

  return (
    <article className="flex flex-col gap-3 py-4 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:gap-4">
      <button
        type="button"
        onClick={(e) => onProfile(swap.other, e.currentTarget)}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`See ${swap.other.name}'s profile`}
      >
        <Avatar person={swap.other} size="h-11 w-11 text-xs rounded-full" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <strong className="truncate text-sm font-extrabold">{swap.other.name}</strong>
            <span className="text-xs text-muted-foreground">{timeAgo(swap.updatedAt)}</span>
          </span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {direction === "received" && status === "pending" ? "Offers " : "They teach "}
            <span className="font-bold text-foreground">{swap.theyTeach}</span>
            {direction === "received" && status === "pending" ? " for your " : " · you teach "}
            <span className="font-bold text-foreground">{swap.youTeach}</span>
          </span>
          {swap.message && (
            <span className="mt-1.5 line-clamp-2 block whitespace-pre-line break-words rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs italic text-muted-foreground">
              “{swap.message}”
            </span>
          )}
        </span>
      </button>
      <div className="pl-14 sm:pl-0">{actions}</div>
    </article>
  );
}

const EMPTY_TEXT = {
  received: ["No requests waiting", "When someone proposes a swap, it shows up here."],
  sent: ["No requests out", "Propose a swap to someone above."],
  active: ["No active swaps", "Accepted swaps show up here until you've met."],
  history: ["Nothing here yet", "Finished, declined and cancelled swaps show up here."],
};

// ── Page ─────────────────────────────────────────────────────────────────────

const SwapRequests = () => {
  const { authFetch } = useAuth();
  const { subscribe } = useRealtime();
  const { statusOf, act: connectAct, busy: connectBusy } = useConnects();
  const [data, setData] = useState({ status: "loading", swaps: [], matches: [], mySkills: [], error: "" });
  const [version, setVersion] = useState(0);
  const [listTab, setListTab] = useState(null); // null = pick the most useful one
  const [busy, setBusy] = useState(() => new Set());
  const [proposeTo, setProposeTo] = useState(null);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState(null);
  const reloadTimer = useRef(null);
  const profile = useProfileCard();

  // Load your swaps + matches. Old data stays on screen during reloads.
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    Promise.all([requestJson(authFetch, "/swaps", options), requestJson(authFetch, "/swaps/matches", options)])
      .then(([list, found]) =>
        setData({ status: "ready", swaps: list.swaps, matches: found.matches, mySkills: found.mySkills, error: "" }),
      )
      .catch((err) => {
        if (err.name === "AbortError") return;
        setData((d) => ({ ...d, status: d.status === "ready" ? "ready" : "error", error: err.message }));
      });
    return () => controller.abort();
  }, [authFetch, version]);

  // Someone edited their profile → their swap rows update; if their skills
  // changed and they're a match, re-check what they can teach you
  const matchIds = useRef(new Set());
  useEffect(() => {
    matchIds.current = new Set(data.matches.map((m) => m.id));
  }, [data.matches]);
  useMemberUpdates((member) => {
    // Only a skills change can change the match; rating / swap-count
    // updates are just patched in (a reload would reorder the carousel)
    if (member.skills && matchIds.current.has(member.id)) setVersion((v) => v + 1);
    setData((d) => ({
      ...d,
      swaps: d.swaps.map((s) => (s.other.id === member.id ? { ...s, other: patchMember(s.other, member) } : s)),
      matches: patchMembers(d.matches, member),
    }));
  });

  // Live: reload when any swap of yours changes (bursts collapse into one)
  useEffect(() => {
    const reload = () => {
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => setVersion((v) => v + 1), RELOAD_DELAY_MS);
    };
    const offChange = subscribe("swaps:changed", reload);
    const offReconnect = subscribe("realtime:reconnected", reload);
    return () => {
      offChange();
      offReconnect();
      clearTimeout(reloadTimer.current);
    };
  }, [subscribe]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = (text) => setToast({ text, id: Date.now() });

  const runAction = async (swap, action, body) => {
    if (busy.has(swap.id)) return;
    setActionError("");
    setBusy((b) => new Set(b).add(swap.id));
    try {
      const { swap: updated } = await requestJson(authFetch, `/swaps/${swap.id}/${action}`, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      if (updated) {
        setData((d) => ({ ...d, swaps: d.swaps.map((s) => (s.id === updated.id ? updated : s)) }));
      }
      showToast(TOASTS[action](swap));
    } catch (err) {
      setActionError(err.message);
      setVersion((v) => v + 1); // it probably changed elsewhere — show the latest
    } finally {
      setBusy((b) => {
        const nextBusy = new Set(b);
        nextBusy.delete(swap.id);
        return nextBusy;
      });
    }
  };

  const sent = (swap) => {
    setProposeTo(null);
    setData((d) => ({
      ...d,
      swaps: [swap, ...d.swaps],
      matches: d.matches.filter((m) => m.id !== swap.other.id),
    }));
    setListTab("sent");
    showToast(`Swap request sent to ${firstName(swap.other)}.`);
  };

  const groups = groupSwaps(data.swaps);
  const completed = groups.history.filter((s) => s.status === "completed").length;
  const tab = listTab ?? (groups.received.length || !groups.active.length ? "received" : "active");
  const shown = groups[tab];

  const openProfile = (person, el) => el && profile.open(person, el, true);
  // Latest copy of whoever's open, with the live connect status
  let cardPerson = null;
  if (profile.card) {
    const id = profile.card.person.id;
    const found =
      [...data.matches, ...data.swaps.map((s) => s.other)].find((m) => m.id === id) || profile.card.person;
    cardPerson = { ...found, friendship: statusOf(id, found.friendship) };
  }

  const scrollToList = () =>
    document.getElementById("sr-your-swaps")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="swap-requests min-h-full bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-5 sm:px-6">
        {/* Hero — a compact strip so the carousel is on screen straight away */}
        <section className="relative overflow-hidden rounded-3xl border border-border bg-card px-5 py-5 sm:px-7">
          <div
            aria-hidden="true"
            className="absolute -right-14 -top-16 h-40 w-40 rounded-full border-[26px] border-primary/70"
          />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 lg:max-w-xl">
              <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Skill swaps
              </span>
              <h1 className="mt-1.5 text-2xl font-extrabold leading-tight tracking-[-.035em] sm:text-3xl">
                Trade what you know. <span className="text-primary">Learn what you love.</span>
              </h1>
              <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
                Teach one of your skills in exchange for one of theirs.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:pr-24 xl:pr-28">
              <dl className="flex flex-wrap gap-2">
                {[
                  [groups.received.length, "waiting"],
                  [groups.active.length, "active"],
                  [completed, "completed"],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-xl border border-border bg-background/60 px-3 py-1.5">
                    <dt className="sr-only">{label}</dt>
                    <dd className="text-xs">
                      <strong className="text-base font-extrabold">{data.status === "ready" ? value : "–"}</strong>{" "}
                      <span className="text-muted-foreground">{label}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                onClick={scrollToList}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-extrabold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground"
              >
                View requests
              </button>
            </div>
          </div>
        </section>

        {actionError && (
          <p role="alert" className="mt-6 flex items-start justify-between gap-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-500">
            {actionError}
            <button type="button" aria-label="Dismiss" onClick={() => setActionError("")}>
              <Icon name="close" className="h-4 w-4" />
            </button>
          </p>
        )}

        {data.status === "loading" ? (
          <div className="mt-6 space-y-4" aria-busy="true" aria-label="Loading swaps">
            <div className="sr-skeleton h-7 w-56 rounded-lg" />
            <div className="sr-skeleton mx-auto h-[360px] w-full max-w-[290px] rounded-[26px]" />
            <div className="sr-skeleton h-48 rounded-[28px]" />
          </div>
        ) : data.status === "error" ? (
          <div role="alert" className="mt-10 rounded-[28px] border border-border bg-card p-8 text-center">
            <strong className="text-base">Couldn’t load your swaps</strong>
            <p className="mt-1 text-sm text-muted-foreground">{data.error}</p>
            <button
              type="button"
              onClick={() => {
                setData((d) => ({ ...d, status: "loading" }));
                setVersion((v) => v + 1);
              }}
              className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {/* Matches */}
            <section id="sr-matches" className="mt-6 scroll-mt-6">
              <p className="text-xs font-extrabold uppercase tracking-[.18em] text-primary">Curated for you</p>
              <h2 className="mt-1 text-xl font-extrabold tracking-[-.03em] sm:text-2xl">People worth swapping with</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Members who teach something you don’t — tap someone to see their profile.
              </p>
              {data.matches.length ? (
                <MatchCarousel matches={data.matches} onPropose={setProposeTo} onProfile={openProfile} />
              ) : (
                <div className="mt-6 rounded-[28px] border border-dashed border-border p-8 text-center">
                  <strong className="text-sm">No new matches right now</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Check back as more members join — or browse everyone in Browse Skills.
                  </p>
                </div>
              )}
            </section>

            {/* Your swaps */}
            <section id="sr-your-swaps" className="mt-10 scroll-mt-6 rounded-[28px] border border-border bg-card p-4 sm:p-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-extrabold tracking-tight">Your swaps</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Keep the momentum going</p>
                </div>
                <div className="grid grid-cols-4 rounded-xl bg-muted p-1" role="tablist" aria-label="Your swaps">
                  {LIST_TABS.map(([id, label]) => {
                    const n = groups[id].length;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => setListTab(id)}
                        className={`flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-extrabold transition sm:px-3.5 ${
                          tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {label}
                        {id !== "history" && n > 0 && (
                          <span
                            className={`grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] ${
                              id === "received" ? "bg-primary text-primary-foreground" : "bg-background"
                            }`}
                          >
                            {n}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div role="tabpanel" className="mt-4 divide-y divide-border">
                {shown.length ? (
                  shown.map((swap) => (
                    <SwapRow
                      key={swap.id}
                      swap={swap}
                      busy={busy.has(swap.id)}
                      onAction={runAction}
                      onProfile={openProfile}
                    />
                  ))
                ) : (
                  <div className="py-10 text-center">
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-primary">
                      <Icon name={tab === "received" ? "inbox" : tab === "active" ? "clock" : "swap"} />
                    </div>
                    <p className="mt-4 text-sm font-extrabold">{EMPTY_TEXT[tab][0]}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{EMPTY_TEXT[tab][1]}</p>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {proposeTo && (
        <ProposeDialog
          member={proposeTo}
          mySkills={data.mySkills}
          onClose={() => setProposeTo(null)}
          onSent={sent}
        />
      )}

      {profile.card && (
        <ProfileCard
          {...profile.cardProps}
          card={{ ...profile.card, person: cardPerson }}
          busy={connectBusy.has(cardPerson.id)}
          onFriendAction={(person) =>
            CARD_ACTION[person.friendship] &&
            connectAct(person, CARD_ACTION[person.friendship]).catch((err) => setActionError(err.message))
          }
        />
      )}

      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-5 py-3 text-center text-xs font-bold text-background shadow-2xl transition duration-300 ${
          toast ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        }`}
      >
        {toast?.text}
      </div>
    </div>
  );
};

export default SwapRequests;

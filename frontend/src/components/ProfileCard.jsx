import { useEffect, useLayoutEffect, useRef, useState } from "react";
import UserAvatar from "./UserAvatar";
import { isPhone } from "../hooks/useProfileCard";
import { useMemberUpdates } from "../hooks/useMemberUpdates";
import { patchMember } from "../utils/people";
import "../css/ProfileCard.css";

// A member's profile card — bio, skills, skill swaps, rating, "friends with"
// and the friend button — plus the small pieces it's built from. Used by
// Browse Skills (SkillPeople) and Skills Connect (MySkills); opening and
// closing is handled by hooks/useProfileCard.js.
//
// Beside the person on bigger screens — below them, above if there's no
// room, otherwise as close as possible — always fully on screen (placed
// from the card's real height, re-placed whenever it grows, e.g. "Read
// more"). Centred with a dim backdrop on phones. Long bios show a preview.

const CARD_WIDTH = 320;
const EDGE = 12; // keep this far from the window edges
const GAP = 6; // between the person and the card
const BIO_PREVIEW = 160; // characters before "Read more"

// The first ~160 characters, cut at a word
function bioPreview(bio) {
  if (bio.length <= BIO_PREVIEW + 20) return null; // short enough to show whole
  const cut = bio.slice(0, BIO_PREVIEW);
  const space = cut.lastIndexOf(" ");
  return `${(space > BIO_PREVIEW * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
}

// Where the card goes, from where the person is and how big the card is
function placeCard(el, rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const h = Math.min(el.offsetHeight, vh - EDGE * 2);
  const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
  // Wide rows (tables): line up with their start; small cards: centre on them
  const anchor = rect.width > CARD_WIDTH * 1.5 ? rect.left + 16 : rect.left + rect.width / 2 - CARD_WIDTH / 2;
  const left = clamp(anchor, EDGE, vw - CARD_WIDTH - EDGE);
  let top;
  if (rect.bottom + GAP + h <= vh - EDGE) top = rect.bottom + GAP; // below
  else if (rect.top - GAP - h >= EDGE) top = rect.top - GAP - h; // above
  else top = clamp(rect.top + rect.height / 2 - h / 2, EDGE, vh - h - EDGE); // beside, on screen
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

// ── Icons ────────────────────────────────────────────────────────────────────

function UserPlusIcon({ className = "h-4 w-4" }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10-2v6m3-3h-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CheckIcon({ className = "h-4 w-4" }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
      />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function Stars({ rating, size = "h-3.5 w-3.5" }) {
  return (
    <span
      className="relative inline-flex"
      role="img"
      aria-label={`${rating.toFixed(1)} out of 5 stars`}
    >
      {/* grey row, with a gold row clipped to the rating on top */}
      <span className="flex text-muted-foreground/30">
        {Array.from({ length: 5 }, (_, i) => (
          <StarShape key={i} className={size} />
        ))}
      </span>
      <span
        className="absolute inset-y-0 left-0 flex overflow-hidden text-primary"
        style={{ width: `${(rating / 5) * 100}%` }}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <StarShape key={i} className={`${size} shrink-0`} />
        ))}
      </span>
    </span>
  );
}

function StarShape({ className }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" />
    </svg>
  );
}

// Their profile photo (shared + live, see UserAvatar) or initials
export function Avatar({ person, size = "h-10 w-10 text-xs" }) {
  return (
    <UserAvatar
      id={person.id}
      name={person.name}
      photoV={person.photoV}
      className={`grid shrink-0 place-items-center overflow-hidden rounded-xl font-bold text-[#111] ${size}`}
    />
  );
}

// What the friend button shows and does for each relationship
const FRIEND_STATES = {
  none: { text: "Add friend", label: (n) => `Add ${n} as a friend`, icon: "add", solid: true },
  requested: { text: "Request sent", label: (n) => `Friend request sent to ${n} — click to cancel`, icon: "check" },
  incoming: { text: "Accept request", label: (n) => `Accept ${n}'s friend request`, icon: "add", solid: true },
  friends: { text: "Friends", label: (n) => `You and ${n} are friends`, icon: "check", done: true },
};

export function FriendButton({ person, busy, onAction, wide = false }) {
  const state = FRIEND_STATES[person.friendship] || FRIEND_STATES.none;
  const label = state.label(person.name);
  return (
    <button
      type="button"
      aria-label={wide ? undefined : label}
      title={label}
      disabled={busy || state.done}
      aria-busy={busy || undefined}
      onClick={(event) => {
        event.stopPropagation();
        onAction(person);
      }}
      className={`inline-flex items-center justify-center gap-2 font-bold transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card disabled:cursor-default ${
        wide ? "w-full rounded-xl px-4 py-2.5 text-sm" : "h-9 w-9 rounded-full"
      } ${
        state.solid
          ? "bg-primary text-primary-foreground enabled:hover:scale-105 enabled:hover:bg-accent enabled:hover:text-accent-foreground"
          : "bg-primary/15 text-primary"
      } ${busy ? "opacity-60" : ""}`}
    >
      {state.icon === "check" ? <CheckIcon /> : <UserPlusIcon />}
      {wide && state.text}
    </button>
  );
}

// ── Profile card ─────────────────────────────────────────────────────────────

export default function ProfileCard({
  card,
  closing,
  skill,
  busy,
  onFriendAction,
  onClose,
  onEnter,
  onLeave,
  onExited,
}) {
  const { rect, pinned } = card;
  // Their latest details while the card is open (a new rating, an edit…)
  const [live, setLive] = useState(null);
  useMemberUpdates((member) =>
    setLive((prev) => (member.id === card.person.id ? { ...prev, ...member } : prev)),
  );
  const person = live?.id === card.person.id ? patchMember(card.person, live) : card.person;
  const phone = isPhone();
  const closeRef = useRef(null);
  const cardRef = useRef(null);
  // "Read more" — per person, so hovering someone else starts collapsed
  const [bioOpenFor, setBioOpenFor] = useState(null);
  const bio = person.bio || "";
  const preview = bioPreview(bio);
  const bioOpen = bioOpenFor === person.id;

  // Place it before it's painted, and again whenever its size changes
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || phone) return;
    const place = () => placeCard(el, rect);
    place();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    observer?.observe(el);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [rect, phone, person.id]);

  // Opened by a tap/click: put focus on ✕ so Esc / Enter close it straight away
  useEffect(() => {
    if (pinned) closeRef.current?.focus({ preventScroll: true });
  }, [pinned, person.id]);

  // Preview comes back with mutual friends first
  const friends = person.friendsPreview || [];
  const skills = person.skills || [];
  const subtitle = [person.occupation, person.location].filter(Boolean).join(" · ");
  const shownFriends = friends.slice(0, 2).map((f) => f.name);
  const others = (person.friendCount ?? friends.length) - shownFriends.length;

  return (
    <>
      {/* Tap/click outside to close a pinned card (dimmed on phones) */}
      {pinned && (
        <div
          className={`fixed inset-0 z-40 ${phone ? "bg-black/50 backdrop-blur-sm" : ""} ${
            closing ? "bs-fade-out" : "bs-fade-in"
          }`}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div
        ref={cardRef}
        data-profile-card
        role="dialog"
        aria-label={`${person.name}'s profile`}
        aria-modal={pinned || undefined}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onAnimationEnd={(e) => e.target === e.currentTarget && closing && onExited()}
        className={`fixed z-50 overflow-y-auto rounded-2xl border border-border bg-card text-card-foreground shadow-2xl shadow-black/25 ${
          closing ? "bs-pop-out" : "bs-pop-in"
        } ${phone ? "inset-x-4 top-1/2 max-h-[85dvh] -translate-y-1/2" : "max-h-[calc(100dvh-24px)]"}`}
        style={phone ? undefined : { width: CARD_WIDTH, top: EDGE, left: EDGE }}
      >
        <div className="relative p-5">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-20 rounded-t-2xl bg-gradient-to-br from-primary/25 via-primary/10 to-transparent"
          />
          {/* Above the header row (z-10) so taps always reach it; 40px target on phones */}
          <button
            ref={closeRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close profile"
            className="absolute right-2.5 top-2.5 z-10 grid h-10 w-10 touch-manipulation place-items-center rounded-full bg-card/80 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8"
          >
            <CloseIcon />
          </button>

          <div className="relative flex items-center gap-3 pr-10">
            <Avatar person={person} size="h-14 w-14 text-base rounded-2xl" />
            <div className="min-w-0">
              <h3 className="truncate text-base font-extrabold">{person.name}</h3>
              <p className="truncate text-xs text-muted-foreground">
                {subtitle || (person.userName ? `@${person.userName}` : "SkillSwap member")}
              </p>
            </div>
          </div>

          <div className="relative mt-4 text-sm leading-6 text-muted-foreground">

            <p className="whitespace-pre-line break-words" id={`bio-${person.id}`}>

              {!bio ? "No bio yet." : preview && !bioOpen ? preview : bio}

            </p>

            {preview && (

              <button

                type="button"

                onClick={(e) => {

                  e.stopPropagation();

                  setBioOpenFor(bioOpen ? null : person.id);

                }}

                aria-expanded={bioOpen}

                aria-controls={`bio-${person.id}`}

                className="mt-1 rounded text-xs font-bold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"

              >

                {bioOpen ? "Show less" : "Read more"}

              </button>

            )}

          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <span
                key={s.name}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                  s.name === skill
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {s.name}
              </span>
            ))}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-background/60 p-3">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Skill swaps
              </dt>
              <dd className="mt-1 text-xl font-extrabold">{person.swaps ?? 0}</dd>
            </div>
            <div className="rounded-xl border border-border bg-background/60 p-3">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Rating
              </dt>
              {person.rating == null ? (
                <dd className="mt-1 text-sm font-bold text-muted-foreground">
                  No reviews yet
                </dd>
              ) : (
                <>
                  <dd className="mt-1 flex items-center gap-1.5">
                    <span className="text-xl font-extrabold">
                      {person.rating.toFixed(1)}
                    </span>
                    <Stars rating={person.rating} size="h-3 w-3" />
                  </dd>
                  <dd className="mt-0.5 text-[10px] text-muted-foreground">
                    {person.reviews} {person.reviews === 1 ? "review" : "reviews"}
                  </dd>
                </>
              )}
            </div>
          </dl>

          {friends.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">
              No friends on SkillSwap yet.
            </p>
          ) : (
          <div className="mt-4 flex items-center gap-3">
            <div className="flex -space-x-2">
              {friends.slice(0, 3).map((f) => (
                <span key={f.id} className="rounded-xl ring-2 ring-card">
                  <Avatar person={f} size="h-7 w-7 text-[9px] rounded-lg" />
                </span>
              ))}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Friends with{" "}
              <span className="font-semibold text-foreground">
                {shownFriends.join(", ")}
              </span>
              {others > 0 && ` and ${others} ${others === 1 ? "other" : "others"}`}
            </p>
          </div>
          )}

          <div className="mt-5">
            <FriendButton
              person={person}
              busy={busy}
              onAction={onFriendAction}
              wide
            />
          </div>
        </div>
      </div>
    </>
  );
}

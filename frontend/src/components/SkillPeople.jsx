import { useEffect, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useConnects } from "../connects/useConnects";
import { requestJson } from "../utils/api";
import ProfileCard, { Avatar, CloseIcon, FriendButton, Stars } from "./ProfileCard";
import { useProfileCard } from "../hooks/useProfileCard";
import { useMemberUpdates } from "../hooks/useMemberUpdates";
import { patchMember } from "../utils/people";

// People who can teach the selected skill, as a table (GET /members?skill=).
// Hovering a row (or tapping it on touch screens) fades in a profile card
// (components/ProfileCard.jsx, opened via hooks/useProfileCard.js)
// with their bio, mutual friends, skill swap count and rating. The friend
// button sends, cancels or accepts requests through the shared connects
// store (connects/ConnectsProvider.jsx), so My Skills stays in step.

// ── Table ────────────────────────────────────────────────────────────────────

// What the friend button does for each relationship
const ACTION_FOR = { none: "connect", requested: "cancel", incoming: "accept" };

export default function SkillPeople({ skill, onClose }) {
  const { authFetch } = useAuth();
  // Shared with My Skills and kept live, so adding someone here shows up
  // there (and in the sidebar badge) straight away, and vice versa
  const { statusOf, act, busy } = useConnects();
  // The parent remounts this per skill (key={skill}), so it starts loading
  const [load, setLoad] = useState({ status: "loading", members: [], error: "" });
  const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState("");
  // The profile card (hover on desktop, tap on touch screens)
  const profile = useProfileCard();

  useEffect(() => {
    const controller = new AbortController();
    requestJson(authFetch, `/members?skill=${encodeURIComponent(skill)}`, {
      signal: controller.signal,
    })
      .then((data) => setLoad({ status: "ready", members: data.members, error: "" }))
      .catch((err) => {
        if (err.name === "AbortError") return;
        setLoad({ status: "error", members: [], error: err.message });
      });
    return () => controller.abort();
  }, [authFetch, skill, attempt]);

  // Someone edited their profile → their row and card update live. If they
  // no longer teach this skill, they leave the list.
  useMemberUpdates((member) =>
    setLoad((l) => {
      if (!l.members.some((m) => m.id === member.id)) return l;
      // Rating / swap-count updates carry no skills — keep their level
      const levelOf = (m) =>
        member.skills ? member.skills.find((s) => s.name === skill)?.level || null : m.level;
      return {
        ...l,
        members: l.members
          .map((m) => (m.id === member.id ? { ...patchMember(m, member), level: levelOf(m) } : m))
          .filter((m) => m.id !== member.id || m.level),
      };
    }),
  );

  const retry = () => {
    setLoad({ status: "loading", members: [], error: "" });
    setAttempt((n) => n + 1);
  };

  // Friendship comes from the shared, live network rather than the
  // snapshot this list was loaded with
  const teachers = load.members.map((m) => ({
    ...m,
    friendship: statusOf(m.id, m.friendship),
  }));
  const busyIds = busy;

  const friendAction = async (person) => {
    const kind = ACTION_FOR[person.friendship];
    if (!kind || busy.has(person.id)) return;
    setActionError("");
    try {
      await act(person, kind);
    } catch (err) {
      setActionError(err.message);
    }
  };

  return (
    <section
      aria-labelledby="skill-people-title"
      className="bs-fade-in mb-10 overflow-hidden rounded-3xl border border-border bg-card shadow-xl shadow-black/5"
    >
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            {load.status === "ready"
              ? `${teachers.length} ${teachers.length === 1 ? "person" : "people"} can teach`
              : "People who can teach"}
          </p>
          <h2 id="skill-people-title" className="mt-1 text-xl font-black tracking-tight sm:text-2xl">
            {skill}
          </h2>
          <p className="mt-1 hidden text-xs text-muted-foreground sm:block">
            Hover or tap someone to see their profile.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close people list"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <CloseIcon />
        </button>
      </header>

      {actionError && (
        <p
          role="alert"
          className="border-b border-border bg-red-500/10 px-5 py-2.5 text-xs font-semibold text-red-500 sm:px-6"
        >
          {actionError}
        </p>
      )}

      {load.status === "loading" ? (
        <ul aria-label={`Loading people who teach ${skill}`} className="divide-y divide-border">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-4 sm:px-6">
              <span className="h-10 w-10 animate-pulse rounded-xl bg-muted" />
              <span className="flex-1 space-y-2">
                <span className="block h-3 w-1/3 animate-pulse rounded bg-muted" />
                <span className="block h-2.5 w-1/4 animate-pulse rounded bg-muted/70" />
              </span>
              <span className="h-9 w-9 animate-pulse rounded-full bg-muted" />
            </li>
          ))}
        </ul>
      ) : load.status === "error" ? (
        <div role="alert" className="px-6 py-12 text-center">
          <p className="text-sm font-semibold">Couldn't load people</p>
          <p className="mt-1 text-xs text-muted-foreground">{load.error}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Try again
          </button>
        </div>
      ) : teachers.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-muted-foreground">
          No one teaches {skill} yet.
        </p>
      ) : (
        <table className="w-full table-fixed text-left">
          <thead className="bg-background/50 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th scope="col" className="px-5 py-3 sm:px-6">Name</th>
              <th scope="col" className="w-[38%] px-3 py-3 sm:w-[26%]">Skill</th>
              <th scope="col" className="hidden w-[24%] px-3 py-3 md:table-cell">
                Swaps &amp; rating
              </th>
              <th scope="col" className="w-16 px-5 py-3 text-right sm:w-24 sm:px-6">
                <span className="sr-only sm:not-sr-only">Add</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {teachers.map((person, index) => {
              const active = profile.isActive(person.id);
              return (
                <tr
                  key={person.id}
                  onMouseEnter={(e) => profile.hoverEnter(person, e.currentTarget)}
                  onMouseLeave={profile.hoverLeave}
                  onClick={(e) => profile.open(person, e.currentTarget, true)}
                  className={`bs-row cursor-pointer transition-colors ${
                    active ? "bg-secondary" : "hover:bg-secondary/70"
                  }`}
                  style={{ animationDelay: `${index * 40}ms` }}
                >
                  <td className="px-5 py-3.5 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar person={person} />
                      <div className="min-w-0">
                        {/* Keyboard users open the profile from here */}
                        <button
                          type="button"
                          className="block max-w-full truncate rounded text-left text-sm font-bold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={(e) => {
                            e.stopPropagation();
                            profile.open(person, e.currentTarget.closest("tr"), true);
                          }}
                          aria-haspopup="dialog"
                        >
                          {person.name}
                        </button>
                        <p className="truncate text-xs text-muted-foreground">
                          {person.occupation}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="inline-flex max-w-full items-center truncate rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                      {skill}
                    </span>
                    <p className="mt-1 text-[11px] text-muted-foreground">{person.level}</p>
                  </td>
                  <td className="hidden px-3 py-3.5 md:table-cell">
                    {person.rating === null ? (
                      <span className="text-xs font-semibold text-muted-foreground">
                        New
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Stars rating={person.rating} />
                        <span className="text-xs font-bold">
                          {person.rating.toFixed(1)}
                        </span>
                      </div>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {person.swaps} skill swaps
                    </p>
                  </td>
                  <td className="px-5 py-3.5 text-right sm:px-6">
                    <FriendButton
                      person={person}
                      busy={busyIds.has(person.id)}
                      onAction={friendAction}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {profile.card && (
        <ProfileCard
          {...profile.cardProps}
          // Latest copy, so friend status changes show while it's open
          card={{
            ...profile.card,
            person: teachers.find((m) => m.id === profile.card.person.id) || profile.card.person,
          }}
          skill={skill}
          busy={busyIds.has(profile.card.person.id)}
          onFriendAction={friendAction}
        />
      )}
    </section>
  );
}

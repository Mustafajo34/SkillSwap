import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useConnects } from "../connects/useConnects";
import { requestJson } from "../utils/api";
import UserAvatar from "./UserAvatar";
import ProfileCard from "./ProfileCard";
import { useProfileCard } from "../hooks/useProfileCard";
import { useMemberUpdates } from "../hooks/useMemberUpdates";
import { patchMembers } from "../utils/people";
import "../css/MySkills.css";

// Skills Connect (sidebar tab): your skill-swap network. Opens on Find
// connects — the sidebar always lands there; toasts/the bell may pick
// another tab.
//   Connects       people you're connected with (GET /friends → friends)
//   Find connects  search members by name, username or skill (GET /members)
//   Pending        requests sent to you and by you
// "Connect" is the UI word for a friend; the API calls them friends.
// Hovering a person (or tapping them on touch screens) opens their profile
// card — the same one Browse Skills uses (components/ProfileCard.jsx).
// The network itself lives in the shared ConnectsProvider, so changes here,
// in Browse Skills or from other people (live updates) show up everywhere.

// [id, label, short label for narrow screens]
const TABS = [
  ["connects", "Connects", "Connects"],
  ["find", "Find connects", "Find"],
  ["pending", "Pending", "Pending"],
];
const SEARCH_DELAY_MS = 300;
const SUGGESTION_LIMIT = 12;
const RESULT_LIMIT = 24;
// The profile card's button moves the relationship forward the same way
const CARD_ACTION = { none: "connect", requested: "cancel", incoming: "accept" };

// ── Icons ────────────────────────────────────────────────────────────────────

const ICONS = {
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  userPlus: (
    <>
      <path d="M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" />
      <circle cx="9" cy="7" r="3" />
      <path d="M19 8v6M22 11h-6" />
    </>
  ),
  people: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  star: (
    <path
      d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
      fill="currentColor"
      stroke="none"
    />
  ),
};

function Icon({ name, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

// Their profile photo (shared + live, see UserAvatar) or initials
function Avatar({ member, large = false }) {
  return (
    <UserAvatar
      id={member.id}
      name={member.name}
      photoV={member.photoV}
      className={`ms-avatar ${large ? "ms-avatar-large" : ""}`}
    />
  );
}

function SkillChips({ skills, max = 3 }) {
  if (!skills?.length) return <span className="ms-muted">No skills listed yet</span>;
  const extra = skills.length - max;
  return (
    <span className="ms-chips">
      {skills.slice(0, max).map((s) => (
        <span key={s.name} className="ms-chip" title={`${s.name} · ${s.level}`}>
          {s.name}
        </span>
      ))}
      {extra > 0 && <span className="ms-chip ms-chip-more">+{extra}</span>}
    </span>
  );
}

function Rating({ member }) {
  if (member.rating === null) return <span className="ms-muted">New member</span>;
  return (
    <span className="ms-rating">
      <Icon name="star" size={12} />
      {member.rating.toFixed(1)}
      <span className="ms-muted">· {member.swaps} swaps</span>
    </span>
  );
}

// The one button that moves a relationship forward from the search results
function ConnectButton({ member, busy, onAct }) {
  const config = {
    none: { label: "Connect", icon: "userPlus", kind: "connect", solid: true },
    requested: { label: "Requested", icon: "clock", kind: "cancel", hint: "Cancel request" },
    incoming: { label: "Accept", icon: "check", kind: "accept", solid: true },
    friends: { label: "Connected", icon: "check", kind: null },
  }[member.friendship] || { label: "Connect", icon: "userPlus", kind: "connect", solid: true };

  return (
    <button
      type="button"
      className={`ms-connect-button ${config.solid ? "ms-solid" : ""}`}
      disabled={busy || !config.kind}
      aria-busy={busy || undefined}
      title={config.hint || undefined}
      aria-label={`${config.hint || config.label}: ${member.name}`}
      onClick={(e) => {
        e.stopPropagation(); // don't also open the profile card
        onAct(member, config.kind);
      }}
    >
      <Icon name={config.icon} size={16} />
      <span>{config.label}</span>
    </button>
  );
}

function SkeletonCards({ count = 3, className = "ms-friend-grid" }) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ms-skeleton-card">
          <span className="ms-skeleton ms-skeleton-avatar" />
          <span className="ms-skeleton ms-skeleton-line" />
          <span className="ms-skeleton ms-skeleton-line ms-short" />
        </div>
      ))}
    </div>
  );
}

function ErrorBox({ message, onRetry }) {
  return (
    <div className="ms-no-results" role="alert">
      <strong>Something went wrong</strong>
      <p>{message}</p>
      <button type="button" className="ms-pill-button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function ConnectsTab({ network, busy, onAct, onFind, onPending, profileProps }) {
  const [filter, setFilter] = useState("");
  const [menuFor, setMenuFor] = useState(null);

  // Close the ⋯ menu on Escape or a click anywhere outside it
  useEffect(() => {
    if (!menuFor) return;
    const onPointer = (e) => {
      if (!e.target.closest?.(".ms-menu, .ms-more-button")) setMenuFor(null);
    };
    const onKey = (e) => e.key === "Escape" && setMenuFor(null);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return network.friends;
    return network.friends.filter((m) =>
      `${m.name} ${m.userName} ${m.skills.map((s) => s.name).join(" ")}`
        .toLowerCase()
        .includes(term),
    );
  }, [network.friends, filter]);

  return (
    <>
      {network.incoming.length > 0 && (
        <button type="button" className="ms-banner" onClick={onPending}>
          <span className="ms-count-pill">{network.incoming.length}</span>
          {network.incoming.length === 1
            ? "person wants to connect with you"
            : "people want to connect with you"}
          <span className="ms-banner-link">
            Review <Icon name="chevron" size={14} />
          </span>
        </button>
      )}

      {network.friends.length === 0 ? (
        <div className="ms-empty">
          <span>
            <Icon name="people" />
          </span>
          <strong>No skill connects yet</strong>
          <p>Find people who teach what you want to learn.</p>
          <button type="button" className="ms-pill-button" onClick={onFind}>
            Find connects
          </button>
        </div>
      ) : (
        <>
          <label className="ms-search ms-filter">
            <Icon name="search" size={18} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter your connects by name or skill…"
              aria-label="Filter your connects"
            />
          </label>

          {visible.length === 0 ? (
            <div className="ms-no-results">
              <Icon name="search" size={24} />
              <strong>No connects match “{filter}”</strong>
              <p>Try another name or skill.</p>
            </div>
          ) : (
            <div className="ms-friend-grid">
              {visible.map((m) => (
                <article key={m.id} {...profileProps(m, "ms-friend-card")}>
                  <button
                    type="button"
                    className="ms-more-button"
                    aria-label={`More options for ${m.name}`}
                    aria-expanded={menuFor === m.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(menuFor === m.id ? null : m.id);
                    }}
                  >
                    <Icon name="more" />
                  </button>
                  {menuFor === m.id && (
                    <div className="ms-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={busy.has(m.id)}
                        onClick={() => {
                          setMenuFor(null);
                          onAct(m, "remove");
                        }}
                      >
                        Remove connect
                      </button>
                    </div>
                  )}
                  <Avatar member={m} large />
                  <h3>{m.name}</h3>
                  <p>@{m.userName}</p>
                  <span className="ms-card-meta">
                    {m.occupation || "SkillSwap member"}
                  </span>
                  <SkillChips skills={m.skills} />
                  <span className="ms-card-footer">
                    <Rating member={m} />
                  </span>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function FindTab({
  results,
  query,
  setQuery,
  skill,
  setSkill,
  skills,
  busy,
  onAct,
  onRetry,
  profileProps,
}) {
  const searching = query.trim() || skill;
  return (
    <>
      <div className="ms-find-bar">
        <label className="ms-search">
          <Icon name="search" size={18} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, @username or skill…"
            aria-label="Search for skill connects"
            maxLength={50}
          />
        </label>
        <select
          className="ms-select"
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
          aria-label="Filter by skill"
        >
          <option value="">All skills</option>
          {skills.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="ms-section-title">
        <div>
          <h2>{searching ? "Results" : "Suggested for you"}</h2>
          {results.status === "ready" && (
            <span className="ms-count-pill">{results.members.length}</span>
          )}
        </div>
        {results.status === "ready" && results.members.length > 0 && (
          <span className="ms-muted ms-profile-hint">Hover or tap someone to see their profile</span>
        )}
      </div>

      {results.status === "loading" ? (
        <SkeletonCards count={4} className="ms-member-list" />
      ) : results.status === "error" ? (
        <ErrorBox message={results.error} onRetry={onRetry} />
      ) : results.members.length === 0 ? (
        <div className="ms-no-results">
          <Icon name="search" size={24} />
          <strong>No one matches that search</strong>
          <p>Try a different name or skill.</p>
        </div>
      ) : (
        <ul className="ms-member-list">
          {results.members.map((m) => (
            <li key={m.id} {...profileProps(m, "ms-member-row")}>
              <Avatar member={m} large />
              <div className="ms-member-info">
                <strong>{m.name}</strong>
                <span className="ms-muted">
                  @{m.userName}
                  {m.occupation && ` · ${m.occupation}`}
                </span>
                <SkillChips skills={m.skills} />
              </div>
              <div className="ms-member-side">
                <Rating member={m} />
                <ConnectButton member={m} busy={busy.has(m.id)} onAct={onAct} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PendingTab({ network, busy, onAct, onFind, profileProps }) {
  const { incoming, outgoing } = network;
  return (
    <>
      <section>
        <div className="ms-section-title">
          <div>
            <h2>Requests for you</h2>
            <span className="ms-count-pill">{incoming.length}</span>
          </div>
        </div>
        {incoming.length ? (
          <div className="ms-request-grid">
            {incoming.map((m) => (
              <article key={m.id} {...profileProps(m, "ms-request-card")}>
                <div className="ms-request-top">
                  <Avatar member={m} large />
                  <div>
                    <h3>{m.name}</h3>
                    <p>@{m.userName}</p>
                  </div>
                </div>
                <div className="ms-mutual">
                  <SkillChips skills={m.skills} max={2} />
                </div>
                <div className="ms-request-actions">
                  <button
                    type="button"
                    className="ms-accept"
                    disabled={busy.has(m.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAct(m, "accept");
                    }}
                  >
                    <Icon name="check" size={17} />
                    Accept
                  </button>
                  <button
                    type="button"
                    className="ms-decline"
                    disabled={busy.has(m.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAct(m, "decline");
                    }}
                    aria-label={`Decline ${m.name}`}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="ms-empty-requests">
            <span>
              <Icon name="check" />
            </span>
            <div>
              <strong>You’re all caught up</strong>
              <p>No one is waiting on you right now.</p>
            </div>
          </div>
        )}
      </section>

      <section className="ms-friends-section">
        <div className="ms-section-title">
          <div>
            <h2>Requests you sent</h2>
            <span className="ms-count-pill ms-quiet">{outgoing.length}</span>
          </div>
        </div>
        {outgoing.length ? (
          <ul className="ms-member-list">
            {outgoing.map((m) => (
              <li key={m.id} {...profileProps(m, "ms-member-row")}>
                <Avatar member={m} large />
                <div className="ms-member-info">
                  <strong>{m.name}</strong>
                  <span className="ms-muted">@{m.userName} · waiting for a reply</span>
                  <SkillChips skills={m.skills} />
                </div>
                <div className="ms-member-side">
                  <button
                    type="button"
                    className="ms-connect-button"
                    disabled={busy.has(m.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAct(m, "cancel");
                    }}
                  >
                    <Icon name="close" size={16} />
                    <span>Cancel request</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ms-no-results ms-compact">
            <strong>No requests waiting</strong>
            <p>
              Requests you send from{" "}
              <button type="button" className="ms-text-button" onClick={onFind}>
                Find connects
              </button>{" "}
              show up here.
            </p>
          </div>
        )}
      </section>
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const MySkills = ({ initialTab = "find" }) => {
  const { authFetch } = useAuth();
  const { network, statusOf, act: connectAct, busy, reload } = useConnects();
  const [tab, setTab] = useState(initialTab);

  // Find connects
  const [query, setQuery] = useState("");
  const [skill, setSkill] = useState("");
  const [skills, setSkills] = useState([]);
  const [results, setResults] = useState({ status: "loading", members: [], error: "" });
  const [searchKey, setSearchKey] = useState(0);

  const [actionError, setActionError] = useState("");

  // Someone edited their profile → their row (and open card) updates live
  useMemberUpdates((member) =>
    setResults((r) => ({ ...r, members: patchMembers(r.members, member) })),
  );

  useEffect(() => {
    const controller = new AbortController();
    requestJson(authFetch, "/members/skills", { signal: controller.signal })
      .then((data) => setSkills(data.skills))
      .catch(() => {}); // the skill filter is optional
    return () => controller.abort();
  }, [authFetch]);

  // Search as you type (debounced). No search → suggested members.
  useEffect(() => {
    const controller = new AbortController();
    const q = query.trim();
    const timer = setTimeout(
      () => {
        setResults((r) => ({ ...r, status: "loading", error: "" }));
        const params = new URLSearchParams({
          limit: String(q || skill ? RESULT_LIMIT : SUGGESTION_LIMIT),
        });
        if (q) params.set("q", q);
        if (skill) params.set("skill", skill);
        requestJson(authFetch, `/members?${params}`, { signal: controller.signal })
          .then((data) => setResults({ status: "ready", members: data.members, error: "" }))
          .catch((err) => {
            if (err.name === "AbortError") return;
            setResults({ status: "error", members: [], error: err.message });
          });
      },
      q ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [authFetch, query, skill, searchKey]);

  const act = async (member, kind) => {
    if (!kind || busy.has(member.id)) return;
    setActionError("");
    try {
      await connectAct(member, kind);
    } catch (err) {
      setActionError(err.message);
    }
  };

  // Search results show the live relationship from the shared network
  const liveResults = {
    ...results,
    members: results.members.map((m) => ({ ...m, friendship: statusOf(m.id, m.friendship) })),
  };

  // Profile card: hover on mouse/trackpad, tap on touch screens
  const profile = useProfileCard();
  const profileProps = (m, className) => ({
    className: `${className} ms-has-profile${profile.isActive(m.id) ? " ms-profile-open" : ""}`,
    tabIndex: 0,
    "aria-haspopup": "dialog",
    onMouseEnter: (e) => profile.hoverEnter(m, e.currentTarget),
    onMouseLeave: profile.hoverLeave,
    onClick: (e) => profile.open(m, e.currentTarget, true),
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      profile.open(m, e.currentTarget, true);
    },
  });
  // Latest copy of whoever's open, so connect changes show while it's open
  let cardPerson = null;
  if (profile.card) {
    const id = profile.card.person.id;
    const found =
      [...liveResults.members, ...network.friends, ...network.incoming, ...network.outgoing].find(
        (m) => m.id === id,
      ) || profile.card.person;
    cardPerson = { ...found, friendship: statusOf(id, found.friendship) };
  }

  const counts = {
    connects: network.friends.length,
    pending: network.incoming.length,
  };

  return (
    <div className="my-skills">
      <div className="ms-content">
        <section className="ms-heading">
          <div>
            <span className="ms-eyebrow">YOUR SKILL NETWORK</span>
            <h1>
              Connects<span>.</span>
            </h1>
            <p>The people you learn from and teach — find new ones and keep up with requests.</p>
          </div>
          <div className="ms-total">
            <strong>{network.status === "ready" ? counts.connects : "–"}</strong>
            <span>
              skill
              <br />
              connects
            </span>
          </div>
        </section>

        <div className="ms-page-tabs" role="tablist" aria-label="Connects">
          {TABS.map(([id, label, short]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`ms-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`ms-panel-${id}`}
              className={tab === id ? "ms-active" : ""}
              onClick={() => setTab(id)}
              aria-label={
                id === "connects" && network.status === "ready"
                  ? `${label}, ${counts.connects}`
                  : id === "pending" && counts.pending > 0
                    ? `${label}, ${counts.pending} waiting`
                    : label
              }
            >
              <span className="ms-tab-label" aria-hidden="true">
                <span className="ms-tab-full">{label}</span>
                <span className="ms-tab-short">{short}</span>
              </span>
              {id === "connects" && network.status === "ready" && (
                <span className="ms-tab-count">{counts.connects}</span>
              )}
              {id === "pending" && counts.pending > 0 && (
                <span className="ms-tab-count ms-hot">{counts.pending}</span>
              )}
            </button>
          ))}
        </div>

        {actionError && (
          <p className="ms-alert" role="alert">
            {actionError}
            <button type="button" aria-label="Dismiss" onClick={() => setActionError("")}>
              <Icon name="close" size={14} />
            </button>
          </p>
        )}

        <div
          role="tabpanel"
          id={`ms-panel-${tab}`}
          aria-labelledby={`ms-tab-${tab}`}
          className="ms-panel"
          key={tab}
        >
          {tab === "find" ? (
            <FindTab
              results={liveResults}
              query={query}
              setQuery={setQuery}
              skill={skill}
              setSkill={setSkill}
              skills={skills}
              busy={busy}
              onAct={act}
              onRetry={() => setSearchKey((k) => k + 1)}
              profileProps={profileProps}
            />
          ) : network.status === "loading" ? (
            <SkeletonCards />
          ) : network.status === "error" ? (
            <ErrorBox
              message={network.error}
              onRetry={reload}
            />
          ) : tab === "pending" ? (
            <PendingTab
              network={network}
              busy={busy}
              onAct={act}
              onFind={() => setTab("find")}
              profileProps={profileProps}
            />
          ) : (
            <ConnectsTab
              network={network}
              busy={busy}
              onAct={act}
              onFind={() => setTab("find")}
              onPending={() => setTab("pending")}
              profileProps={profileProps}
            />
          )}
        </div>
      </div>

      {profile.card && (
        <ProfileCard
          {...profile.cardProps}
          card={{ ...profile.card, person: cardPerson }}
          skill={skill}
          busy={busy.has(cardPerson.id)}
          onFriendAction={(person) => act(person, CARD_ACTION[person.friendship])}
        />
      )}
    </div>
  );
};

export default MySkills;

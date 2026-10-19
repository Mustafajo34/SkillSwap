import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useRealtime } from "../realtime/useRealtime";
import { requestJson } from "../utils/api";
import { stripInvisible, textSafetyProblem } from "../utils/contentSafety";
import UserAvatar from "./UserAvatar";

// "Rate your session" on the Live Sessions ended screen. Everyone who was in
// the call sees it and rates each other person: 1–5 stars, optional quick
// compliments and a short comment. The server (GET/POST
// /sessions/:roomId/ratings) decides who can be rated; the stars count
// towards that member's rating everywhere in the app (it's pushed live as
// member:updated). Renders nothing when there's no one to rate.

const LABELS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

function StarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" />
    </svg>
  );
}

// Five stars as a radio group: click/tap, hover to preview (mouse only),
// arrow keys / Home / End from the keyboard
function StarPicker({ value, onChange, name, disabled }) {
  const [hover, setHover] = useState(0);
  const refs = useRef([]);
  const shown = hover || value;

  const pick = (n) => {
    onChange(n);
    refs.current[n - 1]?.focus();
  };
  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (step) {
      e.preventDefault();
      pick(Math.min(5, Math.max(1, (value || 0) + step)));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      pick(e.key === "Home" ? 1 : 5);
    }
  };

  return (
    <div className="rate-stars-wrap">
      <div
        className="rate-stars"
        role="radiogroup"
        aria-label={`Rate ${name}`}
        onPointerLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            ref={(el) => (refs.current[n - 1] = el)}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"} — ${LABELS[n]}`}
            tabIndex={value ? (value === n ? 0 : -1) : n === 1 ? 0 : -1}
            className={`rate-star${n <= shown ? " is-on" : ""}${hover && n <= hover ? " is-preview" : ""}`}
            disabled={disabled}
            onClick={() => pick(n)}
            onPointerEnter={(e) => e.pointerType === "mouse" && setHover(n)}
            onKeyDown={onKeyDown}
          >
            <StarIcon />
          </button>
        ))}
      </div>
      <span className={`rate-label${shown ? " is-set" : ""}`} aria-hidden="true">
        {shown ? LABELS[shown] : "Tap a star"}
      </span>
    </div>
  );
}

// One person to rate: pick → (compliments, comment) → save → thank-you
function RatePerson({ person, tags, commentMax, onSave }) {
  const id = useId();
  const saved = person.yours;
  const [editing, setEditing] = useState(!saved);
  const [rating, setRating] = useState(saved?.rating || 0);
  const [picked, setPicked] = useState(() => new Set(saved?.tags || []));
  const [comment, setComment] = useState(saved?.comment || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const firstName = person.name.split(" ")[0];

  const toggleTag = (tag) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(tag)) next.add(tag);
      return next;
    });

  const submit = async (e) => {
    e.preventDefault();
    if (!rating || saving) return;
    // Same checks as the server: no code, harmful symbols, secrets, phishing
    const text = stripInvisible(comment).trim();
    const problem = textSafetyProblem(text);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(person.id, { rating, tags: [...picked], comment: text });
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const head = (
    <div className="rate-person-head">
      <UserAvatar
        id={person.id}
        name={person.name}
        photoV={person.photoV}
        className="rate-avatar"
      />
      <div className="rate-person-name">
        <strong>{person.name}</strong>
        <span>{saved && !editing ? "You rated this session" : "How was your session?"}</span>
      </div>
      {person.ratedYou && <span className="rate-chip">Rated you</span>}
    </div>
  );

  if (!editing && saved) {
    return (
      <li className="rate-person is-done">
        {head}
        <div className="rate-done">
          <span className="rate-done-stars" aria-label={`${saved.rating} out of 5 stars`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={n <= saved.rating ? "is-on" : ""}>
                <StarIcon />
              </span>
            ))}
          </span>
          <span className="rate-done-text">
            Thanks! {firstName} will see your {LABELS[saved.rating].toLowerCase()} rating.
          </span>
          <button type="button" className="rate-edit" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
        {saved.tags.length > 0 && (
          <ul className="rate-tags is-static" aria-label="Your compliments">
            {saved.tags.map((tag) => (
              <li key={tag}>
                <span className="rate-tag is-on">{tag}</span>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li className="rate-person">
      <form onSubmit={submit} aria-labelledby={`${id}-name`}>
        <span id={`${id}-name`} className="sr-only">
          Rate {person.name}
        </span>
        {head}
        <StarPicker value={rating} onChange={setRating} name={person.name} disabled={saving} />

        {/* Compliments + comment open up once there's a star rating */}
        <div className={`rate-more${rating ? " is-open" : ""}`} aria-hidden={!rating}>
          <div className="rate-more-inner">
            <p className="rate-more-title">What stood out?</p>
            <ul className="rate-tags">
              {tags.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    className={`rate-tag${picked.has(tag) ? " is-on" : ""}`}
                    aria-pressed={picked.has(tag)}
                    onClick={() => toggleTag(tag)}
                    tabIndex={rating ? 0 : -1}
                    disabled={saving}
                  >
                    {tag}
                  </button>
                </li>
              ))}
            </ul>
            <label className="rate-comment">
              <span className="sr-only">Comment for {person.name} (optional)</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, commentMax))}
                placeholder={`Anything ${firstName} should know? (optional)`}
                rows={2}
                maxLength={commentMax}
                tabIndex={rating ? 0 : -1}
                disabled={saving}
              />
              <span className="rate-count" aria-hidden="true">
                {comment.length}/{commentMax}
              </span>
            </label>
            {error && (
              <p className="join-link-error" role="alert">
                {error}
              </p>
            )}
            <div className="rate-actions">
              {saved && (
                <button
                  type="button"
                  className="rate-cancel"
                  onClick={() => {
                    setRating(saved.rating);
                    setPicked(new Set(saved.tags));
                    setComment(saved.comment);
                    setError("");
                    setEditing(false);
                  }}
                  tabIndex={rating ? 0 : -1}
                  disabled={saving}
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="rate-submit"
                disabled={!rating || saving}
                tabIndex={rating ? 0 : -1}
              >
                {saving ? "Saving…" : saved ? "Update rating" : "Submit rating"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </li>
  );
}

export default function SessionRating({ roomId }) {
  const { authFetch } = useAuth();
  const { subscribe } = useRealtime();
  const [data, setData] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    requestJson(authFetch, `/sessions/${encodeURIComponent(roomId)}/ratings`, {
      signal: controller.signal,
    })
      .then(setData)
      .catch(() => {}); // not rateable (expired, weren't in the call…): show nothing
    return () => controller.abort();
  }, [authFetch, roomId, version]);

  // The other person rated you → their "Rated you" chip appears live
  useEffect(
    () =>
      subscribe("session:rated", (event) => {
        if (event?.roomId === roomId) setVersion((v) => v + 1);
      }),
    [subscribe, roomId],
  );

  const save = useCallback(
    async (userId, rating) => {
      const { rating: stored } = await requestJson(
        authFetch,
        `/sessions/${encodeURIComponent(roomId)}/ratings`,
        { method: "POST", body: JSON.stringify({ userId, ...rating }) },
      );
      setData((d) => ({
        ...d,
        people: d.people.map((p) =>
          p.id === userId
            ? { ...p, yours: { rating: stored.rating, tags: stored.tags, comment: stored.comment } }
            : p,
        ),
      }));
    },
    [authFetch, roomId],
  );

  if (!data?.open || !data.people.length) return null;
  const left = data.people.filter((p) => !p.yours).length;

  return (
    <section className="rate-panel" aria-label="Rate your session">
      <header className="rate-panel-head">
        <h3>Rate your session</h3>
        <p>
          {left
            ? "Your rating helps others find great people to learn from."
            : "All done — thanks for rating!"}
        </p>
      </header>
      <ul className="rate-people">
        {data.people.map((person) => (
          <RatePerson
            key={`${person.id}-${person.yours ? "saved" : "new"}`}
            person={person}
            tags={data.tags}
            commentMax={data.commentMax}
            onSave={save}
          />
        ))}
      </ul>
    </section>
  );
}

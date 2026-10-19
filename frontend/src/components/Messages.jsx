import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useRealtime } from "../realtime/useRealtime";
import { useMemberUpdates } from "../hooks/useMemberUpdates";
import UserAvatar from "./UserAvatar";
import { API_BASE, requestJson } from "../utils/api";
import { feedLinkProblem, feedTextProblem, stripInvisible } from "../utils/contentSafety";
import {
  IMAGE_TYPES,
  describeLink,
  linkProblem,
  linkifyParts,
  prepareImage,
  safeLink,
} from "../utils/attachments";
import "../css/Messages.css";

// Connects Feed tab (Messages) — the shared message board. Everything is
// saved by the backend's messageBoard API (posts in the "messageBoard"
// collection, images in their own collection) and changes from other people
// arrive live ("messageBoard:changed"). Post text, up to 4 images and up to
// 3 links; like, reply, search, sort; delete your own posts.
//
// Friends only: you only see, comment on and react to posts from yourself
// and your accepted connects — and on those posts you only see comments and
// reactions from yourself and your connects (a comment you can't see hides
// its replies too). The server enforces this; the board reloads when your
// connects change.

const POST_MAX = 500;
const REPLY_MAX = 300;
const SEARCH_MAX = 50;
const MAX_IMAGES = 4;
const MAX_LINKS = 3;
const SEARCH_DELAY_MS = 300;
const EMOJIS = ["🙂", "🎉", "👏", "💡", "🔥", "🙌"];
// Emoji reactions on posts and replies. Keys match REACTIONS in
// backend/models/messageBoardModel.js.
const REACTIONS = [
  { key: "thumbs", emoji: "\u{1F44D}", label: "Like" },
  { key: "heart", emoji: "\u{2764}\u{FE0F}", label: "Love" },
  { key: "joy", emoji: "\u{1F602}", label: "Haha" },
  { key: "party", emoji: "\u{1F389}", label: "Celebrate" },
  { key: "wow", emoji: "\u{1F62E}", label: "Wow" },
  { key: "fire", emoji: "\u{1F525}", label: "Fire" },
];
const REACTION_BY_KEY = Object.fromEntries(REACTIONS.map((r) => [r.key, r]));

// Your reaction applied locally (same emoji → removed, another → swapped),
// so it shows at once; the server's answer replaces it
function applyReaction(list = [], key) {
  const previous = list.find((r) => r.mine)?.key;
  const next = list
    .map((r) => (r.mine ? { ...r, mine: false, count: r.count - 1 } : r))
    .filter((r) => r.count > 0);
  if (previous === key) return next;
  const existing = next.find((r) => r.key === key);
  const added = existing
    ? next.map((r) => (r.key === key ? { ...r, mine: true, count: r.count + 1 } : r))
    : [...next, { key, count: 1, mine: true, names: [] }];
  return REACTIONS.map((r) => added.find((x) => x.key === r.key)).filter(Boolean);
}

// "You, Jane Doe and 2 others"
function reactorsText(r) {
  const names = [...(r.mine ? ["You"] : []), ...(r.names || [])];
  const others = r.count - names.length;
  const shown = names.slice(0, 3);
  const rest = others + (names.length - shown.length);
  if (rest > 0) return `${shown.join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0] || "";
}

// Closes a popover on a click/tap outside it or Esc
function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, ref]);
}

function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Length, then the feed's safety rules — script / injection, harmful
// symbols, HTML, secrets, credential requests, unsafe links (see
// utils/contentSafety.js). The server checks everything again.
function textProblem(text, max) {
  if (text.length > max) return `Keep it to ${max} characters or fewer.`;
  return feedTextProblem(text);
}

const localId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const imageSrc = (url) => `${API_BASE}${url}`;

// ── Icons ────────────────────────────────────────────────────────────────────

const PATHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5a5.5 5.5 0 0 0 1-8.9Z" />
  ),
  comment: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />,
  dots: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4 17 5-5 4 4 2-2 5 5" />
    </>
  ),
  link: (
    <>
      <path d="m10 13 4-4" />
      <path d="M8.5 16.5 6 19a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0" />
      <path d="m15.5 7.5 2.5-2.5a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <path d="M9 9h.01M15 9h.01" />
    </>
  ),
  react: (
    <>
      <path d="M20.5 11.5A8.5 8.5 0 1 1 12.5 3.5" />
      <path d="M8.5 14s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8M9 9.5h.01M15 9.5h.01M19 2v5M16.5 4.5h5" />
    </>
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path d="M22 2 11 13" />
    </>
  ),
};

function Icon({ name, size = 20, filled = false }) {
  return (
    <svg aria-hidden="true" fill={filled ? "currentColor" : "none"} height={size} viewBox="0 0 24 24" width={size}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {PATHS[name]}
      </g>
    </svg>
  );
}

// Text with any web links made clickable (only safe http/https links —
// see linkifyParts). Everything else stays plain text.
function RichText({ text }) {
  return linkifyParts(text).map((part, i) =>
    part.href ? (
      <a key={i} href={part.href} target="_blank" rel="noopener noreferrer nofollow ugc">
        {part.text}
      </a>
    ) : (
      <span key={i}>{part.text}</span>
    ),
  );
}

function LinkCard({ href }) {
  const { host, path } = describeLink(href);
  return (
    <a className="mg-link-card" href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
      <span className="mg-link-icon">
        <Icon name="link" size={16} />
      </span>
      <span className="mg-link-text">
        <strong>{host}</strong>
        {path && <small>{path}</small>}
      </span>
      <span className="mg-link-open" aria-hidden="true">
        ↗
      </span>
    </a>
  );
}

// ── Reactions ────────────────────────────────────────────────────────────────

// The emoji chips on a post or reply (tap one to add / take back yours) and
// a button that opens all six. Anyone who can see the post can react.
function ReactionBar({ reactions = [], onReact, label, small = false, children }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useDismiss(open, setOpen, wrapRef);

  const pick = (key) => {
    setOpen(false);
    onReact(key);
  };

  return (
    <div className={`mg-reactions${small ? " is-small" : ""}`}>
      {children}
      {reactions.map((r) => (
        <button
          key={r.key}
          type="button"
          className={`mg-reaction${r.mine ? " mine" : ""}`}
          aria-pressed={r.mine}
          aria-label={`${REACTION_BY_KEY[r.key]?.label}: ${reactorsText(r)}. ${r.mine ? "Remove yours" : "React"}`}
          title={reactorsText(r)}
          onClick={() => pick(r.key)}
        >
          <span aria-hidden="true">{REACTION_BY_KEY[r.key]?.emoji}</span>
          <b>{r.count}</b>
        </button>
      ))}
      <div className="mg-react-wrap" ref={wrapRef}>
        <button
          type="button"
          className="mg-react-add"
          aria-label={`React to ${label}`}
          aria-expanded={open}
          title="React"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="react" size={small ? 15 : 17} />
        </button>
        {open && (
          <div className="mg-react-menu" role="menu" aria-label="Reactions">
            {REACTIONS.map((r) => (
              <button
                key={r.key}
                type="button"
                role="menuitem"
                aria-label={r.label}
                title={r.label}
                className={reactions.some((x) => x.key === r.key && x.mine) ? "mine" : ""}
                onClick={() => pick(r.key)}
              >
                {r.emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── A post ───────────────────────────────────────────────────────────────────

// How far replies step in. Deeper answers keep going (any depth) but stay
// at this indent, with "Replying to …" so it's clear who they answer —
// otherwise long threads would squeeze to nothing on phones.
const MAX_INDENT = 3;

// Replies grouped under the reply they answer ("" = the post itself).
// A reply whose parent isn't shown (e.g. its author left the post
// author's connects) is treated as a reply to the post.
function threadOf(replies) {
  const ids = new Set(replies.map((r) => r.id));
  const children = new Map();
  for (const r of replies) {
    const parent = r.parentId && ids.has(r.parentId) ? r.parentId : "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(r);
  }
  return children;
}

// A reply box: text, emoji, send. Under the post and under any reply.
function ReplyComposer({ me, to, onSubmit, onCancel }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiRef = useRef(null);
  const inputRef = useRef(null);
  useDismiss(emojiOpen, setEmojiOpen, emojiRef);

  const submit = async () => {
    const body = stripInvisible(text).trim();
    if (!body || busy) return;
    const problem = textProblem(body, REPLY_MAX);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(body);
      setText("");
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Put the emoji where the cursor is
  const addEmoji = (emoji) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, REPLY_MAX);
    setText(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      input?.focus();
      const at = Math.min(start + emoji.length, next.length);
      input?.setSelectionRange(at, at);
    });
  };

  return (
    <>
      <div className="mg-inline-reply">
        <UserAvatar id={me.id} name={me.name} photoV={me.photoV} className="mg-avatar mg-avatar-small" />
        <input
          ref={inputRef}
          autoFocus
          maxLength={REPLY_MAX}
          aria-label={`Reply to ${to}`}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
            if (event.key === "Escape" && !emojiOpen) onCancel();
          }}
          placeholder={`Reply to ${to}…`}
          value={text}
          disabled={busy}
        />
        <div className="mg-emoji-wrap mg-reply-emoji" ref={emojiRef}>
          <button
            type="button"
            className="mg-reply-emoji-btn"
            aria-label="Add emoji to your reply"
            aria-expanded={emojiOpen}
            title="Add emoji"
            onClick={() => setEmojiOpen((open) => !open)}
          >
            <Icon name="smile" size={18} />
          </button>
          {emojiOpen && (
            <div className="mg-emoji-menu" role="menu" aria-label="Emoji">
              {EMOJIS.map((emoji) => (
                <button key={emoji} type="button" role="menuitem" onClick={() => addEmoji(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          aria-label="Post reply"
          disabled={!text.trim() || busy}
          onClick={submit}
          title="Post reply"
          type="button"
        >
          <Icon name="send" size={17} />
        </button>
      </div>
      {error && (
        <p className="mg-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

// One reply, its Reply button and reactions, and everything answering it
function ReplyItem({ item, parent, depth, thread, post, me, replyTo, setReplyTo, onReply, onReact }) {
  const answers = thread.get(item.id) || [];
  const open = replyTo === item.id;
  const first = item.author.name.split(" ")[0];
  return (
    <div className="mg-reply-node">
      <div className="mg-reply">
        <UserAvatar
          id={item.author.id}
          name={item.author.name}
          photoV={item.author.photoV}
          className="mg-avatar mg-avatar-small"
        />
        <div className="mg-reply-body">
          <div className="mg-reply-meta">
            <strong>{item.author.name}</strong>
            <span>{timeAgo(item.createdAt)}</span>
          </div>
          {/* Past the indent limit, say who this answers */}
          {parent && depth > MAX_INDENT && (
            <span className="mg-reply-to">↳ Replying to {parent.author.name}</span>
          )}
          <p>
            <RichText text={item.body} />
          </p>
          <ReactionBar
            small
            reactions={item.reactions}
            onReact={(key) => onReact(post.id, item.id, key)}
            label={`${item.author.name}'s reply`}
          >
            <button
              type="button"
              className="mg-reply-btn"
              aria-expanded={open}
              aria-label={`Reply to ${item.author.name}`}
              onClick={() => setReplyTo(open ? null : item.id)}
            >
              <Icon name="comment" size={14} />
              Reply
            </button>
          </ReactionBar>
          {open && (
            <ReplyComposer
              me={me}
              to={first}
              onSubmit={async (body) => {
                await onReply(post.id, body, item.id);
                setReplyTo(null);
              }}
              onCancel={() => setReplyTo(null)}
            />
          )}
        </div>
      </div>
      {answers.length > 0 && (
        <div className={`mg-thread${depth < MAX_INDENT ? " is-nested" : ""}`}>
          {answers.map((answer) => (
            <ReplyItem
              key={answer.id}
              item={answer}
              parent={item}
              depth={depth + 1}
              thread={thread}
              post={post}
              me={me}
              replyTo={replyTo}
              setReplyTo={setReplyTo}
              onReply={onReply}
              onReact={onReact}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MessageCard({ post, me, onLike, onReply, onReact, onDelete, onOpenImage }) {
  // Whose reply box is open: "post", a reply's id, or null (one at a time)
  const [replyTo, setReplyTo] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const thread = threadOf(post.replies);
  const topLevel = thread.get("") || [];

  const remove = async () => {
    setDeleteError("");
    try {
      await onDelete(post.id);
    } catch (err) {
      setDeleteError(err.message);
    }
  };

  return (
    <article className="mg-card">
      <div className="mg-card-main">
        <UserAvatar id={post.author.id} name={post.author.name} photoV={post.author.photoV} className="mg-avatar" />
        <div className="mg-card-content">
          <div className="mg-topline">
            <div>
              <strong>{post.author.name}</strong>
              <span>
                {post.author.userName ? `@${post.author.userName} · ` : ""}
                {timeAgo(post.createdAt)}
              </span>
            </div>
            {post.mine && (
              <div className="mg-menu-wrap">
                <button
                  aria-label="Post options"
                  aria-expanded={menuOpen}
                  className="mg-icon-button"
                  title="Post options"
                  type="button"
                  onClick={() => {
                    setMenuOpen((open) => !open);
                    setConfirmDelete(false);
                    setDeleteError("");
                  }}
                >
                  <Icon name="dots" />
                </button>
                {menuOpen && (
                  <div className="mg-menu" role="menu">
                    {confirmDelete ? (
                      <>
                        <span>Delete this post?</span>
                        <button type="button" role="menuitem" className="mg-danger" onClick={remove}>
                          Yes, delete
                        </button>
                        <button type="button" role="menuitem" onClick={() => setMenuOpen(false)}>
                          Cancel
                        </button>
                        {deleteError && <span className="mg-menu-error">{deleteError}</span>}
                      </>
                    ) : (
                      <button type="button" role="menuitem" className="mg-danger" onClick={() => setConfirmDelete(true)}>
                        Delete post
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {post.body && (
            <p className="mg-body">
              <RichText text={post.body} />
            </p>
          )}

          {post.images.length > 0 && (
            <div className={`mg-images count-${post.images.length}`}>
              {post.images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  className="mg-image"
                  onClick={() => onOpenImage(imageSrc(img.url))}
                  aria-label={`Open image ${i + 1} of ${post.images.length} full size`}
                >
                  <img src={imageSrc(img.url)} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          )}

          {post.links.length > 0 && (
            <div className="mg-links">
              {post.links.map((href) => (
                <LinkCard key={href} href={href} />
              ))}
            </div>
          )}

          <ReactionBar
            reactions={post.reactions}
            onReact={(key) => onReact(post.id, null, key)}
            label={`${post.author.name}'s post`}
          >
          <div className="mg-actions">
            <button
              className={post.liked ? "mg-action liked" : "mg-action"}
              onClick={() => onLike(post)}
              type="button"
              aria-pressed={post.liked}
              aria-label={post.liked ? "Unlike" : "Like"}
            >
              <Icon filled={post.liked} name="heart" size={18} />
              <span>{post.likeCount}</span>
            </button>
            <button
              className="mg-action"
              onClick={() => setReplyTo((to) => (to === "post" ? null : "post"))}
              type="button"
              aria-expanded={replyTo === "post"}
            >
              <Icon name="comment" size={18} />
              <span>
                {post.replyCount} {post.replyCount === 1 ? "reply" : "replies"}
              </span>
            </button>
          </div>
          </ReactionBar>

          {topLevel.length > 0 && (
            <div className="mg-replies">
              {topLevel.map((item) => (
                <ReplyItem
                  key={item.id}
                  item={item}
                  parent={null}
                  depth={1}
                  thread={thread}
                  post={post}
                  me={me}
                  replyTo={replyTo}
                  setReplyTo={setReplyTo}
                  onReply={onReply}
                  onReact={onReact}
                />
              ))}
            </div>
          )}

          {replyTo === "post" && (
            <ReplyComposer
              me={me}
              to={post.author.name}
              onSubmit={async (body) => {
                await onReply(post.id, body, null);
                setReplyTo(null);
              }}
              onCancel={() => setReplyTo(null)}
            />
          )}
        </div>
      </div>
    </article>
  );
}

// ── Board ────────────────────────────────────────────────────────────────────

const Messages = () => {
  const { user, authFetch } = useAuth();
  const { subscribe } = useRealtime();
  const me = {
    id: user?.id || "me",
    name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.userName || "You",
    photoV: user?.photoV || null,
  };

  // The board
  const [feed, setFeed] = useState({ status: "loading", posts: [], error: "" });
  const [sort, setSort] = useState("newest");
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0); // bump to reload
  const [actionError, setActionError] = useState("");

  // The post being written
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [images, setImages] = useState([]); // { key, preview, status, id, error }
  const [links, setLinks] = useState([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState("");
  const [attachError, setAttachError] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [viewer, setViewer] = useState(null);
  const fileInput = useRef(null);

  // Re-render every minute so "5m ago" stays current
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const searchText = stripInvisible(query).trim();
  const searchProblem = searchText ? textProblem(searchText, SEARCH_MAX) : "";
  const q = searchProblem ? "" : searchText;

  // Load (and re-load) the board; searching waits for a pause in typing
  useEffect(() => {
    if (searchProblem) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({ sort });
        if (q) params.set("q", q);
        requestJson(authFetch, `/messageBoard/posts?${params}`, { signal: controller.signal })
          .then((data) => setFeed({ status: "ready", posts: data.posts, error: "" }))
          .catch((err) => {
            if (err.name === "AbortError") return;
            setFeed((f) => ({ ...f, status: f.status === "ready" ? "ready" : "error", error: err.message }));
          });
      },
      q ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [authFetch, sort, q, searchProblem, version]);

  // Someone edited their profile → their name/username/photo on posts and
  // replies updates live
  useMemberUpdates((member) =>
    // Rating / swap-count updates don't change how authors are shown
    "name" in member &&
    setFeed((f) => {
      const fix = (author) =>
        author?.id === member.id
          ? { ...author, name: member.name, userName: member.userName, photoV: member.photoV }
          : author;
      const touches = (p) =>
        p.author?.id === member.id || (p.replies || []).some((r) => r.author?.id === member.id);
      if (!f.posts.some(touches)) return f;
      return {
        ...f,
        posts: f.posts.map((p) =>
          touches(p)
            ? { ...p, author: fix(p.author), replies: (p.replies || []).map((r) => ({ ...r, author: fix(r.author) })) }
            : p,
        ),
      };
    }),
  );

  // Live: other people's posts, replies, likes and deletions
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let timer;
    const off = subscribe("messageBoard:changed", (event) => {
      if (event?.type === "like") {
        setFeed((f) => ({
          ...f,
          posts: f.posts.map((p) => (p.id === event.postId ? { ...p, likeCount: event.likeCount } : p)),
        }));
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(reload, 250); // several quick changes → one reload
    });
    const offReconnect = subscribe("realtime:reconnected", reload);
    // Accepting or removing a connect changes whose posts you can see
    const offConnects = subscribe("connects:changed", (event) => {
      if (event?.type === "accept" || event?.type === "remove") reload();
    });
    return () => {
      clearTimeout(timer);
      off();
      offReconnect();
      offConnects();
    };
  }, [subscribe, reload]);

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e) => e.key === "Escape" && setViewer(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer]);

  // Free preview memory when images leave the composer
  const previewsRef = useRef([]);
  useEffect(() => {
    const current = images.map((img) => img.preview);
    previewsRef.current.filter((url) => !current.includes(url)).forEach((url) => URL.revokeObjectURL(url));
    previewsRef.current = current;
  }, [images]);
  useEffect(() => () => previewsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const updatePost = (id, change) =>
    setFeed((f) => ({ ...f, posts: f.posts.map((p) => (p.id === id ? change(p) : p)) }));

  // ── Composer ──

  const uploading = images.some((img) => img.status === "uploading");
  const readyImages = images.filter((img) => img.status === "ready");
  const canPost =
    Boolean(draft.trim() || readyImages.length || links.length) && !uploading && !posting;

  // Each image is checked + shrunk in the browser, then uploaded on its own
  const addImages = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    setAttachError("");
    const room = MAX_IMAGES - images.length;
    const problems = [];
    if (files.length > room) problems.push(`You can add up to ${MAX_IMAGES} images per post.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const key = localId();
      let prepared;
      try {
        prepared = await prepareImage(file);
      } catch (err) {
        problems.push(err.message);
        continue;
      }
      const preview = URL.createObjectURL(prepared.blob);
      setImages((list) => [...list, { key, preview, status: "uploading" }]);
      try {
        const response = await authFetch(`${API_BASE}/messageBoard/images`, {
          method: "POST",
          headers: { "Content-Type": prepared.blob.type },
          body: prepared.blob,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.message || "Upload failed.");
        setImages((list) =>
          list.map((img) => (img.key === key ? { ...img, status: "ready", id: data.image.id } : img)),
        );
      } catch (err) {
        setImages((list) => list.map((img) => (img.key === key ? { ...img, status: "error" } : img)));
        problems.push(`${file.name}: ${err.message}`);
      }
    }
    if (problems.length) setAttachError(problems.join(" "));
  };

  const removeImage = (img) => {
    setImages((list) => list.filter((x) => x.key !== img.key));
    if (img.id) {
      // Tidy up the unposted upload (it would expire on its own anyway)
      requestJson(authFetch, `/messageBoard/images/${img.id}`, { method: "DELETE" }).catch(() => {});
    }
  };

  const addLink = () => {
    const problem = linkProblem(linkInput) || feedLinkProblem(linkInput.trim());
    if (problem) {
      setLinkError(problem);
      return;
    }
    const href = safeLink(linkInput);
    if (links.includes(href)) {
      setLinkError("You've already added that link.");
      return;
    }
    setLinks((current) => [...current, href]);
    setLinkInput("");
    setLinkError("");
    if (links.length + 1 >= MAX_LINKS) setLinkOpen(false);
  };

  const addEmoji = (emoji) => {
    setDraft((d) => (d + emoji).slice(0, POST_MAX));
    setEmojiOpen(false);
  };

  const postMessage = async () => {
    if (!canPost) return;
    const text = stripInvisible(draft).trim();
    const problem = text ? textProblem(text, POST_MAX) : "";
    if (problem) {
      setDraftError(problem);
      return;
    }
    setPosting(true);
    setDraftError("");
    try {
      const { post } = await requestJson(authFetch, "/messageBoard/posts", {
        method: "POST",
        body: JSON.stringify({ body: text, links, imageIds: readyImages.map((img) => img.id) }),
      });
      setFeed((f) => ({ ...f, posts: [post, ...f.posts.filter((p) => p.id !== post.id)] }));
      setDraft("");
      setImages([]);
      setLinks([]);
      setLinkOpen(false);
      setLinkInput("");
      setAttachError("");
    } catch (err) {
      setDraftError(err.message);
    } finally {
      setPosting(false);
    }
  };

  // ── Post actions ──

  const like = async (post) => {
    setActionError("");
    // Show it straight away; the server's numbers win when it answers
    updatePost(post.id, (p) => ({ ...p, liked: !p.liked, likeCount: p.likeCount + (p.liked ? -1 : 1) }));
    try {
      const { liked, likeCount } = await requestJson(authFetch, `/messageBoard/posts/${post.id}/like`, {
        method: "POST",
      });
      updatePost(post.id, (p) => ({ ...p, liked, likeCount }));
    } catch (err) {
      updatePost(post.id, (p) => ({ ...p, liked: post.liked, likeCount: post.likeCount }));
      setActionError(err.message);
    }
  };

  // parentId: the reply being answered (null = the post itself)
  const reply = async (postId, body, parentId = null) => {
    const data = await requestJson(authFetch, `/messageBoard/posts/${postId}/replies`, {
      method: "POST",
      body: JSON.stringify({ body, parentId }),
    });
    updatePost(postId, (p) => ({
      ...p,
      replies: [...p.replies.filter((r) => r.id !== data.reply.id), data.reply],
      replyCount: data.replyCount,
    }));
  };

  // React to a post (replyId null) or one of its replies
  const react = async (postId, replyId, key) => {
    setActionError("");
    const change = (fn) =>
      updatePost(postId, (p) =>
        replyId
          ? { ...p, replies: p.replies.map((r) => (r.id === replyId ? { ...r, reactions: fn(r.reactions) } : r)) }
          : { ...p, reactions: fn(p.reactions) },
      );
    // What it was, to put back if the server says no
    const post = feed.posts.find((p) => p.id === postId);
    const before = replyId ? post?.replies.find((r) => r.id === replyId)?.reactions : post?.reactions;
    change((list) => applyReaction(list, key));
    try {
      const path = replyId
        ? `/messageBoard/posts/${postId}/replies/${replyId}/reactions`
        : `/messageBoard/posts/${postId}/reactions`;
      const { reactions } = await requestJson(authFetch, path, {
        method: "POST",
        body: JSON.stringify({ key }),
      });
      change(() => reactions);
    } catch (err) {
      change(() => before || []);
      setActionError(err.message);
    }
  };

  const remove = async (postId) => {
    await requestJson(authFetch, `/messageBoard/posts/${postId}`, { method: "DELETE" });
    setFeed((f) => ({ ...f, posts: f.posts.filter((p) => p.id !== postId) }));
  };

  const posts = searchProblem ? [] : feed.posts;

  return (
    <div className="messages-board">
      <div className="mg-layout">
        <header className="mg-heading">
          <div>
            <span className="mg-eyebrow">COMMUNITY DISCUSSION</span>
            <h1>Connects Feed</h1>
            <p>Posts from you and your skill connects — only your connects see what you share.</p>
          </div>
          <label className="mg-search">
            <Icon name="search" size={18} />
            <input
              aria-label="Search posts"
              aria-invalid={Boolean(searchProblem)}
              maxLength={SEARCH_MAX}
              placeholder="Search posts or people"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
            />
          </label>
        </header>
        {searchProblem && (
          <p className="mg-error mg-search-error" role="alert">
            {searchProblem}
          </p>
        )}

        <section className="mg-composer" aria-label="Create a post">
          <UserAvatar id={me.id} name={me.name} photoV={me.photoV} className="mg-avatar" />
          <div className="mg-composer-body">
            <textarea
              aria-label="Write a post"
              aria-invalid={Boolean(draftError)}
              maxLength={POST_MAX}
              onChange={(event) => {
                setDraft(event.target.value);
                if (draftError) setDraftError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) postMessage();
              }}
              placeholder="Share something with your connects…"
              rows="3"
              value={draft}
            />
            {draftError && (
              <p className="mg-error" role="alert">
                {draftError}
              </p>
            )}

            {images.length > 0 && (
              <div className="mg-previews" aria-label="Images to post">
                {images.map((img) => (
                  <div key={img.key} className={`mg-preview ${img.status}`}>
                    <img src={img.preview} alt="" />
                    {img.status === "uploading" && <span className="mg-preview-status">Uploading…</span>}
                    {img.status === "error" && <span className="mg-preview-status">Failed</span>}
                    <button type="button" aria-label="Remove image" onClick={() => removeImage(img)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {links.length > 0 && (
              <ul className="mg-link-chips" aria-label="Links to post">
                {links.map((href) => {
                  const { host, path } = describeLink(href);
                  return (
                    <li key={href}>
                      <Icon name="link" size={13} />
                      <span>
                        {host}
                        {path}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove link ${host}`}
                        onClick={() => setLinks((current) => current.filter((x) => x !== href))}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {linkOpen && (
              <div className="mg-link-row">
                <input
                  autoFocus
                  type="url"
                  inputMode="url"
                  maxLength={2048}
                  placeholder="Paste a link, e.g. https://example.com"
                  aria-label="Link to add"
                  aria-invalid={Boolean(linkError)}
                  value={linkInput}
                  onChange={(e) => {
                    setLinkInput(e.target.value);
                    if (linkError) setLinkError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLink();
                    }
                    if (e.key === "Escape") setLinkOpen(false);
                  }}
                />
                <button type="button" onClick={addLink} disabled={!linkInput.trim()}>
                  Add link
                </button>
              </div>
            )}
            {linkError && (
              <p className="mg-error" role="alert">
                {linkError}
              </p>
            )}
            {attachError && (
              <p className="mg-error" role="alert">
                {attachError}
              </p>
            )}

            <div className="mg-composer-footer">
              <div className="mg-tools">
                <button
                  aria-label="Add images"
                  title={`Add images (up to ${MAX_IMAGES})`}
                  type="button"
                  disabled={images.length >= MAX_IMAGES}
                  onClick={() => fileInput.current?.click()}
                >
                  <Icon name="image" size={18} />
                </button>
                <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} multiple hidden onChange={addImages} />
                <button
                  aria-label="Add a link"
                  aria-expanded={linkOpen}
                  title={`Add a link (up to ${MAX_LINKS})`}
                  type="button"
                  disabled={links.length >= MAX_LINKS}
                  onClick={() => {
                    setLinkOpen((open) => !open);
                    setLinkError("");
                  }}
                >
                  <Icon name="link" size={18} />
                </button>
                <div className="mg-emoji-wrap">
                  <button
                    aria-label="Add emoji"
                    aria-expanded={emojiOpen}
                    title="Add emoji"
                    type="button"
                    onClick={() => setEmojiOpen((open) => !open)}
                  >
                    <Icon name="smile" size={18} />
                  </button>
                  {emojiOpen && (
                    <div className="mg-emoji-menu" role="menu" aria-label="Emoji">
                      {EMOJIS.map((emoji) => (
                        <button key={emoji} type="button" role="menuitem" onClick={() => addEmoji(emoji)}>
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <span className={`mg-count ${draft.length >= POST_MAX ? "full" : ""}`}>
                {draft.length}/{POST_MAX}
              </span>
              <button className="mg-post" disabled={!canPost} onClick={postMessage} type="button" title="Post (Ctrl+Enter)">
                {posting ? "Posting…" : uploading ? "Uploading…" : "Post message"}
              </button>
            </div>
          </div>
        </section>

        <div className="mg-stream-heading">
          <h2>{q ? "Search results" : "Recent messages"}</h2>
          <label>
            <span>Sort by</span>
            <select aria-label="Sort messages" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="newest">Newest</option>
              <option value="discussed">Most discussed</option>
              <option value="liked">Most liked</option>
            </select>
          </label>
        </div>

        {actionError && (
          <p className="mg-error" role="alert">
            {actionError}
          </p>
        )}

        <div className="mg-stream">
          {feed.status === "loading" && !searchProblem && (
            <div className="mg-empty">
              <strong>Loading the board…</strong>
            </div>
          )}
          {feed.status === "error" && (
            <div className="mg-empty" role="alert">
              <strong>Couldn’t load posts</strong>
              <p>{feed.error}</p>
              <button type="button" className="mg-retry" onClick={reload}>
                Try again
              </button>
            </div>
          )}
          {feed.status === "ready" &&
            posts.map((post) => (
              <MessageCard
                key={post.id}
                me={me}
                post={post}
                onLike={like}
                onReply={reply}
                onReact={react}
                onDelete={remove}
                onOpenImage={setViewer}
              />
            ))}
          {feed.status === "ready" && posts.length === 0 && (
            <div className="mg-empty">
              <strong>{query.trim() ? "No posts match your search" : "No posts yet"}</strong>
              <p>
                {query.trim()
                  ? "Try different words. Only posts from you and your connects are searched."
                  : "You’ll see posts from your accepted connects here. Start the conversation, or add connects in Connects."}
              </p>
            </div>
          )}
        </div>
      </div>

      {viewer && (
        <div className="mg-viewer" role="dialog" aria-modal="true" aria-label="Image" onClick={() => setViewer(null)}>
          <img src={viewer} alt="" onClick={(e) => e.stopPropagation()} />
          <button type="button" aria-label="Close image" onClick={() => setViewer(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
};

export default Messages;

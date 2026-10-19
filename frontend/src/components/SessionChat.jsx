import { useEffect, useRef, useState } from "react";
import UserAvatar from "./UserAvatar";
import { CHAT_MAX, chatMessageProblem } from "../utils/chatText";

// Live Session → Chat panel, for everyone in the session. State comes from
// hooks/useSessionChat.js (held by the session room).
//   • Messages: newest at the bottom. Plain conversation only — letters,
//     numbers, emoji and normal punctuation; no code, links or files
//     (utils/chatText.js, checked as you type; the server checks again).
//   • Hover a message (or tap it on touch screens) for 😊 👍 🔥 😮 and Reply.
//   • Replies quote the original — tap the quote to jump to it.
//   • "Maya is typing…" with animated dots while others type.

const CHAT_EMOJI = [
  { key: "smile", emoji: "\u{1F60A}", label: "Smile" },
  { key: "thumbs", emoji: "\u{1F44D}", label: "Thumbs up" },
  { key: "fire", emoji: "\u{1F525}", label: "Fire" },
  { key: "wow", emoji: "\u{1F62E}", label: "Surprised" },
];
const BODY_MAX = CHAT_MAX;
const COUNTER_FROM = 400;
const GROUP_MS = 3 * 60 * 1000; // same person within 3 min → no repeated name
const TYPING_REPEAT_MS = 3000; // re-send "typing" while they keep typing
const TYPING_IDLE_MS = 4000; // stop "typing" after a pause
const NEAR_BOTTOM_PX = 80;

const timeOf = (date) =>
  new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function typingText(names) {
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return "Several people are typing";
}

function SendGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
    </svg>
  );
}

export default function SessionChat({ chat, myId, typingNames, sendTyping }) {
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null); // message being replied to
  const [activeId, setActiveId] = useState(null); // message showing its actions (touch)
  const [flashId, setFlashId] = useState(null); // message jumped to from a quote
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const typingSentAt = useRef(0);
  const idleTimer = useRef(null);
  const nearBottom = useRef(true);
  const lastCount = useRef(0);

  const { messages, status } = chat;

  // Keep the newest message in view — unless they've scrolled up to read
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const added = messages.length > lastCount.current;
    const mine = messages.at(-1)?.author.id === myId;
    if (lastCount.current === 0 || (added && (nearBottom.current || mine))) {
      list.scrollTop = list.scrollHeight;
    }
    lastCount.current = messages.length;
  }, [messages, myId]);

  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(timer);
  }, [flashId]);

  // Tell the others we stopped typing when the panel closes
  useEffect(
    () => () => {
      clearTimeout(idleTimer.current);
      if (typingSentAt.current) sendTyping(false);
    },
    [sendTyping],
  );

  const stopTyping = () => {
    clearTimeout(idleTimer.current);
    if (typingSentAt.current) {
      typingSentAt.current = 0;
      sendTyping(false);
    }
  };

  const onType = (e) => {
    const value = e.target.value;
    setText(value);
    if (error) setError("");
    // Grow with the text (up to the max height in CSS)
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
    if (!value.trim()) return stopTyping();
    if (e.timeStamp - typingSentAt.current > TYPING_REPEAT_MS) {
      typingSentAt.current = e.timeStamp || 1;
      sendTyping(true);
    }
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  // Checked as you type: the send button stays off and the reason shows
  const problem = text.trim() ? chatMessageProblem(text.trim()) : "";

  const submit = async (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    if (problem) return setError(problem);
    setSending(true);
    setError("");
    stopTyping();
    try {
      await chat.send(body, replyTo?.id);
      setText("");
      setReplyTo(null);
      if (inputRef.current) inputRef.current.style.height = "";
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const startReply = (message) => {
    setReplyTo(message);
    setActiveId(null);
    inputRef.current?.focus();
  };

  const react = (message, emoji) => {
    setActiveId(null);
    chat.react(message.id, emoji).catch((err) => setError(err.message));
  };

  const jumpTo = (id) => {
    const el = listRef.current?.querySelector(`[data-message-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(id);
  };

  return (
    <div className="session-chat">
      <div
        className="sc-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
        }}
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {status === "loading" && <p className="sc-note">Loading chat…</p>}
        {status === "error" && (
          <p className="sc-error" role="alert">
            {chat.error}{" "}
            <button type="button" className="sc-link-button" onClick={chat.retry}>
              Try again
            </button>
          </p>
        )}
        {status === "ready" && messages.length === 0 && (
          <p className="sc-empty">No messages yet. Say hello to everyone in the session 👋</p>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const mine = m.author.id === myId;
          const grouped =
            prev &&
            !m.replyTo &&
            prev.author.id === m.author.id &&
            new Date(m.createdAt) - new Date(prev.createdAt) < GROUP_MS;
          const used = CHAT_EMOJI.filter((e) => m.reactions[e.key]?.length);
          return (
            <article
              key={m.id}
              data-message-id={m.id}
              className={`sc-msg ${mine ? "is-mine" : ""} ${grouped ? "is-grouped" : ""} ${
                activeId === m.id ? "is-active" : ""
              } ${flashId === m.id ? "is-flash" : ""}`}
            >
              {!grouped && (
                <header className="sc-head">
                  {!mine && (
                    <UserAvatar id={m.author.id} name={m.author.name} photo={false} className="avatar small" />
                  )}
                  <b>{mine ? "You" : m.author.name}</b>
                  <time dateTime={m.createdAt}>{timeOf(m.createdAt)}</time>
                </header>
              )}
              <div className="sc-bubble-row">
                <div
                  className="sc-bubble"
                  tabIndex={0}
                  aria-label={`Message from ${mine ? "you" : m.author.name}. Press Enter for reactions and reply.`}
                  onClick={(e) => {
                    if (e.target.closest("a, button")) return;
                    setActiveId(activeId === m.id ? null : m.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || e.key !== "Enter") return;
                    setActiveId(activeId === m.id ? null : m.id);
                  }}
                >
                  {m.replyTo && (
                    <button
                      type="button"
                      className="sc-quote"
                      onClick={() => jumpTo(m.replyTo.id)}
                      aria-label={`Replying to ${m.replyTo.authorName || "a message"} — show it`}
                    >
                      {m.replyTo.authorName && <b>{m.replyTo.authorName}</b>}
                      <span>{m.replyTo.body}</span>
                    </button>
                  )}
                  <p>{m.body}</p>
                </div>
                <div className="sc-actions" role="group" aria-label="React or reply">
                  {CHAT_EMOJI.map((e) => (
                    <button
                      key={e.key}
                      type="button"
                      onClick={() => react(m, e.key)}
                      aria-label={e.label}
                      title={e.label}
                      aria-pressed={m.reactions[e.key]?.includes(myId) || false}
                    >
                      <span aria-hidden="true">{e.emoji}</span>
                    </button>
                  ))}
                  <button type="button" className="sc-reply" onClick={() => startReply(m)}>
                    Reply
                  </button>
                </div>
              </div>
              {used.length > 0 && (
                <div className="sc-reactions">
                  {used.map((e) => {
                    const who = m.reactions[e.key];
                    const minePressed = who.includes(myId);
                    return (
                      <button
                        key={e.key}
                        type="button"
                        className={minePressed ? "is-mine" : ""}
                        onClick={() => react(m, e.key)}
                        aria-pressed={minePressed}
                        aria-label={`${e.label}, ${who.length}${minePressed ? ", including you" : ""}`}
                      >
                        <span aria-hidden="true">{e.emoji}</span>
                        {who.length}
                      </button>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="sc-typing" aria-live="polite">
        {typingNames.length > 0 && (
          <>
            <span className="sc-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {typingText(typingNames)}
          </>
        )}
      </div>

      <form className="sc-composer" onSubmit={submit}>
        {replyTo && (
          <div className="sc-replying">
            <span>
              Replying to <b>{replyTo.author.id === myId ? "yourself" : replyTo.author.name}</b>
              <small>{replyTo.body}</small>
            </span>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
              ✕
            </button>
          </div>
        )}
        {(problem || error) && (
          <p className="sc-error" id="sc-input-problem" role="alert">
            {problem || error}
          </p>
        )}
        <div className={`sc-input ${problem ? "is-invalid" : ""}`}>
          <textarea
            ref={inputRef}
            value={text}
            onChange={onType}
            onBlur={stopTyping}
            // No files or images in chat
            onPaste={(e) => {
              if (e.clipboardData?.files?.length) {
                e.preventDefault();
                setError("Files and images can't be sent in chat — the host can add them in Notes.");
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer?.files?.length) {
                setError("Files and images can't be sent in chat — the host can add them in Notes.");
              }
            }}
            aria-invalid={Boolean(problem) || undefined}
            aria-describedby={problem || error ? "sc-input-problem" : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape" && replyTo) setReplyTo(null);
            }}
            rows={1}
            maxLength={BODY_MAX}
            enterKeyHint="send"
            placeholder={replyTo ? "Write a reply…" : "Message everyone"}
            aria-label={replyTo ? `Reply to ${replyTo.author.name}` : "Message everyone in the session"}
          />
          {text.length >= COUNTER_FROM && (
            <small className="sc-count">{BODY_MAX - text.length}</small>
          )}
          <button type="submit" disabled={!text.trim() || Boolean(problem) || sending} aria-label="Send message">
            <SendGlyph />
          </button>
        </div>
      </form>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useRealtime } from "../realtime/useRealtime";
import { requestJson } from "../utils/api";

// Live Session chat state (backend/routes/sessionChatRoute.js). Lives in the
// session room, not the panel, so the Chat button can count unread messages
// and "…is typing" keeps working while the panel is closed.
//
//   const chat = useSessionChat(roomId, { visible, myId });
//   chat.messages / status / error / retry
//   chat.send(body, replyToId) · chat.react(messageId, emoji)
//   chat.unread · chat.markSeen()
//   chat.typingIds — socket ids of people typing (fed by chat.peerTyping)

const MAX_MESSAGES = 300;
// If someone's "typing" signal stops (closed the tab mid-sentence), drop it
const TYPING_TIMEOUT_MS = 5000;

export function useSessionChat(roomId, { visible, myId }) {
  const { authFetch } = useAuth();
  const { subscribe } = useRealtime();
  const [state, setState] = useState({ status: "loading", messages: [], error: "" });
  const [version, setVersion] = useState(0);
  const [unread, setUnread] = useState(0);
  const [typingIds, setTypingIds] = useState([]);
  const visibleRef = useRef(visible);
  const myIdRef = useRef(myId);
  const typingTimers = useRef(new Map());

  useEffect(() => {
    visibleRef.current = visible;
    myIdRef.current = myId;
  }, [visible, myId]);

  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    requestJson(authFetch, `/sessionChat/${roomId}`, { signal: controller.signal })
      .then((data) => setState({ status: "ready", messages: data.messages, error: "" }))
      .catch((err) => {
        if (err.name === "AbortError") return;
        setState((s) => ({ ...s, status: s.status === "ready" ? "ready" : "error", error: err.message }));
      });
    return () => controller.abort();
  }, [authFetch, roomId, version]);

  // Add a new message, or replace one that changed (reactions)
  const upsert = useCallback((message) => {
    setState((s) => {
      const exists = s.messages.some((m) => m.id === message.id);
      const messages = exists
        ? s.messages.map((m) => (m.id === message.id ? message : m))
        : [...s.messages, message].slice(-MAX_MESSAGES);
      return { ...s, messages };
    });
  }, []);

  useEffect(() => {
    const offMessage = subscribe("sessionChat:message", (e) => {
      if (e?.roomId !== roomId || !e.message) return;
      upsert(e.message);
      if (e.message.author.id !== myIdRef.current && !visibleRef.current) setUnread((u) => u + 1);
    });
    const offUpdate = subscribe("sessionChat:update", (e) => {
      if (e?.roomId === roomId && e.message) upsert(e.message);
    });
    const offReconnect = subscribe("realtime:reconnected", () => setVersion((v) => v + 1));
    return () => {
      offMessage();
      offUpdate();
      offReconnect();
    };
  }, [subscribe, roomId, upsert]);

  // From the video room's socket: someone started/stopped typing
  const peerTyping = useCallback((id, typing) => {
    const timers = typingTimers.current;
    clearTimeout(timers.get(id));
    timers.delete(id);
    if (typing) {
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          setTypingIds((ids) => ids.filter((x) => x !== id));
        }, TYPING_TIMEOUT_MS),
      );
      setTypingIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    } else {
      setTypingIds((ids) => ids.filter((x) => x !== id));
    }
  }, []);

  useEffect(() => {
    const timers = typingTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const send = async (body, replyTo) => {
    const { message } = await requestJson(authFetch, `/sessionChat/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, replyTo: replyTo || undefined }),
    });
    upsert(message);
    return message;
  };

  // Shows straight away; the server's answer (or a reload) settles it
  const react = async (messageId, emoji) => {
    const me = myIdRef.current;
    setState((s) => ({
      ...s,
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        const who = m.reactions[emoji] || [];
        const next = who.includes(me) ? who.filter((id) => id !== me) : [...who, me];
        return { ...m, reactions: { ...m.reactions, [emoji]: next } };
      }),
    }));
    try {
      const { message } = await requestJson(authFetch, `/sessionChat/${roomId}/messages/${messageId}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
      upsert(message);
    } catch (err) {
      setVersion((v) => v + 1);
      throw err;
    }
  };

  return {
    ...state,
    unread,
    markSeen: () => setUnread(0),
    retry: () => setVersion((v) => v + 1),
    typingIds,
    peerTyping,
    send,
    react,
  };
}

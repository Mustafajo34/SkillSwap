import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useRealtime } from "../realtime/useRealtime";
import { useMemberUpdates } from "../hooks/useMemberUpdates";
import { patchMembers } from "../utils/people";
import { requestJson } from "../utils/api";
import { ConnectsContext } from "./useConnects";

// Your skill-connect network (the API calls them friends), shared by the
// whole dashboard: My Skills, Browse Skills, the sidebar badge and the Live
// Sessions invite list all read from here, so a change anywhere — or a live
// update from someone else — shows up everywhere at once.
//
//   network     { status, friends, incoming, outgoing, error }
//   statusOf    (id, fallback) → "friends" | "requested" | "incoming" | "none"
//   act         (member, kind) → sends the request; kind is
//               "connect" | "cancel" | "accept" | "decline" | "remove"
//   busy        Set of member ids with a request in flight

const EMPTY = { status: "loading", friends: [], incoming: [], outgoing: [], error: "" };
const NOTICE_MS = 6000;

function actionRequest(kind, id) {
  const userId = encodeURIComponent(id);
  switch (kind) {
    case "connect":
      return ["/friends/requests", { method: "POST", body: JSON.stringify({ userId: id }) }];
    case "cancel":
      return [`/friends/requests/${userId}`, { method: "DELETE" }];
    case "accept":
      return [`/friends/requests/${userId}/accept`, { method: "POST" }];
    case "decline":
      return [`/friends/requests/${userId}/decline`, { method: "POST" }];
    case "remove":
      return [`/friends/${userId}`, { method: "DELETE" }];
    default:
      throw new Error(`Unknown connect action: ${kind}`);
  }
}

// Toast text for something another person did (none for declines/removals)
function noticeFor({ type, by }) {
  if (!by) return null;
  if (type === "request") return { text: `${by.name} wants to connect with you`, tab: "pending" };
  if (type === "accept") return { text: `${by.name} accepted your connect request`, tab: "connects" };
  return null;
}

export default function ConnectsProvider({ children, onOpen }) {
  const { authFetch } = useAuth();
  const { subscribe } = useRealtime();
  const [network, setNetwork] = useState(EMPTY);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(() => new Set());
  const [notice, setNotice] = useState(null);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // Someone edited their profile → their card here updates live
  useMemberUpdates(
    useCallback(
      (member) =>
        setNetwork((n) => ({
          ...n,
          friends: patchMembers(n.friends, member),
          incoming: patchMembers(n.incoming, member),
          outgoing: patchMembers(n.outgoing, member),
        })),
      [],
    ),
  );

  // Load (and quietly re-load) the network. Old data stays on screen while
  // a reload is in flight, so lists don't flash.
  useEffect(() => {
    const controller = new AbortController();
    requestJson(authFetch, "/friends", { signal: controller.signal })
      .then((data) => setNetwork({ status: "ready", ...data, error: "" }))
      .catch((err) => {
        if (err.name === "AbortError") return;
        setNetwork((n) => ({ ...n, status: n.status === "ready" ? "ready" : "error", error: err.message }));
      });
    return () => controller.abort();
  }, [authFetch, version]);

  // Live updates from the server
  useEffect(() => {
    const offChange = subscribe("connects:changed", (event) => {
      reload();
      const next = noticeFor(event || {});
      if (next) setNotice({ ...next, id: Date.now() });
    });
    const offReconnect = subscribe("realtime:reconnected", reload);
    return () => {
      offChange();
      offReconnect();
    };
  }, [subscribe, reload]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const sets = useMemo(
    () => ({
      friends: new Set(network.friends.map((m) => m.id)),
      incoming: new Set(network.incoming.map((m) => m.id)),
      outgoing: new Set(network.outgoing.map((m) => m.id)),
    }),
    [network],
  );

  const statusOf = useCallback(
    (id, fallback = "none") => {
      if (network.status !== "ready") return fallback;
      if (sets.friends.has(id)) return "friends";
      if (sets.incoming.has(id)) return "incoming";
      if (sets.outgoing.has(id)) return "requested";
      return "none";
    },
    [network.status, sets],
  );

  // Throws on failure so the caller can show the message where it happened
  const act = useCallback(
    async (member, kind) => {
      const [path, options] = actionRequest(kind, member.id);
      setBusy((ids) => new Set(ids).add(member.id));
      try {
        const result = await requestJson(authFetch, path, options);
        reload();
        return result.status;
      } finally {
        setBusy((ids) => {
          const next = new Set(ids);
          next.delete(member.id);
          return next;
        });
      }
    },
    [authFetch, reload],
  );

  const value = useMemo(
    () => ({ network, statusOf, act, busy, reload }),
    [network, statusOf, act, busy, reload],
  );

  return (
    <ConnectsContext.Provider value={value}>
      {children}
      {notice && (
        <div
          key={notice.id}
          role="status"
          className="connects-toast fixed bottom-4 right-4 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-2xl shadow-black/20"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M19 8v6M22 11h-6" />
            </svg>
          </span>
          <span className="min-w-0 flex-1 font-semibold">{notice.text}</span>
          {onOpen && (
            <button
              type="button"
              onClick={() => {
                onOpen(notice.tab);
                setNotice(null);
              }}
              className="rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              View
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      )}
    </ConnectsContext.Provider>
  );
}

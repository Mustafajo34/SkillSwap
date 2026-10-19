import { useCallback, useEffect, useRef, useState } from "react";
import { authContext } from "./useAuth";
import { API_BASE } from "../utils/api";
import { IdleWarning, SignedOutNotice } from "./SessionNotices";

// create error class extend
class HttpError extends Error {
  constructor(response = {}, customMessage, data = null) {
    const message =
      customMessage || response.statusText || "unable to retrieve data";
    super(`Http Error ${response.status || 500}: ${message}`);

    this.name = "HttpError";
    this.status = response.status || 500;
    this.response = response;
    this.data = data;
  }
  static async create(response) {
    let payload = null;
    let message;

    try {
      payload = await response.json();
      // The backend uses `message` on some routes and `error` on others
      message = payload?.message || payload?.error || response.statusText;
    } catch {
      message = response?.statusText || "Unable to parse server response";
    }
    return new HttpError(response, message, payload);
  }
}

// Backend endpoints — all in one place. Matches backend/server.js (PORT=1989,
// router mounted at /auth) and backend/routes/userRoute.js. Set VITE_API_URL
// when building for production.
// API_BASE lives in utils/api.js so the Live Sessions socket can share it.
const API = {
  signUp: `${API_BASE}/auth/signup`,
  signIn: `${API_BASE}/auth/signin`,
  logOut: `${API_BASE}/auth/logout`,
  refresh: `${API_BASE}/auth/refresh`,
  // GET ?username=<name>  →  { available: boolean }
  usernameAvailable: `${API_BASE}/auth/username-available`,
};

// Result for a request cancelled through its AbortSignal. Callers should
// treat it as "nothing happened" — no error message, no state change.
const ABORTED = { ok: false, aborted: true, status: 0, message: "", fields: [] };

// Turns a caught error into a result forms can display:
// { ok: false, status, message, fields } — `fields` lists the fields the
// server says conflict (e.g. ["username"]), when it tells us.
function toFailure(error, fallbackMessage) {
  if (error?.name === "AbortError") return ABORTED;
  if (error instanceof HttpError) {
    const data = error.data || {};
    const message = data.message || data.error;
    let fields = [];
    if (data.code === 11000) {
      // Mongo duplicate key error
      fields = Object.keys(data.keyPattern || data.keyValue || {});
    } else if (data.field) {
      fields = [data.field];
    } else if (typeof message === "string" && message.includes("E11000")) {
      // Only the raw Mongo message came back, e.g.
      // "E11000 duplicate key error collection: … index: userName_1 dup key: …"
      const index = message.match(/index: (\w+?)_\d/);
      if (index) fields = [index[1]];
    }
    // The backend calls it userName; the forms call it username
    fields = fields.map((f) => (f === "userName" ? "username" : f));
    return {
      ok: false,
      status: error.status,
      message: message || "Something went wrong. Please try again.",
      fields,
    };
  }
  return { ok: false, status: 0, message: fallbackMessage, fields: [] };
}

// Resolves true/false when the server answers; throws if it can't be reached.
// Defined outside the provider so its identity is stable for effect deps.
async function checkUsername(username, signal) {
  const response = await fetch(
    `${API.usernameAvailable}?username=${encodeURIComponent(username)}`,
    { credentials: "include", signal },
  );
  if (!response.ok) {
    throw await HttpError.create(response);
  }
  const data = await response.json();
  return Boolean(data?.available);
}

// ── Silent refresh ──────────────────────────────────────────────────────────

// Refresh this long before the access token expires
const REFRESH_EARLY_MS = 60_000;
// Never schedule refreshes closer together than this (guards against loops
// if the server ever issues very short-lived tokens)
const MIN_REFRESH_DELAY_MS = 10_000;
// Name of the lock every tab shares so only one refreshes at a time
const REFRESH_LOCK = "skillswap-refresh";

// ── Bank-style session limits ───────────────────────────────────────────────
// The server sets the real limits (backend/routes/userRoute.js): 5-minute
// access tokens, single-use refresh tokens, 15 minutes idle, 8 hours at most.
// It sends the idle window with every sign-in / refresh; this is the
// fallback until it does. Here we make "idle" mean what it says: tokens are
// only renewed while someone is actually using the app.
const DEFAULT_IDLE_MS = 15 * 60_000;
// "Are you still there?" shows this long before the idle sign-out
const IDLE_WARNING_MS = 2 * 60_000;
// Last activity, shared by every open tab (activity in one counts for all)
const ACTIVITY_KEY = "skillswap-last-activity";
const ACTIVITY_WRITE_MS = 5_000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"];

const readSharedActivity = () => {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0; // storage blocked: this tab's own activity still counts
  }
};
const writeSharedActivity = (time) => {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(time));
  } catch {
    // storage blocked: fine
  }
};

// How long the access token lives, in ms, read from the JWT's own `iat`
// (issued at) and `exp` (expires) claims. Using exp − iat — both set by the
// server's clock — means a wrong clock on the user's computer can't throw
// the timing off. Not verified: it only decides *when* to refresh; the
// server does the real check. Returns null if the token can't be read.
function tokenLifetimeMs(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { iat, exp } = JSON.parse(atob(payload));
    if (Number.isFinite(iat) && Number.isFinite(exp)) return (exp - iat) * 1000;
    if (Number.isFinite(exp)) return exp * 1000 - Date.now();
  } catch {
    // Not a readable JWT — fall through
  }
  return null;
}

// Runs fn while holding a lock shared by every open tab of this site, so two
// tabs never refresh at the same moment (with refresh-token rotation, the
// second would look like a stolen, reused token). Falls back to running fn
// directly where the Web Locks API isn't available.
function withRefreshLock(fn) {
  return navigator.locks ? navigator.locks.request(REFRESH_LOCK, fn) : fn();
}

const AuthProvider = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [accessToken, setAccessToken] = useState(null);

  // Latest access token, readable immediately by authFetch (state only
  // updates on the next render). Memory only — never stored in the browser.
  const tokenRef = useRef(null);
  // The refresh currently in progress, shared by every caller
  const refreshPromiseRef = useRef(null);
  // Bumped whenever the session is cleared, so a refresh that started before
  // a logout can't bring the session back when it finishes
  const sessionVersionRef = useRef(0);
  // Session limits from the server: { idleTimeoutMs, expiresAt }
  const limitsRef = useRef({ idleTimeoutMs: DEFAULT_IDLE_MS, expiresAt: null });
  // When this tab last saw someone use the app (set on sign-in / restore)
  const lastActivityRef = useRef(0);
  const lastActivityWriteRef = useRef(0);
  // Seconds left before the idle sign-out while "Still there?" shows
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(null);
  const warningRef = useRef(false);
  // Why you were signed out, shown once afterwards
  const [notice, setNotice] = useState("");

  const applySession = useCallback((token, nextUser, limits) => {
    tokenRef.current = token;
    if (limits?.idleTimeoutMs) limitsRef.current = limits;
    setAccessToken(token);
    setUser(nextUser);
    setAuthorized(true);
    setNotice("");
  }, []);

  // Someone used the app. While "Still there?" shows, only its buttons (or
  // `force`, e.g. an ongoing video call) count — not a stray mouse move.
  const markActive = useCallback((force = false) => {
    if (warningRef.current && !force) return;
    const now = Date.now();
    lastActivityRef.current = now;
    if (now - lastActivityWriteRef.current > ACTIVITY_WRITE_MS) {
      lastActivityWriteRef.current = now;
      writeSharedActivity(now);
    }
  }, []);

  const idleForMs = useCallback(
    () => Date.now() - Math.max(lastActivityRef.current, readSharedActivity()),
    [],
  );

  const clearSession = useCallback(() => {
    sessionVersionRef.current += 1;
    tokenRef.current = null;
    setAccessToken(null);
    setUser(null);
    setAuthorized(false);
  }, []);

  const signUp = async (formData) => {
    try {
      // The backend reads `userName`, not `username`
      const { username, ...rest } = formData;
      // create fetch
      const response = await fetch(API.signUp, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ ...rest, userName: username }),
      });
      // if response is not ok
      if (!response.ok) {
        throw await HttpError.create(response);
      }
      //   parse response body
      const data = await response.json();
      // Signing up only creates the account — the user then signs in through
      // the sign-in pop-up, which is what sets the token and authorization.
      return { ok: true, data };
    } catch (error) {
      if (error.data?.code === 11000) {
        console.error("Duplicate fields error detected:", error.data);
      }
      return toFailure(error, "Network error. Please try again later.");
    }
  };
  const signIn = async (loginData, signal) => {
    try {
      const response = await fetch(API.signIn, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          userName: loginData.username,
          password: loginData.password,
        }),
        signal,
      });

      if (!response.ok) {
        throw await HttpError.create(response);
      }

      const data = await response.json();
      // Cancelled while the response was arriving — never store the token
      // or user for a sign-in the person has walked away from
      if (signal?.aborted) return ABORTED;
      if (!data?.accessToken) {
        return {
          ok: false,
          status: response.status,
          message: "Sign in failed. Please try again.",
          fields: [],
        };
      }
      markActive(true);
      applySession(data.accessToken, data.user, data.session);
      return { ok: true, data };
    } catch (error) {
      if (error.status === 500) {
        console.error("Unable to sign into server!");
      }
      return toFailure(error, "Network error please try again later!");
    }
  };
  const logOut = async () => {
    try {
      const response = await fetch(API.logOut, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
      });

      if (!response.ok) {
        throw await HttpError.create(response);
      }
      // 204 = there was no refresh cookie to clear; it has no body
      if (response.status === 204) return null;
      const data = await response.json();

      return data;
    } catch (error) {
      if (error.data?.code === 409) {
        console.error("logout state conflicts with the server's current state");
      }
      if (error instanceof HttpError) {
        console.warn(
          `Logout server warning (Status ${error.status}):`,
          error.message,
        );
      }
      return "Network error please try again later!";
    } finally {
      clearSession();
    }
  };

  // Asks the server for a new access token using the httpOnly refresh
  // cookie. Resolves to the new token, or null. If the server rejects the
  // refresh token (expired, revoked, reused) the session is cleared; on a
  // network problem the session is kept and the next request tries again.
  // Call through refreshOnce() rather than directly.
  const refresh = useCallback(
    async (signal) => {
      const version = sessionVersionRef.current;
      try {
        const response = await fetch(API.refresh, {
          method: "POST",
          credentials: "include",
          signal,
        });

        if (!response.ok) {
          throw await HttpError.create(response);
        }
        const data = await response.json();
        // Logged out while this was running — don't revive the session
        if (sessionVersionRef.current !== version) return null;
        if (data?.accessToken) {
          applySession(data.accessToken, data.user, data.session);
          return data.accessToken;
        }
        clearSession();
        return null;
      } catch (error) {
        if (error.name === "AbortError") return null;
        if (error instanceof HttpError) {
          console.error(`refreshToken error: ${error.message}`);
          // The server said no — this session is over
          if (sessionVersionRef.current === version) {
            // 403 = there was a session and it ended (not just "no cookie")
            if (error.status === 403 || tokenRef.current) {
              const { expiresAt } = limitsRef.current;
              setNotice(
                expiresAt && Date.now() >= expiresAt - 5_000
                  ? "For your security, sessions last 8 hours. Please sign in again."
                  : "Your session has ended. Please sign in again.",
              );
            }
            clearSession();
          }
        } else {
          console.error("Network or unexpected error:", error);
        }
        return null;
      }
    },
    [applySession, clearSession],
  );

  // Signed out for inactivity (also from another tab's inactivity — the
  // activity time is shared). logOut is read through a ref: it's a plain
  // function, recreated every render.
  const logOutRef = useRef(null);
  const endingRef = useRef(false);
  const endForIdle = useCallback(() => {
    if (endingRef.current) return;
    endingRef.current = true;
    const minutes = Math.round(limitsRef.current.idleTimeoutMs / 60_000);
    Promise.resolve(logOutRef.current?.()).finally(() => {
      endingRef.current = false;
      setNotice(`You were signed out after ${minutes} minutes without activity. Please sign in again.`);
    });
  }, []);

  // Every refresh goes through here: callers that ask while one is already
  // running share it instead of starting a second request. An idle session
  // is never renewed — not even by background live updates — it ends.
  const refreshOnce = useCallback(() => {
    if (tokenRef.current && idleForMs() >= limitsRef.current.idleTimeoutMs) {
      endForIdle();
      return Promise.resolve(null);
    }
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = withRefreshLock(() => refresh()).finally(
        () => {
          refreshPromiseRef.current = null;
        },
      );
    }
    return refreshPromiseRef.current;
  }, [refresh, idleForMs, endForIdle]);

  // fetch() for API routes that need a signed-in user. Adds the access token
  // and, if the server answers 401, refreshes once and retries once.
  // `options.headers` must be a plain object.
  const authFetch = useCallback(
    async (url, options = {}) => {
      const send = (token) =>
        fetch(url, {
          ...options,
          credentials: "include",
          headers: {
            ...options.headers,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

      const response = await send(tokenRef.current);
      if (response.status !== 401) return response;

      const newToken = await refreshOnce();
      // No new token: refresh() has already cleared the session if the
      // server rejected it, and ProtectedRoutes sends the user to "/"
      if (!newToken) return response;
      return send(newToken);
    },
    [refreshOnce],
  );

  // Renew the access token a minute before it expires (or halfway through
  // its life, for short-lived tokens). A new token or a logout cancels the
  // pending timer and, for a new token, schedules the next one.
  useEffect(() => {
    if (!accessToken) return;
    const lifetime = tokenLifetimeMs(accessToken);
    if (lifetime === null) return;
    const delay = Math.max(
      lifetime - REFRESH_EARLY_MS,
      lifetime / 2,
      MIN_REFRESH_DELAY_MS,
    );
    const timer = setTimeout(refreshOnce, delay);
    return () => clearTimeout(timer);
  }, [accessToken, refreshOnce]);

  // Restore the session on page load from the refresh cookie. Goes through
  // refreshOnce so React StrictMode's double mount in development shares
  // one request instead of sending two (which rotation would treat as reuse).
  useEffect(() => {
    let active = true;
    refreshOnce().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refreshOnce]);

  // While signed in: watch for activity, warn 2 minutes before the idle
  // sign-out, and sign out at the limit. Checked every second (cheap — it
  // only re-renders while the countdown shows) and when a tab comes back.
  useEffect(() => {
    // Signed out: the warning isn't rendered (it needs `authorized`), and
    // the first tick after the next sign-in resets the countdown
    if (!authorized) return;
    markActive(true); // signing in / reopening the page is activity
    const tick = () => {
      const left = limitsRef.current.idleTimeoutMs - idleForMs();
      if (left <= 0) {
        endForIdle();
        return;
      }
      const warn = left <= IDLE_WARNING_MS;
      warningRef.current = warn;
      setIdleSecondsLeft(warn ? Math.ceil(left / 1000) : null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    const onActivity = () => markActive();
    const listen = { capture: true, passive: true };
    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, onActivity, listen));
    document.addEventListener("visibilitychange", tick);
    return () => {
      warningRef.current = false;
      clearInterval(timer);
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, onActivity, listen));
      document.removeEventListener("visibilitychange", tick);
    };
  }, [authorized, markActive, idleForMs, endForIdle]);

  const staySignedIn = () => {
    warningRef.current = false;
    setIdleSecondsLeft(null);
    markActive(true);
  };

  // For activity the page can't see as clicks/keys — e.g. sitting in a live
  // video call (components/LiveSession.jsx reports it every minute)
  const reportActivity = useCallback(() => markActive(true), [markActive]);

  const updateUser = (updates) => {
    setUser((prev) => ({ ...prev, ...updates }));
  };
  useEffect(() => {
    logOutRef.current = logOut;
  });

  return (
    <authContext.Provider
      value={{
        authorized,
        accessToken,
        user,
        loading,
        signIn,
        signUp,
        logOut,
        refresh: refreshOnce,
        authFetch,
        checkUsername,
        updateUser,
        reportActivity,
      }}
    >
      {children}
      {authorized && idleSecondsLeft !== null && (
        <IdleWarning secondsLeft={idleSecondsLeft} onStay={staySignedIn} onSignOut={logOut} />
      )}
      {notice && !authorized && <SignedOutNotice message={notice} onClose={() => setNotice("")} />}
    </authContext.Provider>
  );
};

export default AuthProvider;

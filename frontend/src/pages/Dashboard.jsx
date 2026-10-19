import { useState, useRef, useEffect, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import "../css/Dashboard.css";
import TabErrorBoundary from "../components/TabErrorBoundary";
import { lazyWithRetry } from "../utils/lazyTabs";
import { requestJson } from "../utils/api";
import { useRealtime } from "../realtime/useRealtime";
import { useMemberUpdates } from "../hooks/useMemberUpdates";
import { patchMember } from "../utils/people";
import { ThemeContext } from "../theme/useTheme";
import { readDarkMode, storeDarkMode } from "../theme/storedTheme";
import RealtimeProvider from "../realtime/RealtimeProvider";
import ConnectsProvider from "../connects/ConnectsProvider";
import NotificationsProvider from "../notifications/NotificationsProvider";
import NotificationBell from "../notifications/NotificationBell";
import IncomingCallAlert from "../notifications/IncomingCallAlert";
import { useConnects } from "../connects/useConnects";
import { useSwapCount } from "../swaps/useSwapCount";
import UserAvatar from "../components/UserAvatar";
import Copyright from "../components/Copyright";

// Each tab is its own file, loaded the first time it's needed (keeps the
// first download small). They're also fetched quietly once the dashboard is
// idle, so switching tabs stays instant. A failed download retries, and a
// tab that still can't load (or crashes) shows an error in that tab only —
// see utils/lazyTabs.js and components/TabErrorBoundary.jsx.
const TAB_LOADERS = {
  live: () => import("../components/LiveSession"),
  browse: () => import("../components/BrowseSkill"),
  myskills: () => import("../components/MySkills"),
  messages: () => import("../components/Messages"),
  swaps: () => import("../components/SwapRequests"),
};
const makeTabs = () =>
  Object.fromEntries(
    Object.entries(TAB_LOADERS).map(([id, load]) => [id, lazyWithRetry(load)]),
  );

function TabLoading() {
  return (
    <div
      role="status"
      className="flex h-full min-h-[50vh] items-center justify-center gap-3 text-sm"
      style={{ color: "var(--muted-foreground)" }}
    >
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--primary)]"
        aria-hidden="true"
      />
      Loading…
    </div>
  );
}

// ── Icons (inline SVG to avoid deps) ──────────────────────────────────────────

const IconLive = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="12" r="4" />
    <path
      d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 100-16 8 8 0 000 16z"
      opacity="0.3"
    />
  </svg>
);
const IconBrowse = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);
const IconMySkills = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);
const IconSwap = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 16V4m0 0L3 8m4-4l4 4" />
    <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
  </svg>
);
const IconMessages = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const IconHome = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);
const IconMenu = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);
const IconClose = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconSun = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);
const IconMoon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);
const IconUser = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const IconLogout = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);
const IconTrending = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);
const IconChevronDown = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// ── Logo ──────────────────────────────────────────────────────────────────────

const Logo = ({ collapsed = false }) => (
  <div className="flex items-center gap-2.5 select-none">
    <div className="relative flex-shrink-0 w-9 h-9 rounded-lg gold-gradient flex items-center justify-center shadow-lg">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2L8 8H4l4 4-2 6 6-3 6 3-2-6 4-4h-4L12 2z"
          fill="#0c0c0c"
          opacity="0.9"
        />
        <path d="M8 12 Q12 8 16 12 Q12 16 8 12Z" fill="#0c0c0c" opacity="0.5" />
      </svg>
    </div>
    {!collapsed && (
      <div className="flex flex-col leading-none">
        <span
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: "1.15rem",
            color: "var(--foreground)",
            letterSpacing: "-0.01em",
          }}
        >
          Skill<span style={{ color: "var(--primary)" }}>Swap</span>
        </span>
        <span
          style={{
            fontSize: "0.6rem",
            color: "var(--muted-foreground)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFamily: "'DM Mono', monospace",
          }}
        >
          Exchange · Grow
        </span>
      </div>
    )}
  </div>
);

// ── Nav items ─────────────────────────────────────────────────────────────────

const navItems = [
  { id: "home", label: "Home", icon: <IconHome /> },
  {
    id: "live",
    label: "Live Sessions",
    icon: <IconLive />,
    badge: "LIVE",
    isLive: true,
  },
  { id: "browse", label: "Browse Skills", icon: <IconBrowse /> },
  { id: "swaps", label: "Swap Requests", icon: <IconSwap /> },
  { id: "myskills", label: "Connects", icon: <IconMySkills /> },
  { id: "messages", label: "Connects Feed", icon: <IconMessages /> },
];

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ active, setActive, collapsed, onClose, profile }) {
  // Requests waiting for you, live from the shared connects store
  const pending = useConnects()?.network.incoming.length || 0;
  // Swap requests waiting for you (live)
  const swapsWaiting = useSwapCount();
  const card = useMyCard(profile.id);
  const counted = { myskills: pending, swaps: swapsWaiting };
  const badgeFor = (item) =>
    item.id in counted ? (counted[item.id] > 0 ? String(counted[item.id]) : null) : item.badge;
  return (
    <aside
      style={{
        background: "var(--card)",
        borderRight: "1px solid var(--border)",
      }}
      className={`flex flex-col h-full transition-all duration-300 ${collapsed ? "w-16" : "w-60"}`}
    >
      {/* Logo area */}
      <div
        className="flex items-center justify-between px-4 py-4 border-b"
        style={{ borderColor: "var(--border)", minHeight: 64 }}
      >
        <Logo collapsed={collapsed} />
        {onClose && (
          <button
            onClick={onClose}
            style={{ color: "var(--muted-foreground)" }}
            className="hover:opacity-70 transition-opacity ml-auto"
          >
            <IconClose />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setActive(item.id);
              onClose?.();
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group relative ${
              active === item.id
                ? "gold-gradient text-black shadow-md"
                : "hover:bg-[var(--muted)]"
            }`}
            style={
              active !== item.id ? { color: "var(--secondary-foreground)" } : {}
            }
            title={collapsed ? item.label : undefined}
          >
            <span
              className={`flex-shrink-0 ${item.isLive && active !== item.id ? "text-red-500" : ""}`}
            >
              {item.icon}
            </span>
            {!collapsed && (
              <>
                <span className="flex-1 text-left truncate">{item.label}</span>
                {badgeFor(item) && (
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                      item.isLive
                        ? active === item.id
                          ? "bg-black/20 text-black"
                          : "bg-red-500 text-white live-pulse"
                        : active === item.id
                          ? "bg-black/20 text-black"
                          : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                    }`}
                    style={{ fontSize: "0.6rem", letterSpacing: "0.05em" }}
                  >
                    {badgeFor(item)}
                  </span>
                )}
              </>
            )}
            {collapsed && badgeFor(item) && (
              <span
                className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${item.isLive ? "bg-red-500 live-pulse" : "bg-[var(--primary)]"}`}
              />
            )}
          </button>
        ))}
      </nav>

      {/* User quick card */}
      {!collapsed && (
        <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
          <div
            className="flex items-center gap-3 p-2 rounded-lg"
            style={{ background: "var(--muted)" }}
          >
            <UserAvatar
              id={profile.id}
              name={profile.name}
              photoV={profile.photoV}
              className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden text-xs font-bold text-black"
            />
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-semibold truncate"
                style={{ color: "var(--foreground)" }}
              >
                {profile.name}
              </p>
              <p
                className="text-xs truncate"
                style={{ color: "var(--muted-foreground)" }}
              >
                {card
                  ? `${card.rating != null ? `⭐ ${card.rating.toFixed(1)} · ` : ""}${plural(card.swaps, "swap")}`
                  : " "}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Copyright */}
      {!collapsed && (
        <Copyright
          className="block px-4 pb-3 text-center leading-snug"
          style={{ color: "var(--muted-foreground)", fontSize: "0.65rem" }}
        />
      )}
    </aside>
  );
}

// ── Logout Modal ──────────────────────────────────────────────────────────────

function LogoutModal({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div
        className="relative w-full max-w-sm rounded-2xl p-8 shadow-2xl"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex flex-col items-center text-center gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: "var(--muted)" }}
          >
            <IconLogout />
          </div>
          <div>
            <h2
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: "1.4rem",
                color: "var(--foreground)",
              }}
            >
              Log out?
            </h2>
            <p
              className="mt-2 text-sm"
              style={{ color: "var(--muted-foreground)" }}
            >
              You'll need to sign in again to access your dashboard and active
              swap sessions.
            </p>
          </div>
          <div className="flex gap-3 w-full mt-2">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all hover:opacity-80"
              style={{
                background: "var(--muted)",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
              }}
            >
              No, stay
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
              style={{
                background: "var(--primary)",
                color: "var(--primary-foreground)",
              }}
            >
              Yes, log out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────

function Navbar({
  darkMode,
  toggleDark,
  onMenuClick,
  onLogoutClick,
  profile,
  onJoinSession,
  onOpenConnects,
  onOpenSwaps,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header
      className="flex items-center justify-between px-4 md:px-6 sticky top-0 z-30"
      style={{
        background: "var(--card)",
        borderBottom: "1px solid var(--border)",
        height: 64,
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Left: hamburger (mobile) + logo (mobile) */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="md:hidden p-2 rounded-lg transition-colors hover:bg-[var(--muted)]"
          style={{ color: "var(--foreground)" }}
        >
          <IconMenu />
        </button>
        <div className="md:hidden">
          <Logo />
        </div>
      </div>

      {/* Center: search (hidden on mobile) */}
      <div className="hidden md:flex flex-1 max-w-md mx-8">
        <div className="relative w-full">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--muted-foreground)" }}
          >
            <IconBrowse />
          </span>
          <input
            type="text"
            placeholder="Search skills, people, topics…"
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none transition-all"
            style={{
              background: "var(--muted)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
              fontFamily: "'Outfit', sans-serif",
            }}
            onFocus={(e) => (e.target.style.borderColor = "var(--primary)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
          />
        </div>
      </div>

      {/* Right: bell + avatar + menu */}
      <div className="flex items-center gap-2">
        <NotificationBell
          onJoinSession={onJoinSession}
          onOpenConnects={onOpenConnects}
          onOpenSwaps={onOpenSwaps}
        />

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl transition-all hover:bg-[var(--muted)]"
            style={{ border: "1px solid var(--border)" }}
          >
            <UserAvatar
              id={profile.id}
              name={profile.name}
              photoV={profile.photoV}
              className="w-7 h-7 rounded-full flex items-center justify-center overflow-hidden text-xs font-bold text-black flex-shrink-0"
            />
            <span
              className="hidden sm:block text-sm font-medium"
              style={{ color: "var(--foreground)" }}
            >
              {profile.firstName}
            </span>
            <span style={{ color: "var(--muted-foreground)" }}>
              <IconChevronDown />
            </span>
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 mt-2 w-56 rounded-xl shadow-2xl overflow-hidden z-50"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
              }}
            >
              {/* User info */}
              <div
                className="px-4 py-3 border-b"
                style={{ borderColor: "var(--border)" }}
              >
                <p
                  className="text-sm font-semibold"
                  style={{ color: "var(--foreground)" }}
                >
                  {profile.name}
                </p>
                <p
                  className="text-xs"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {profile.email}
                </p>
              </div>

              {/* Dark/Light toggle */}
              <div
                className="px-4 py-2.5 border-b"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between">
                  <div
                    className="flex items-center gap-2 text-sm"
                    style={{ color: "var(--foreground)" }}
                  >
                    {darkMode ? <IconMoon /> : <IconSun />}
                    <span>{darkMode ? "Dark mode" : "Light mode"}</span>
                  </div>
                  <button
                    onClick={toggleDark}
                    className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
                    style={{
                      background: darkMode ? "var(--primary)" : "var(--muted)",
                    }}
                  >
                    <span
                      className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-300"
                      style={{ left: darkMode ? "1.25rem" : "0.125rem" }}
                    />
                  </button>
                </div>
              </div>

              {/* Edit Profile */}
              <button
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-[var(--muted)]"
                style={{ color: "var(--foreground)" }}
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/profile");
                }}
              >
                <IconUser />
                Edit Profile
              </button>

              {/* Logout */}
              <button
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-[var(--muted)]"
                style={{ color: "#ef4444" }}
                onClick={() => {
                  setMenuOpen(false);
                  onLogoutClick();
                }}
              >
                <IconLogout />
                Log Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ── Home data ─────────────────────────────────────────────────────────────────

// Your member card (swap count, rating, reviews) — the same view other
// members see. New ratings (swaps or Live Sessions) arrive live as
// member:updated; it also re-reads when a swap changes and after
// reconnecting.
function useMyCard(id) {
  const { authFetch } = useAuth();
  const { subscribe } = useRealtime();
  const [card, setCard] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    requestJson(authFetch, `/members/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((data) => setCard(data.member))
      .catch(() => {}); // the stats just stay as they were
    return () => controller.abort();
  }, [authFetch, id, version]);

  useMemberUpdates((member) => setCard((c) => patchMember(c, member)));

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offChange = subscribe("swaps:changed", bump);
    const offReconnect = subscribe("realtime:reconnected", bump);
    return () => {
      offChange();
      offReconnect();
    };
  }, [subscribe]);

  return card;
}

// Everything else on Home: your swaps (+ counts), people to swap with and
// trending skills. Each part keeps its last good value if a reload fails,
// so one broken request doesn't blank the whole page.
function useHomeData() {
  const { authFetch } = useAuth();
  const { subscribe } = useRealtime();
  const [data, setData] = useState({
    status: "loading",
    swaps: [],
    counts: { incoming: 0, active: 0 },
    matches: [],
    trending: [],
    trendingDays: 30,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const get = (path) =>
      requestJson(authFetch, path, { signal: controller.signal }).catch((err) => {
        if (err.name === "AbortError") throw err;
        return null;
      });
    Promise.all([get("/swaps"), get("/swaps/matches"), get("/swaps/trending")])
      .then(([list, found, trend]) =>
        setData((d) => ({
          status: list ? "ready" : d.status === "ready" ? "ready" : "error",
          swaps: list?.swaps ?? d.swaps,
          counts: list?.counts ?? d.counts,
          matches: found?.matches ?? d.matches,
          trending: trend?.skills ?? d.trending,
          trendingDays: trend?.days ?? d.trendingDays,
        })),
      )
      .catch(() => {}); // aborted
    return () => controller.abort();
  }, [authFetch, version]);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offChange = subscribe("swaps:changed", bump);
    const offReconnect = subscribe("realtime:reconnected", bump);
    return () => {
      offChange();
      offReconnect();
    };
  }, [subscribe]);

  return data;
}

const plural = (n, word, suffix = "s") => `${n} ${word}${n === 1 ? "" : suffix}`;

const shortDate = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "—";

// Swaps you finished in the current calendar month
function completedThisMonth(swaps) {
  const now = new Date();
  return swaps.filter((s) => {
    if (s.status !== "completed" || !s.completedAt) return false;
    const done = new Date(s.completedAt);
    return done.getFullYear() === now.getFullYear() && done.getMonth() === now.getMonth();
  }).length;
}

// The four stat tiles, from your profile, swaps and member card
function buildStats({ skills, swaps, counts, card, loading }) {
  const skillNames = skills.map((s) => s.name);
  const thisMonth = completedThisMonth(swaps);
  const blank = loading ? "—" : null;
  return [
    {
      label: "Skills Offered",
      value: String(skills.length),
      delta: skills.length
        ? skillNames.slice(0, 2).join(", ") + (skills.length > 2 ? ` +${skills.length - 2}` : "")
        : "Add skills in Edit Profile",
      up: false,
    },
    {
      label: "Active Swaps",
      value: blank ?? String(counts.active),
      delta: counts.incoming ? `${counts.incoming} waiting for your reply` : "None waiting on you",
      up: counts.incoming > 0,
    },
    {
      label: "Completed Swaps",
      value: card ? String(card.swaps) : "—",
      delta: thisMonth ? `+${thisMonth} this month` : "None yet this month",
      up: thisMonth > 0,
    },
    {
      label: "Your Rating",
      value: card?.rating != null ? `★ ${card.rating.toFixed(1)}` : "—",
      delta: card?.reviews ? plural(card.reviews, "review") : "No reviews yet",
      up: Boolean(card?.reviews),
    },
  ];
}

// Swap status → label + chip colours ("accepted" is shown as active)
const SWAP_STATUS = {
  pending: { label: "pending", style: { background: "var(--muted)", color: "var(--muted-foreground)" } },
  accepted: { label: "active", style: { background: "rgba(201,162,39,0.15)", color: "var(--primary)" } },
  completed: { label: "completed", style: { background: "rgba(34,197,94,0.1)", color: "#22c55e" } },
  declined: { label: "declined", style: { background: "rgba(239,68,68,0.1)", color: "#ef4444" } },
  cancelled: { label: "cancelled", style: { background: "var(--muted)", color: "var(--muted-foreground)" } },
};

const RECENT_SWAPS = 5;
const MATCHES_SHOWN = 4;

// Card header shared by the Home panels
function PanelHeader({ icon, title, children }) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-5 py-4 border-b"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-2">
        {icon}
        <h2
          className="font-semibold text-sm uppercase tracking-wider"
          style={{ color: "var(--foreground)", fontFamily: "'DM Mono', monospace" }}
        >
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

function EmptyNote({ title, children }) {
  return (
    <div className="px-5 py-8 text-center">
      <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
        {title}
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>
        {children}
      </p>
    </div>
  );
}

// ── Main Dashboard Content ────────────────────────────────────────────────────

function DashboardContent({ profile, onStartSession, onOpenSwaps }) {
  const home = useHomeData();
  const card = useMyCard(profile.id);
  const loading = home.status === "loading";
  const { counts } = home;
  const stats = buildStats({
    skills: profile.skills,
    swaps: home.swaps,
    counts,
    card,
    loading,
  });
  const recentSwaps = home.swaps.slice(0, RECENT_SWAPS);
  const matches = home.matches.slice(0, MATCHES_SHOWN);

  const summary = loading
    ? "Loading your swaps…"
    : [
        counts.incoming
          ? `${plural(counts.incoming, "swap request")} waiting for you`
          : "No new swap requests",
        counts.active ? `${plural(counts.active, "active swap")}` : null,
        home.matches.length ? `${plural(home.matches.length, "new match", "es")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Welcome banner */}
      <div
        className="relative rounded-2xl overflow-hidden p-6 md:p-8"
        style={{
          background:
            "linear-gradient(135deg, #1a1400 0%, #2a1f00 50%, #1a1400 100%)",
          border: "1px solid #3a2f00",
        }}
      >
        <div className="absolute inset-0 shimmer pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p
              className="text-sm font-medium"
              style={{
                color: "var(--primary)",
                fontFamily: "'DM Mono', monospace",
                letterSpacing: "0.05em",
              }}
            >
              WELCOME BACK
            </p>
            <h1
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: "clamp(1.5rem, 4vw, 2.2rem)",
                color: "#f5f5f0",
                lineHeight: 1.2,
                marginTop: 4,
              }}
            >
              Ready to swap skills today,
              <br />
              {profile.firstName}?
            </h1>
            <p className="mt-2 text-sm" style={{ color: "#888880" }}>
              {summary}
            </p>
          </div>
          {/* Opens Live Sessions, which starts a new video session (you host) */}
          <button
            type="button"
            onClick={onStartSession}
            className="flex-shrink-0 px-6 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90 hover:scale-105 active:scale-100"
            style={{
              background: "var(--primary)",
              color: "var(--primary-foreground)",
            }}
          >
            Start a Session
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl p-4 md:p-5"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
            }}
          >
            <p
              className="text-xs font-medium uppercase tracking-wider mb-2"
              style={{
                color: "var(--muted-foreground)",
                fontFamily: "'DM Mono', monospace",
              }}
            >
              {s.label}
            </p>
            <p
              style={{
                fontSize: "clamp(1.6rem, 4vw, 2rem)",
                fontWeight: 700,
                color: "var(--foreground)",
                lineHeight: 1,
              }}
            >
              {s.value}
            </p>
            <p
              className="text-xs mt-1.5 font-medium truncate"
              style={{
                color: s.up ? "var(--primary)" : "var(--muted-foreground)",
              }}
              title={s.delta}
            >
              {s.delta}
            </p>
          </div>
        ))}
      </div>

      {/* Swap matches + trending */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* People to swap with (GET /swaps/matches) */}
        <div
          className="lg:col-span-2 rounded-xl overflow-hidden"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <PanelHeader
            title="Swap Matches"
            icon={
              <span style={{ color: "var(--primary)" }}>
                <IconSwap />
              </span>
            }
          >
            {home.matches.length > 0 && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{
                  background: "rgba(201,162,39,0.15)",
                  color: "var(--primary)",
                  fontFamily: "'DM Mono', monospace",
                }}
              >
                {plural(home.matches.length, "match", "es")}
              </span>
            )}
          </PanelHeader>
          {matches.length ? (
            <div className="divide-y divide-[var(--border)]">
              {matches.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={onOpenSwaps}
                  className="w-full text-left flex items-center gap-4 px-5 py-4 hover:bg-[var(--muted)] transition-colors group"
                >
                  <UserAvatar
                    id={m.id}
                    name={m.name}
                    photoV={m.photoV}
                    className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden text-xs font-bold text-black"
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className="font-semibold text-sm truncate"
                      style={{ color: "var(--foreground)" }}
                    >
                      {m.name}
                    </p>
                    <p
                      className="text-xs truncate mt-0.5"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      Teaches {m.teachesYou.slice(0, 2).join(", ")}
                      {m.learnsFromYou.length > 0 &&
                        ` · wants your ${m.learnsFromYou.slice(0, 2).join(", ")}`}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: "var(--muted)",
                        color: "var(--muted-foreground)",
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      {m.learnsFromYou.length ? "Two-way" : "One-way"}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      {m.rating != null ? `★ ${m.rating.toFixed(1)} · ` : ""}
                      {plural(m.swaps, "swap")}
                    </span>
                  </div>
                  <span
                    className="hidden group-hover:flex px-3 py-1.5 rounded-lg text-xs font-semibold items-center gap-1"
                    style={{
                      background: "var(--primary)",
                      color: "var(--primary-foreground)",
                    }}
                  >
                    Swap
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyNote title={loading ? "Finding matches…" : "No new matches right now"}>
              {loading
                ? "Looking for people who teach what you don't."
                : profile.skills.length
                  ? "Everyone who fits already has an open swap with you — check back soon."
                  : "Add skills to your profile so we can match you with people to swap with."}
            </EmptyNote>
          )}
        </div>

        {/* Trending skills (GET /swaps/trending) */}
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <PanelHeader
            title="Trending"
            icon={
              <span style={{ color: "var(--primary)" }}>
                <IconTrending />
              </span>
            }
          >
            <span
              className="text-xs"
              style={{ color: "var(--muted-foreground)", fontFamily: "'DM Mono', monospace" }}
            >
              {home.trendingDays} days
            </span>
          </PanelHeader>
          {home.trending.length ? (
            <div className="p-4 space-y-3">
              {home.trending.map((t, i) => (
                <div key={t.name} className="flex items-center gap-3">
                  <span
                    className="w-5 text-xs font-bold text-right flex-shrink-0"
                    style={{
                      color: i < 3 ? "var(--primary)" : "var(--muted-foreground)",
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-medium truncate"
                      style={{ color: "var(--foreground)" }}
                    >
                      {t.name}
                    </p>
                    <p
                      className="text-xs"
                      style={{
                        color: "var(--muted-foreground)",
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      {plural(t.swaps, "swap")} · {plural(t.teachers, "teacher")}
                    </p>
                  </div>
                  {(t.growth != null || t.swaps > 0) && (
                    <span
                      className="text-xs font-semibold flex-shrink-0"
                      style={{
                        color:
                          t.growth != null && t.growth < 0 ? "var(--muted-foreground)" : "var(--primary)",
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      {t.growth == null ? "new" : `${t.growth > 0 ? "+" : ""}${t.growth}%`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyNote title={loading ? "Loading…" : "Nothing trending yet"}>
              {loading ? "" : "Skills show up here as members list and swap them."}
            </EmptyNote>
          )}
        </div>
      </div>

      {/* Recent swaps (GET /swaps, newest activity first) */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <PanelHeader title="Recent Swaps">
          <button
            type="button"
            onClick={onOpenSwaps}
            className="text-xs font-medium hover:opacity-70 transition-opacity"
            style={{ color: "var(--primary)" }}
          >
            View all →
          </button>
        </PanelHeader>
        {recentSwaps.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Partner", "You Teach", "You Learn", "Updated", "Status"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider"
                        style={{
                          color: "var(--muted-foreground)",
                          fontFamily: "'DM Mono', monospace",
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {recentSwaps.map((s) => {
                  const status = SWAP_STATUS[s.status] || SWAP_STATUS.pending;
                  return (
                    <tr
                      key={s.id}
                      onClick={onOpenSwaps}
                      className="hover:bg-[var(--muted)] transition-colors cursor-pointer"
                    >
                      <td
                        className="px-5 py-3.5 font-medium"
                        style={{ color: "var(--foreground)" }}
                      >
                        {s.other.name}
                      </td>
                      <td
                        className="px-5 py-3.5"
                        style={{ color: "var(--secondary-foreground)" }}
                      >
                        {s.youTeach}
                      </td>
                      <td
                        className="px-5 py-3.5"
                        style={{ color: "var(--secondary-foreground)" }}
                      >
                        {s.theyTeach}
                      </td>
                      <td
                        className="px-5 py-3.5"
                        style={{
                          color: "var(--muted-foreground)",
                          fontFamily: "'DM Mono', monospace",
                          fontSize: "0.75rem",
                        }}
                      >
                        {shortDate(s.updatedAt)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className="px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
                          style={status.style}
                        >
                          {s.status === "pending" && s.direction === "received"
                            ? "needs reply"
                            : status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyNote
            title={
              loading
                ? "Loading your swaps…"
                : home.status === "error"
                  ? "Couldn't load your swaps"
                  : "No swaps yet"
            }
          >
            {loading
              ? ""
              : home.status === "error"
                ? "Check your connection — this updates by itself once it's back."
                : "Pick someone from Swap Matches to propose your first swap."}
          </EmptyNote>
        )}
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────

// Builds display fields from the auth user (the backend's User.toPublic()
// shape). Adjust here only if that shape changes.
function toProfile(user) {
  const name =
    user?.name ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.userName ||
    "SkillSwap Member";
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return {
    name,
    firstName: name.split(/\s+/)[0],
    email: user?.email || "",
    initials,
    id: user?.id,
    photoV: user?.photoV || null,
    skills: user?.skills || [],
  };
}

const Dashboard = () => {
  const { user, logOut } = useAuth();
  const navigate = useNavigate();
  const profile = toProfile(user);

  // Remembered, so Edit Profile (a separate page) opens in the same theme
  const [darkMode, setDarkMode] = useState(readDarkMode);
  const [searchParams, setSearchParams] = useSearchParams();
  // A session (?room=…) or invite link (?invite=…) opens Live Sessions
  const [activeNav, setActiveNav] = useState(() =>
    searchParams.has("room") || searchParams.has("invite") ? "live" : "home",
  );

  // In a video call with someone? Then Live Sessions stays mounted (just
  // hidden) while you look at other tabs — only Leave or closing the
  // browser ends the call.
  const [liveInCall, setLiveInCall] = useState(false);

  // Leaving Live Sessions also drops the session/invite link from the URL
  // (unless a call is still running in the background)
  const clearSessionParams = () =>
    setSearchParams(
      (params) => {
        params.delete("room");
        params.delete("invite");
        return params;
      },
      { replace: true },
    );
  const changeNav = (id) => {
    setActiveNav(id);
    if (
      id !== "live" &&
      !liveInCall &&
      (searchParams.has("room") || searchParams.has("invite"))
    ) {
      clearSessionParams();
    }
  };
  // The background call ended (everyone else left): drop the session link
  useEffect(() => {
    if (liveInCall || activeNav === "live") return;
    if (searchParams.has("room") || searchParams.has("invite")) clearSessionParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveInCall]);

  // Accepting a live session invite: open Live Sessions in that room
  const joinSession = (roomId) => {
    setSearchParams((params) => {
      params.delete("invite");
      params.set("room", roomId);
      return params;
    });
    setActiveNav("live");
  };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  // Which Skills Connect tab to open (bumping n reopens it fresh — e.g. from
  // a toast, or a sidebar click, which always lands on Find connects)
  const [connectsView, setConnectsView] = useState({ tab: "find", n: 0 });
  const openConnects = (tab = "find") => {
    setConnectsView((view) => ({ tab, n: view.n + 1 }));
    changeNav("myskills");
  };

  // Sidebar: clicking Skills Connect (even when already open) shows Find connects
  const selectNav = (id) => (id === "myskills" ? openConnects("find") : changeNav(id));

  // The tab components. "Try again" after a failed load swaps in a fresh one
  // (React keeps a failed lazy load failed, so the old one can't retry).
  const [tabs, setTabs] = useState(makeTabs);
  const retryTab = (id) =>
    TAB_LOADERS[id] &&
    setTabs((current) => ({ ...current, [id]: lazyWithRetry(TAB_LOADERS[id]) }));
  const {
    live: LiveSession,
    browse: BrowseSkill,
    myskills: MySkills,
    messages: Messages,
    swaps: SwapRequests,
  } = tabs;

  // Fetch the other tabs in the background once the dashboard has settled
  useEffect(() => {
    const preload = () =>
      Object.values(TAB_LOADERS).forEach((load) => load().catch(() => {}));
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(preload, 2000);
    return () => clearTimeout(timer);
  }, []);

  const toggleDark = () => {
    setDarkMode(!darkMode);
    storeDarkMode(!darkMode);
  };

  const handleLogout = async () => {
    setLogoutModalOpen(false);
    await logOut();
    navigate("/", { replace: true });
  };

  return (
    <ThemeContext.Provider value={{ darkMode }}>
      <div
        className={`dashboard ${darkMode ? "" : "light"}`}
        style={{
          height: "100dvh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Live updates + your skill connects, shared by every tab */}
        <RealtimeProvider>
          <ConnectsProvider onOpen={openConnects}>
          <NotificationsProvider>
            {/* Rings when someone invites you to a video chat */}
            <IncomingCallAlert onJoin={joinSession} />
            {/* Navbar */}
            <Navbar
              darkMode={darkMode}
              toggleDark={toggleDark}
              onMenuClick={() => setSidebarOpen(true)}
              onLogoutClick={() => setLogoutModalOpen(true)}
              profile={profile}
              onJoinSession={joinSession}
              onOpenConnects={openConnects}
              onOpenSwaps={() => changeNav("swaps")}
            />

            <div className="flex flex-1 overflow-hidden">
              {/* Desktop sidebar */}
              <div className="hidden md:block flex-shrink-0">
                <div style={{ height: "100%" }}>
                  <Sidebar
                    active={activeNav}
                    setActive={selectNav}
                    collapsed={false}
                    profile={profile}
                  />
                </div>
              </div>

              {/* Mobile sidebar overlay */}
              {sidebarOpen && (
                <div className="md:hidden fixed inset-0 z-40 flex">
                  <div
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    onClick={() => setSidebarOpen(false)}
                  />
                  <div className="relative z-10 h-full" style={{ width: 240 }}>
                    <Sidebar
                      active={activeNav}
                      setActive={selectNav}
                      collapsed={false}
                      onClose={() => setSidebarOpen(false)}
                      profile={profile}
                    />
                  </div>
                </div>
              )}

              {/* Main content */}
              <main className="flex-1 overflow-y-auto">
                {/* Live Sessions stays mounted during a call, hidden while
                    another tab is open, so the call keeps going */}
                {(activeNav === "live" || liveInCall) && (
                  <div style={{ display: activeNav === "live" ? "contents" : "none" }}>
                    <TabErrorBoundary onRetry={() => retryTab("live")}>
                      <Suspense fallback={<TabLoading />}>
                        <LiveSession onCallChange={setLiveInCall} />
                      </Suspense>
                    </TabErrorBoundary>
                  </div>
                )}
                {/* One boundary per tab: switching tabs clears an error */}
                {activeNav !== "live" && (
                <TabErrorBoundary key={activeNav} onRetry={() => retryTab(activeNav)}>
                <Suspense fallback={<TabLoading />}>
                {activeNav === "browse" ? (
                  <BrowseSkill />
                ) : activeNav === "messages" ? (
                  <Messages />
                ) : activeNav === "swaps" ? (
                  <SwapRequests />
                ) : activeNav === "myskills" ? (
                  <MySkills
                      key={connectsView.n}
                      initialTab={connectsView.tab}
                    />
                ) : (
                  <DashboardContent
                    profile={profile}
                    onStartSession={() => changeNav("live")}
                    onOpenSwaps={() => changeNav("swaps")}
                  />
                )}
                </Suspense>
                </TabErrorBoundary>
                )}
              </main>
            </div>

            {/* Logout modal */}
            {logoutModalOpen && (
              <LogoutModal
                onConfirm={handleLogout}
                onCancel={() => setLogoutModalOpen(false)}
              />
            )}
          </NotificationsProvider>
          </ConnectsProvider>
        </RealtimeProvider>
      </div>
    </ThemeContext.Provider>
  );
};

export default Dashboard;

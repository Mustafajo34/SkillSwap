import { useCallback, useEffect, useRef, useState } from "react";

// Opening and closing a member's profile card (components/ProfileCard.jsx),
// shared by Browse Skills and Skills Connect.
//
//   Mouse/trackpad: hovering a person fades the card in next to them;
//   moving away (unless onto the card) fades it out.
//   Touch screens / any tap or click: opens it "pinned" — it stays until
//   closed (✕, tapping outside, or Esc). On phones it's centred.
//
//   const profile = useProfileCard();
//   <li onMouseEnter={(e) => profile.hoverEnter(person, e.currentTarget)}
//       onMouseLeave={profile.hoverLeave}
//       onClick={(e) => profile.open(person, e.currentTarget, true)} />
//   {profile.card && <ProfileCard {...profile.cardProps} … />}

const HOVER_OPEN_MS = 250;
const HOVER_SWITCH_MS = 90;
const HOVER_CLOSE_MS = 160;

const canHover = () => window.matchMedia("(hover: hover)").matches;
export const isPhone = () => window.matchMedia("(max-width: 639px)").matches;

export function useProfileCard() {
  // { person, rect, pinned } — rect = where the person is on screen
  const [card, setCard] = useState(null);
  const [closing, setClosing] = useState(false);
  const openTimer = useRef(null);
  const closeTimer = useRef(null);

  const clearTimers = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }, []);

  const open = useCallback(
    (person, el, pinned) => {
      clearTimers();
      setClosing(false);
      setCard({ person, rect: el.getBoundingClientRect(), pinned });
    },
    [clearTimers],
  );

  const close = useCallback(() => {
    clearTimers();
    setClosing(true);
  }, [clearTimers]);

  const exited = useCallback(() => {
    setCard(null);
    setClosing(false);
  }, []);

  // Hover only on devices that can hover — touch uses tap (open pinned)
  const hoverEnter = (person, el) => {
    if (!canHover() || card?.pinned) return;
    clearTimers();
    const delay = card && !closing ? HOVER_SWITCH_MS : HOVER_OPEN_MS;
    openTimer.current = setTimeout(() => open(person, el, false), delay);
  };
  const hoverLeave = () => {
    if (card?.pinned) return;
    clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(close, HOVER_CLOSE_MS);
  };
  const cardEnter = () => clearTimeout(closeTimer.current);

  // Escape closes; scrolling would leave the card behind, so close then too
  useEffect(() => {
    if (!card) return;
    const onKey = (e) => e.key === "Escape" && close();
    const onScroll = (e) => {
      // Scrolling inside the card itself is fine
      if (e.target instanceof Element && e.target.closest("[data-profile-card]")) return;
      if (!isPhone()) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [card, close]);

  useEffect(() => clearTimers, [clearTimers]);

  return {
    card,
    closing,
    open,
    close,
    hoverEnter,
    hoverLeave,
    // Props for <ProfileCard>
    cardProps: { closing, onClose: close, onEnter: cardEnter, onLeave: hoverLeave, onExited: exited },
    isActive: (id) => card?.person.id === id && !closing,
  };
}

// Browser-level alerts for when SkillSwap is in a background tab: system
// notifications, a flashing tab title, a ringtone and vibration. All of
// them fail quietly where the browser doesn't support or allow them.

const desktopAlertsSupported =
  typeof window !== "undefined" && "Notification" in window;

export const desktopAlertPermission = () =>
  desktopAlertsSupported ? Notification.permission : "unsupported";

// Must be called from a click (browsers ignore it otherwise)
export function requestDesktopAlerts() {
  if (!desktopAlertsSupported) return Promise.resolve("unsupported");
  return Notification.requestPermission().catch(() => "denied");
}

// System notification, only while the tab is hidden. Returns a closer.
export function showDesktopAlert(title, { body, tag, onClick } = {}) {
  if (desktopAlertPermission() !== "granted" || !document.hidden) return () => {};
  try {
    const alert = new Notification(title, { body, tag, requireInteraction: true });
    alert.onclick = () => {
      window.focus();
      onClick?.();
      alert.close();
    };
    return () => alert.close();
  } catch {
    return () => {}; // e.g. some mobile browsers only allow it from a service worker
  }
}

// Alternates the tab title while the tab is hidden. Returns a stopper.
export function flashTitle(text) {
  const original = document.title;
  let on = false;
  const timer = setInterval(() => {
    on = document.hidden ? !on : false;
    document.title = on ? text : original;
  }, 1000);
  return () => {
    clearInterval(timer);
    document.title = original;
  };
}

// Two-tone ring every 2 seconds, generated with Web Audio (no sound file).
// Browsers may block it until the user has interacted with the page.
export function startRingtone() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return () => {};
  let ctx;
  try {
    ctx = new AudioCtx();
  } catch {
    return () => {};
  }
  ctx.resume?.().catch(() => {});

  const ring = () => {
    if (ctx.state === "closed") return;
    const now = ctx.currentTime;
    [880, 660].forEach((frequency, i) => {
      const start = now + i * 0.28;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.26);
    });
    navigator.vibrate?.([180, 90, 180]);
  };

  ring();
  const timer = setInterval(ring, 2000);
  return () => {
    clearInterval(timer);
    navigator.vibrate?.(0);
    ctx.close().catch(() => {});
  };
}

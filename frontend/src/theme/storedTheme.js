// Remembers the dashboard's light/dark choice in this browser, so separate
// pages (e.g. Edit Profile) open in the same theme. Storage can be missing
// or blocked (private windows), so every access is guarded — dark is the
// default.

const KEY = "skillswap-theme";

export function readDarkMode() {
  try {
    return localStorage.getItem(KEY) !== "light";
  } catch {
    return true;
  }
}

export function storeDarkMode(dark) {
  try {
    localStorage.setItem(KEY, dark ? "dark" : "light");
  } catch {
    // not saved — the theme still applies for this page
  }
}

// Server-side link check for messageBoard posts — mirrors safeLink() in
// frontend/src/utils/attachments.js. Only http:// and https:// web
// addresses; never javascript:, data:, file:…, embedded logins, or anything
// with spaces, quotes or < >. Returns the normalised URL or null.

// <shared-rules id="safe-link"> — must match the other copy exactly (npm test checks)
function safeLink(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 2048 || /[\s<>"'`\\]/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null; // no user:pass@ tricks
  const host = url.hostname;
  if (!(host === "localhost" || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host))) return null;
  return url.href;
}
// </shared-rules>

// Text that may span lines (posts, replies): strip control characters but
// keep line breaks, tidy spaces, and allow at most one blank line in a row.
function cleanMultiline(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex -- intentionally stripping control chars
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Live Session notes only take real web links — never plain text, numbers
// or script. Stricter than safeLink():
//   • must start with https://, http:// or www.   ("notes.txt", "abc.def" ✗)
//   • the domain must end in a letter extension      ("12345" → an IP ✗,
//     like .com / .org / .io                           "https://1.2.3.4" ✗,
//                                                      "https://localhost" ✗)
//   • no spaces, quotes or < >, and nothing code-like — checked on the
//     decoded link too, so %3Cscript%3E doesn't slip through
// Returns { url } (normalised) or { error }.
// <shared-rules id="note-link"> — must match the other copy exactly (npm test checks)
function checkNoteLink(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { error: "Paste a link to share." };
  if (raw.length > 2048) return { error: "That link is too long." };
  if (/\s/.test(raw)) {
    return { error: "Only links can be added — no spaces or plain text." };
  }
  if (!/^(https?:\/\/|www\.)/i.test(raw)) {
    return { error: "Only web links can be added — they start with https:// or www." };
  }
  const url = safeLink(raw);
  if (!url) return { error: "That isn't a valid web link." };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "That isn't a valid web link." };
  }
  const labels = parsed.hostname.split(".");
  const tld = labels.at(-1);
  if (labels.length < 2 || !/^([a-z]{2,24}|xn--[a-z0-9-]{1,59})$/i.test(tld)) {
    return { error: "That isn't a valid web link — it needs a domain like example.com." };
  }
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // Malformed %-encoding: check the raw link only
  }
  if (looksLikeInjection(raw) || looksLikeInjection(decoded) || /[<>"'`]/.test(decoded)) {
    return { error: "That link contains code-like text that isn't allowed." };
  }
  return { url };
}
// </shared-rules>

// Loaded when first used (not at the top) so this file has no load-order
// surprises
const looksLikeInjection = (text) => require("../middleware/security").looksLikeInjection(text);
const noteLink = checkNoteLink;

module.exports = { safeLink, noteLink, cleanMultiline };

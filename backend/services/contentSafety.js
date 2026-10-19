// Safety checks for what people write in the Connects Feed (message-board
// posts, replies, links and search). Mirrored in
// frontend/src/utils/contentSafety.js for instant feedback — keep the two in
// sync. The server's copy is the one that counts.
//
// On top of the script / database / command injection checks in
// middleware/security.js (looksLikeInjection), this stops:
//
//   Harmful symbols
//     • text-direction overrides (U+202A–202E, U+2066–2069…) — they make
//       text or a link read differently from what it is ("Trojan Source"
//       tricks, disguised file names and links) → rejected
//     • invisible characters (zero-width spaces, soft hyphens, word joiners,
//       tag characters…) → quietly removed. The zero-width joiner stays, so
//       emoji like 👩‍💻 still work.
//     • "glitch text" — stacks of combining marks that spill over the page
//     • any HTML tag or comment — the feed is plain text
//   Credential attacks
//     • pasted secrets: passwords ("password: …"), private keys, API tokens
//       (AWS, GitHub, Slack, Stripe, Google, OpenAI/Anthropic), login tokens
//       (JWTs), database URLs with a password, card numbers (Luhn-checked)
//       and US social security numbers — protects people from leaking them
//     • asking others for their password, login / 2FA code, card or bank
//       details (phishing)
//     • phishing-style links: raw IP addresses, look-alike (punycode)
//       domains, localhost, or links carrying passwords / tokens / keys

const { safeLink } = require("./links");
const { looksLikeInjection } = require("../middleware/security");

// <shared-rules id="content-safety"> — must match the other copy exactly (npm test checks)
// ── Harmful symbols ──────────────────────────────────────────────────────────

const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
// Invisible / format characters to strip (not U+200D, used inside emoji)
const INVISIBLE =
  /\u034F|[\u00AD\u115F\u1160\u180E\u200B\u200C\u2060-\u2064\u3164\uFEFF\uFFA0\u{E0000}-\u{E007F}\u0080-\u009F]/gu;
const GLITCH = /\p{M}{4,}/u; // 4+ combining marks stacked on one letter
const HTML_TAG = /<\s*(\/\s*)?[a-z!?][^>]*>|<!--/i;

// ── Credentials ──────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, // GitHub token
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack token
  /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}/, // Stripe key
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}/, // OpenAI / Anthropic key
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s/@]+@/i, // scheme://user:password@host
  /\b(password|passwd|pwd|passcode|pin|api[ _-]?key|secret|auth[ _-]?token|access[ _-]?token)\s*(is\s*)?[:=]\s*\S{4,}/i,
  /\b\d{3}-\d{2}-\d{4}\b/, // US social security number
];

const CREDENTIAL_REQUEST =
  /\b(send|give|share|dm|text|tell|email|message|enter|type|confirm|verify|need)\s+(me\s+|us\s+)?(your|ur|yo|the)\s+(account\s+)?(password|passcode|pass\s*word|login( details| info)?|log-in( details| info)?|credentials|2fa( code)?|otp|one[- ]time (code|password)|verification code|security code|auth(entication)? code|pin( number)?|bank (details|info|account)|card (number|details|info)|cvv|ssn|social security( number)?)\b/gi;
// "never share your password", "don't give out your PIN" — advice, not a
// request: a negation just before the asking verb
const NEGATED = /\b(never|not|don'?t|do not|dont|won'?t|shouldn'?t|no one|nobody)\b[\s\w,']{0,15}$/i;
const asksForCredentials = (text) =>
  [...text.matchAll(CREDENTIAL_REQUEST)].some((m) => !NEGATED.test(text.slice(0, m.index)));

// Card numbers: 13–19 digits (spaces / dashes allowed) that pass the Luhn
// check — so order numbers and phone numbers don't trip it
const CARD_LIKE = /\b\d(?:[ -]?\d){12,18}\b/g;
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
const hasCardNumber = (text) =>
  [...text.matchAll(CARD_LIKE)].some((m) => {
    const digits = m[0].replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && !/^(\d)\1+$/.test(digits) && luhn(digits);
  });

// ── Links ────────────────────────────────────────────────────────────────────

const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}$/;
const CREDENTIAL_PARAM =
  /^(password|passwd|pwd|pass|passcode|token|access_token|id_token|refresh_token|auth|api_key|apikey|key|secret|client_secret|session|sessionid|sid|otp|code_verifier)$/i;
const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

// A link someone shares in the feed: a normal web address that isn't a
// common phishing / credential-theft shape. Returns "" or a message.
function feedLinkProblem(text) {
  const href = safeLink(text);
  if (!href) return "That isn't a valid web link (e.g. https://example.com).";
  const url = new URL(href);
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    return "Links to your own computer (localhost) can't be shared.";
  }
  if (IPV4_HOST.test(host) || host.startsWith("[")) {
    return "Links to a raw IP address aren't allowed — use the website's name.";
  }
  if (host.split(".").some((label) => label.startsWith("xn--"))) {
    return "That link uses a look-alike address (often used for phishing), so it can't be shared.";
  }
  if ([...url.searchParams.keys()].some((key) => CREDENTIAL_PARAM.test(key))) {
    return "Links can't carry passwords, tokens or keys — remove them from the link.";
  }
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // Malformed %-encoding: the raw link was already checked
  }
  if (looksLikeInjection(decoded) || /[<>"'`]/.test(decoded)) {
    return "That link contains code-like text that isn't allowed.";
  }
  return "";
}

// ── Text ─────────────────────────────────────────────────────────────────────

// Invisible characters removed (call before the checks and before saving)
const stripInvisible = (text) => String(text ?? "").replace(INVISIBLE, "");

// Post / reply / search text. Returns "" or a message saying what's wrong.
function feedTextProblem(text) {
  const value = String(text ?? "");
  if (!value) return "";
  if (BIDI_CONTROLS.test(value)) {
    return "This contains hidden text-direction characters, which can disguise what it says. Please retype it.";
  }
  if (GLITCH.test(value)) return "This contains stacked symbols (glitch text) that aren't allowed.";
  if (HTML_TAG.test(value)) return "HTML tags aren't allowed — please write plain text.";
  if (looksLikeInjection(value)) {
    return "This contains code-like text (scripts, database or system commands) that isn't allowed.";
  }
  if (asksForCredentials(value)) {
    return "For everyone's safety, posts can't ask for passwords, login codes, or card or bank details.";
  }
  if (SECRET_PATTERNS.some((re) => re.test(value)) || hasCardNumber(value)) {
    return "This looks like a password, key or card number. Never share login details or secrets in the feed.";
  }
  for (const match of value.matchAll(URL_IN_TEXT)) {
    const candidate = match[0].replace(/[.,!?;:)\]]+$/, "");
    const problem = feedLinkProblem(candidate);
    if (problem) return problem;
  }
  return "";
}

// The same checks for any other text members write that others will see:
// swap request messages, rating comments, profile bios and locations, and
// Live Session chat (on top of chat's own stricter rules)
const textSafetyProblem = feedTextProblem;
// </shared-rules>

module.exports = { stripInvisible, feedTextProblem, feedLinkProblem, textSafetyProblem };

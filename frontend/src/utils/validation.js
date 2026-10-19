// Client-side form validation.
//
// This is for UX only: it gives users fast feedback and keeps obviously bad
// input from being sent. It is NOT a security boundary — anyone can call the
// API directly — so the backend must validate and sanitize every field again.

import { stripInvisible, textSafetyProblem } from "./contentSafety";

// Strip control characters and invisible characters, normalize unicode,
// collapse runs of whitespace.
export function cleanText(value) {
  return stripInvisible(value)
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex -- intentionally stripping control chars
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Names: letters (accented letters like é or ñ count), with single hyphens,
// apostrophes or spaces between letters — e.g. "Mary-Jane", "O'Brien",
// "De La Cruz". No numbers or other symbols. ’ is accepted as well as '
// because phone keyboards insert the curly apostrophe automatically.
const NAME_CHARS_RE = /^[\p{L}\p{M}' ’-]+$/u;
const NAME_RE = /^\p{L}\p{M}*(?:[-'’ ]?\p{L}\p{M}*)*$/u;

function nameError(label, value) {
  if (/\p{N}/u.test(value)) return `${label} can't contain numbers.`;
  if (!NAME_CHARS_RE.test(value))
    return `${label} can only contain letters, spaces, hyphens (-) and apostrophes (').`;
  if (!NAME_RE.test(value))
    return `Hyphens, apostrophes and spaces in ${label.toLowerCase()} must be between letters (e.g. Mary-Jane, O'Brien, De La Cruz).`;
  return "";
}
// Email parts: local@domain.tld
// local  — letters, numbers and . _ % + - ; no leading/trailing/double dots
// domain — dot-separated labels of letters, numbers and hyphens (not at the
//          ends of a label), ending in a 2+ letter TLD like .com or .edu
const EMAIL_LOCAL_RE = /^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*$/;
const EMAIL_DOMAIN_RE =
  /^([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

function emailError(value) {
  const at = value.indexOf("@");
  if (at === -1) return "Email must include an @ symbol (e.g. maya@university.edu).";
  if (value.indexOf("@", at + 1) !== -1) return "Email can only contain one @ symbol.";

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!local) return "Enter the part of your email before the @.";
  if (!domain) return "Enter the domain after the @ (e.g. university.edu).";
  if (!domain.includes("."))
    return "Email domain must include a \".\" (e.g. university.edu).";
  if (local.length > 64 || !EMAIL_LOCAL_RE.test(local))
    return "The part before the @ contains invalid characters or dots.";
  if (!EMAIL_DOMAIN_RE.test(domain))
    return "Enter a valid email domain (e.g. university.edu).";
  return "";
}
const TEXT_RE = /^[\p{L}\p{M}\p{N} &,.'()/:-]+$/u;
const PLACE_RE = /^[\p{L}\p{M}\p{N} ,.'’()/#&-]+$/u;

// Classic SQL / NoSQL / JavaScript / script (XSS) / command injection payloads.
// Copied from backend/middleware/security.js (keep them in sync);
// specific enough that ordinary sentences ("select a skill") still pass.
// Script / HTML injection (XSS) — part of INJECTION_PATTERNS below
// <shared-rules id="xss-patterns"> — must match the other copy exactly (npm test checks)
const XSS_PATTERNS = [
  /<\s*\/?\s*(script|iframe|frame|object|embed|applet|svg|math|img|image|video|audio|source|link|style|meta|base|form|input|button|textarea|body|html|xml|template)\b/i,
  /\b(javascript|vbscript|livescript)\s*:/i, // javascript:alert(1)
  /\bdata\s*:\s*(text\/html|application\/(x-)?javascript|image\/svg)/i,
  /\bon(error|load|unload|click|dblclick|mouse\w*|pointer\w*|key\w*|focus\w*|blur|submit|change|input|toggle|begin|end|animation\w*|transition\w*|wheel|scroll|drag\w*|drop|copy|paste|cut|contextmenu|resize|message|hashchange|popstate|show|play\w*|pause|ended|canplay\w*|loadstart|search|select|invalid|reset)\s*=/i,
  /\b(eval|alert|prompt|confirm|setTimeout|setInterval|Function)\(/,
  /\bdocument\s*\.\s*(cookie|write|location|domain|body|createElement)\b/i,
  /\bwindow\s*\.\s*(location|open|eval|name)\b/i,
  /\b(local|session)Storage\s*\./i,
  /&#x?[0-9a-f]+;?/i, // entity-encoded characters, e.g. &#60;script
  /\\(x[0-9a-f]{2}|u[0-9a-f]{4}|u\{[0-9a-f]+\})/i, // escaped characters, e.g. \x3c
  /`[^`]*\$\{/, // template-literal injection
  /\bexpression\s*\(/i, // old IE CSS expressions
];
// </shared-rules>

// "Fileless" / command injection: payloads that run through tools already on
// a machine (PowerShell, cmd, mshta, a shell) instead of dropping a file.
// Nothing here runs shell commands from input — this keeps such payloads out
// of stored data. Specific on purpose: "I teach PowerShell" is fine.
// <shared-rules id="command-patterns"> — must match the other copy exactly (npm test checks)
const COMMAND_PATTERNS = [
  /\bpowershell(\.exe)?\b[^\n]{0,40}\s-(e|ec|enc|encodedcommand|nop|noprofile|w|windowstyle|ep|exec|executionpolicy|c|command)\b/i,
  /\b(iex|invoke-expression|invoke-webrequest|invoke-restmethod|start-process)\b/i,
  /\bnew-object\s+(system\.)?net\.webclient\b/i,
  /\b(downloadstring|downloadfile|frombase64string)\b/i,
  /\bcmd(\.exe)?\s*\/[ck]\b/i,
  /\b(mshta|rundll32|regsvr32|certutil|wscript|cscript|bitsadmin|wmic|msiexec)(\.exe)?\b/i,
  /\b(curl|wget)\b[^|\n]{0,200}\|\s*(sudo\s+)?(ba|z|k)?sh\b/i, // curl … | sh
  /\b(bash|sh|zsh)\s+-c\b/i,
  /(;|&&|\|\|?)\s*(rm|wget|curl|nc|ncat|netcat|bash|sh|powershell|cmd|chmod|chown|shutdown|reboot)\b/i,
  /\brm\s+-[a-z]*r[a-z]*\s+[/~]/i, // rm -rf /
  /\$\([^)]*\)/, // $(command substitution)
  /(\.\.[/\\]){2,}/, // ../../ path traversal
  /\/etc\/(passwd|shadow|hosts)\b|\bc:\\windows\\/i,
  /\b(nc|ncat|netcat)\s+-[a-z]*e\b/i, // reverse shell
];
// </shared-rules>

// <shared-rules id="injection-patterns"> — must match the other copy exactly (npm test checks)
const INJECTION_PATTERNS = [
  // SQL
  /'\s*(or|and)\s+['"]?\w+['"]?\s*(=|like)\s*['"]?\w+/i, // ' OR 1=1 / ' or 'a'='a
  /\bunion\b(\s+all)?\s+select\b/i, // UNION SELECT
  /;\s*(drop|delete|truncate|alter|insert|update|create|exec|execute|shutdown|grant)\b/i,
  /\b(drop|truncate|alter)\s+(table|database|schema|user)\b/i,
  /\binsert\s+into\s+\w+\s*(\(|values\b)/i,
  /\bselect\b[^.!?]{0,60}\bfrom\b[^.!?]{0,60}\bwhere\b/i,
  /['"`]\s*(--|#|\/\*)/, // quote then comment: admin'--
  /\b(sleep|benchmark|pg_sleep)\s*\(\s*\d/i, // timing attacks
  /\bwaitfor\s+delay\b/i,
  /\bxp_cmdshell\b/i,
  /\binformation_schema\b/i,
  // NoSQL / MongoDB
  /\$(where|ne|eq|gt|gte|lt|lte|in|nin|regex|expr|or|and|not|nor|exists|elemmatch|function|accumulator|lookup|set|unset|jsonschema)\b/i,
  /\bdb\.\w+\.(find|insert|update|remove|drop|delete)\w*\s*\(/i,
  // JavaScript (server-side eval through $where / $function)
  /\bfunction\s*\(/i,
  /=>\s*\{/,
  /\bthis\.\w+\s*(===?|!==?|>|<)/,
  /\b(process|require)\s*\(|\bprocess\.(env|exit)\b/,
  // Script / HTML (XSS)
  ...XSS_PATTERNS,
  // Fileless / command injection
  ...COMMAND_PATTERNS,
];
// </shared-rules>

export const looksLikeInjection = (text) =>
  typeof text === "string" && INJECTION_PATTERNS.some((re) => re.test(text));

// Browse Skills search: letters, spaces and a little punctuation (for names
// like "UI/UX Design") — no numbers, no tags, no code or commands.
const SEARCH_RE = /^[\p{L}\p{M} &/'’().+#-]*$/u;
export const SEARCH_MAX = 50;

export function searchError(value) {
  const text = String(value ?? "");
  if (!text.trim()) return "";
  if (text.length > SEARCH_MAX) return `Search must be ${SEARCH_MAX} characters or fewer.`;
  if (looksLikeInjection(text)) return "Search can't contain code, scripts or commands.";
  if (/[<>]/.test(text)) return "Search can't contain < or >.";
  if (/\p{N}/u.test(text)) return "Search can't contain numbers.";
  if (!SEARCH_RE.test(text)) {
    return "Search can only use letters, spaces and & / - ' ( ) . + #";
  }
  return "";
}

const INJECTION_MESSAGE =
  "This contains code-like text (such as database commands) that isn't allowed.";
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

const lengthError = (label, value, min, max) => {
  if (value.length === 0) return `${label} is required.`;
  if (value.length < min) return `${label} must be at least ${min} characters.`;
  if (value.length > max) return `${label} must be ${max} characters or fewer.`;
  return "";
};

// Marks a rule whose value must be checked exactly as typed (not trimmed or
// collapsed) — passwords, where every character counts.
const exact = (rule) => Object.assign((value) => rule(value), { exact: true });

export const USERNAME_HINT =
  "3–20 characters. Starts with a letter; letters, numbers and underscores only.";

const PASSWORD_MAX = 72; // bcrypt ignores bytes past 72

export const PASSWORD_REQUIREMENTS = [
  { id: "length", label: "At least 8 characters", test: (v) => v.length >= 8 },
  { id: "number", label: "At least one number", test: (v) => /\d/.test(v) },
  {
    id: "special",
    label: "At least one special character (! @ # $ % …)",
    test: (v) => /[^A-Za-z0-9\s]/.test(v),
  },
];

export const validators = {
  username: (value) =>
    lengthError("Username", value, 3, 20) ||
    (USERNAME_RE.test(value)
      ? ""
      : "Username must start with a letter and use only letters, numbers and underscores."),

  password: exact((value) => {
    if (value.length === 0) return "Password is required.";
    if (value.length > PASSWORD_MAX)
      return `Password must be ${PASSWORD_MAX} characters or fewer.`;
    if (PASSWORD_REQUIREMENTS.some((req) => !req.test(value)))
      return "Password must be at least 8 characters and include a number and a special character.";
    return "";
  }),

  name: (label) => (value) =>
    lengthError(label, value, 1, 50) || nameError(label, value),

  email: (value) =>
    lengthError("Email", value, 1, 254) || emailError(value),

  // Letters and single spaces between words only (e.g. "Howard University").
  // Extra spaces are already collapsed by cleanText.
  letters: (label, { min = 2, max = 100 } = {}) => (value) =>
    lengthError(label, value, min, max) ||
    (/\p{N}/u.test(value) ? `${label} can't contain numbers.` : "") ||
    (/^[\p{L}\p{M} ]+$/u.test(value)
      ? ""
      : `${label} can only contain letters and spaces.`),

  text: (label, { min = 2, max = 100 } = {}) => (value) =>
    lengthError(label, value, min, max) ||
    (TEXT_RE.test(value)
      ? ""
      : `${label} can only contain letters, numbers, spaces and basic punctuation (& , . ' ( ) / : -).`),

  oneOf: (label, options) => (value) =>
    options.includes(value) ? "" : `Please select ${label.toLowerCase()}.`,

  // Optional free text (bio): length limit, no HTML tags, and the same
  // safety checks as everything members can see (utils/contentSafety.js)
  freeText: (label, max) => (value) => {
    if (value.length > max) return `${label} must be ${max} characters or fewer.`;
    if (/[<>]/.test(value)) return `${label} can't contain < or >.`;
    return textSafetyProblem(value);
  },

  // Optional place name (location)
  place: (label, max) => (value) => {
    if (!value) return "";
    if (value.length > max) return `${label} must be ${max} characters or fewer.`;
    return PLACE_RE.test(value)
      ? ""
      : `${label} can only contain letters, numbers, spaces and , . ' ( ) / # & -`;
  },
};

// Runs each field's rule against its cleaned value (or the exact value, for
// rules marked `exact`). Returns { values, errors } where errors only has keys
// for invalid fields. Text fields are also checked for injection payloads
// (passwords aren't — they're only ever hashed), like the server does.
export function validateForm(input, rules) {
  const values = {};
  const errors = {};
  for (const [field, rule] of Object.entries(rules)) {
    values[field] = rule.exact
      ? String(input[field] ?? "")
      : cleanText(input[field]);
    const error =
      !rule.exact && looksLikeInjection(values[field])
        ? INJECTION_MESSAGE
        : rule(values[field]);
    if (error) errors[field] = error;
  }
  return { values, errors };
}

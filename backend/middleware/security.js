// Request hardening that runs before every route (see server.js), plus the
// injection-pattern check used by validate.js.
//
// MongoDB doesn't run SQL, and every query here is built from validated,
// typed values — so these are defence in depth, not the only line:
//
//  rejectInjection (middleware) — refuses a request whose body, query string
//  or URL parameters could steer a MongoDB query or pollute objects:
//    • keys that start with or contain "$" (operators: { "$ne": "" }) or "."
//      (dotted paths like "profile.role")
//    • "__proto__", "constructor", "prototype" keys (prototype pollution)
//    • null bytes in any string, and absurdly deep nesting
//    • script-like text or system commands in any field (XSS_PATTERNS,
//      COMMAND_PATTERNS) — passwords and the photo upload are exempt
//      (hashed / checked as an image)
//
//  looksLikeInjection(text) — spots classic SQL / NoSQL / JavaScript
//  injection payloads in free text (e.g. "' OR 1=1 --", "; DROP TABLE",
//  "$where", "function(", "<script>", "javascript:") so they're rejected
//  with a clear message instead of being stored. Patterns are deliberately
//  specific, so ordinary sentences ("select a skill", "drop me a note")
//  still pass.

// Script / HTML injection (XSS). React escapes text when it renders, so
// this stops payloads from ever being stored or echoed back.
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

const looksLikeScript = (text) =>
  typeof text === "string" && XSS_PATTERNS.some((re) => re.test(text));

const looksLikeCommand = (text) =>
  typeof text === "string" && COMMAND_PATTERNS.some((re) => re.test(text));

// Fields whose content is never shown or interpreted as text
const SCRIPT_CHECK_EXEMPT = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "avatar", // validated as a JPG/PNG/WEBP data URL in PUT /auth/me/avatar
]);

const MAX_DEPTH = 8;
const MAX_KEYS = 500;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Walks a parsed value; returns a short reason if anything is unsafe
function findProblem(value, depth = 0, counter = { keys: 0 }, key = "") {
  if (depth > MAX_DEPTH) return "is nested too deeply";
  if (typeof value === "string") {
    if (value.includes("\u0000")) return "contains a null character";
    if (!SCRIPT_CHECK_EXEMPT.has(key) && looksLikeScript(value)) {
      return "contains script or HTML code";
    }
    if (!SCRIPT_CHECK_EXEMPT.has(key) && looksLikeCommand(value)) {
      return "contains a system command";
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = findProblem(item, depth + 1, counter, key);
      if (problem) return problem;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (++counter.keys > MAX_KEYS) return "has too many fields";
      if (FORBIDDEN_KEYS.has(key)) return `uses a reserved name ("${key}")`;
      if (key.includes("$") || key.includes(".")) {
        return `has a field name with "$" or "." ("${key.slice(0, 40)}")`;
      }
      const problem = findProblem(value[key], depth + 1, counter, key);
      if (problem) return problem;
    }
  }
  return null;
}

function rejectInjection(req, res, next) {
  for (const part of ["body", "query", "params"]) {
    const problem = findProblem(req[part]);
    if (problem) {
      return res
        .status(400)
        .json({ message: `Request ${part} ${problem}, which isn't allowed.` });
    }
  }
  next();
}

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

const looksLikeInjection = (text) =>
  typeof text === "string" && INJECTION_PATTERNS.some((re) => re.test(text));

module.exports = { rejectInjection, looksLikeInjection };

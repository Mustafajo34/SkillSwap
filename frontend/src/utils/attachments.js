// Images and links on the message board.
//
// Images: only real JPG/PNG/WEBP/GIF files. Each one is decoded by the
// browser (so a renamed non-image fails), then re-drawn onto a canvas and
// saved as a JPEG of at most 1280px — small, and stripped of hidden
// metadata such as GPS location. GIFs are kept as-is so they still animate.
// SVG is never accepted (it can contain scripts).
//
// Links: only http:// and https:// web addresses. Anything else
// (javascript:, data:, file:…) or anything with spaces, quotes or < > is
// refused, so a link can only ever open a web page.

import { looksLikeInjection } from "./validation";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const GIF_MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 1280;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file isn't a readable image."));
    img.src = url;
  });
}

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("That file couldn't be read."));
    reader.readAsDataURL(file);
  });

// File → { blob, width, height } ready to upload (blob is the cleaned image
// file: a JPEG, or the original GIF), or throws a friendly Error
export async function prepareImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new Error(`${file.name}: only JPG, PNG, WEBP or GIF images.`);
  }
  if (file.size > IMAGE_MAX_BYTES) {
    throw new Error(`${file.name} is over 5 MB.`);
  }

  if (file.type === "image/gif") {
    if (file.size > GIF_MAX_BYTES) throw new Error(`${file.name}: GIFs must be under 2 MB.`);
    const src = await readAsDataUrl(file);
    if (!src.startsWith("data:image/gif;base64,")) throw new Error(`${file.name} isn't a GIF.`);
    const img = await loadImage(src); // proves it decodes as an image
    return { blob: file, width: img.naturalWidth, height: img.naturalHeight };
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // JPEG has no transparency
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error(`${file.name} couldn't be processed.`))),
        "image/jpeg",
        0.85,
      ),
    );
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Live Session notes only take real web links — never plain text, numbers
// or script. Stricter than safeLink(); mirrors noteLink() in backend/services/links.js:
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

// A safe, normalised web link, or null. Adds https:// if left off.
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

export function linkProblem(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return "Enter a link.";
  if (/^(javascript|data|vbscript|file|blob):/i.test(raw)) {
    return "Only web links (http:// or https://) are allowed.";
  }
  return safeLink(raw) ? "" : "That doesn't look like a valid web link (e.g. https://example.com).";
}

// "https://www.example.com/a/b?x=1" → { host: "example.com", path: "/a/b" }
export function describeLink(href) {
  const url = new URL(href);
  const path = url.pathname === "/" ? "" : url.pathname;
  return {
    host: url.hostname.replace(/^www\./, ""),
    path: `${path}${url.search}`.slice(0, 60),
  };
}

// Splits text into plain pieces and safe web links, for rendering
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+/gi;
export function linkifyParts(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    // Leave sentence punctuation outside the link: "see https://x.com."
    const candidate = match[0].replace(/[.,!?;:)\]]+$/, "");
    const href = safeLink(candidate);
    if (!href) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: candidate, href });
    last = match.index + candidate.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export { safeLink, checkNoteLink };

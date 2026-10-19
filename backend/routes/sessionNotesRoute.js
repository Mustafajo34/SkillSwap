// Live Session notes — links, PDFs and images the host shares with their
// session (the Notes button). Only the host adds or removes notes; everyone
// in the session (host + invited) can see them, open links and download.
//
//   GET    /sessionNotes/files/:id?k=<key>[&download=1]   the file itself
//          (no sign-in: the secret key is the permission — see the model)
//   GET    /sessionNotes/:roomId                → { notes, isHost }
//   POST   /sessionNotes/:roomId/links  { url } → { note }       host only
//   POST   /sessionNotes/:roomId/files          → { note }       host only
//          raw body; Content-Type = the file's type; X-File-Name = its name
//          (URI-encoded). Images (JPEG/PNG/WEBP/GIF) or PDF, up to 8 MB.
//   DELETE /sessionNotes/:roomId/notes/:id      → { deleted }    host only
//
// Every change is pushed live to the host and everyone invited
// ("sessionNotes:changed"), so open Notes panels refresh.

const express = require("express");
const router = express.Router();
const LiveRoom = require("../models/liveRoomModel");
const SessionNote = require("../models/sessionNoteModel");
const { requireAuth } = require("../middleware/requireAuth");
const { sessionNotesLimiter } = require("../middleware/rateLimit");
const { noteLink } = require("../services/links");
const { feedLinkProblem } = require("../services/contentSafety");
const { emitToUser } = require("../services/realtime");

const ROOM_ID_RE = /^[a-z0-9]{8,32}$/i;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const KEY_RE = /^[a-f0-9]{32}$/;
const MAX_NOTES = 40; // per session
const MAX_TOTAL_BYTES = 60 * 1024 * 1024; // all files in one session
const NAME_MAX = 120;
const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

// ── The file itself (public, keyed) ──────────────────────────────────────────

router.get("/files/:id", async (req, res) => {
  const { id } = req.params;
  const key = req.query.k;
  if (!OBJECT_ID_RE.test(id) || typeof key !== "string" || !KEY_RE.test(key)) {
    return res.sendStatus(404);
  }
  try {
    const note = await SessionNote.findOne({ _id: id, key, kind: { $ne: "link" } })
      .select("contentType data name")
      .lean();
    if (!note) return res.sendStatus(404);
    // PDFs always download (never rendered from our address); images show
    // inline unless a download was asked for
    const download = req.query.download === "1" || note.contentType === "application/pdf";
    const ascii = note.name.replace(/[^\w.\- ()]/g, "_") || "file";
    res.set(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(note.name)}`,
    );
    res.set("Cross-Origin-Resource-Policy", "cross-origin"); // <img> on the frontend
    res.set("Cache-Control", "private, max-age=86400, immutable"); // never changes
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.type(note.contentType).send(Buffer.from(note.data.buffer ?? note.data));
  } catch (error) {
    console.error("Session note file failed:", error);
    res.sendStatus(500);
  }
});

router.use(requireAuth);

// ── Helpers ──────────────────────────────────────────────────────────────────

// The active session, if the user is in it. Answers the request itself
// (and returns null) when not.
async function sessionFor(req, res, { hostOnly = false } = {}) {
  const { roomId } = req.params;
  if (!ROOM_ID_RE.test(roomId || "")) {
    res.status(400).json({ message: "Invalid session." });
    return null;
  }
  const room = await LiveRoom.findActive({ roomId });
  if (!room || !room.canJoin(req.userId)) {
    res.status(404).json({ message: "This session has ended or you're not in it." });
    return null;
  }
  if (hostOnly && !room.isHost(req.userId)) {
    res.status(403).json({ message: "Only the host can change this session's notes." });
    return null;
  }
  return room;
}

// Ended while this request was in flight → remove what was just saved
async function keepIfActive(room, note, res) {
  if (await LiveRoom.exists({ roomId: room.roomId, endedAt: null })) return true;
  await SessionNote.deleteOne({ _id: note._id });
  res.status(404).json({ message: "This session has ended." });
  return false;
}

function changed(room) {
  const payload = { roomId: room.roomId };
  [room.host, ...room.invited].forEach((id) => emitToUser(id, "sessionNotes:changed", payload));
}

async function roomForNotes(room, res, addBytes = 0) {
  const [count, [total] = []] = await Promise.all([
    SessionNote.countDocuments({ roomId: room.roomId }),
    SessionNote.aggregate([
      { $match: { roomId: room.roomId } },
      { $group: { _id: null, bytes: { $sum: "$size" } } },
    ]),
  ]);
  if (count >= MAX_NOTES) {
    res.status(400).json({ message: `A session can have up to ${MAX_NOTES} notes. Remove one first.` });
    return false;
  }
  if ((total?.bytes || 0) + addBytes > MAX_TOTAL_BYTES) {
    res.status(400).json({ message: "This session's files are full (60 MB). Remove some first." });
    return false;
  }
  return true;
}

// A safe display name ending in the right extension
function cleanName(raw, contentType) {
  let name = "";
  try {
    name = decodeURIComponent(String(raw || ""));
  } catch {
    name = "";
  }
  name = name
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex -- intentionally stripping control chars
    .replace(/[\u0000-\u001F\u007F<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const ext = EXTENSIONS[contentType];
  const base = name.replace(/\.[^.]*$/, "").slice(0, NAME_MAX - ext.length - 1).trim() || (ext === "pdf" ? "document" : "image");
  return `${base}.${ext}`;
}

// ── Reading ──────────────────────────────────────────────────────────────────

router.get("/:roomId", async (req, res) => {
  try {
    const room = await sessionFor(req, res);
    if (!room) return;
    const notes = await SessionNote.find({ roomId: room.roomId })
      .select("-data")
      .sort({ createdAt: -1 })
      .limit(MAX_NOTES);
    res.status(200).json({ notes: notes.map((n) => n.toView()), isHost: room.isHost(req.userId) });
  } catch (error) {
    console.error("List session notes failed:", error);
    res.status(500).json({ message: "Unable to load notes." });
  }
});

// ── Host: adding and removing ────────────────────────────────────────────────

router.post("/:roomId/links", sessionNotesLimiter, async (req, res) => {
  // Real web links only — no plain text, numbers or script (see noteLink)
  if (typeof req.body?.url !== "string") {
    return res.status(400).json({ message: "Paste a link to share.", field: "url" });
  }
  const { url, error: linkError } = noteLink(req.body.url);
  if (!url) return res.status(400).json({ message: linkError, field: "url" });
  // Phishing shapes: look-alike domains, links carrying passwords / tokens
  const phishing = feedLinkProblem(url);
  if (phishing) return res.status(400).json({ message: phishing, field: "url" });
  try {
    const room = await sessionFor(req, res, { hostOnly: true });
    if (!room || !(await roomForNotes(room, res))) return;
    const note = await SessionNote.create({
      roomId: room.roomId,
      owner: req.userId,
      kind: "link",
      url,
      expiresAt: room.expiresAt,
    });
    if (!(await keepIfActive(room, note, res))) return;
    res.status(201).json({ note: note.toView() });
    changed(room);
  } catch (error) {
    console.error("Add session link failed:", error);
    res.status(500).json({ message: "Unable to add that link." });
  }
});

router.post(
  "/:roomId/files",
  sessionNotesLimiter,
  express.raw({ type: SessionNote.FILE_TYPES, limit: SessionNote.FILE_MAX_BYTES }),
  async (req, res) => {
    const contentType = (req.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!SessionNote.FILE_TYPES.includes(contentType)) {
      return res.status(400).json({ message: "Only images (JPEG, PNG, WEBP, GIF) and PDFs can be added." });
    }
    const data = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) {
      return res.status(400).json({ message: "That file is empty." });
    }
    if (!SessionNote.matchesType(data, contentType)) {
      return res.status(400).json({ message: "That file isn't a real image or PDF." });
    }
    try {
      const room = await sessionFor(req, res, { hostOnly: true });
      if (!room || !(await roomForNotes(room, res, data.length))) return;
      const note = await SessionNote.create({
        roomId: room.roomId,
        owner: req.userId,
        kind: contentType === "application/pdf" ? "pdf" : "image",
        name: cleanName(req.get("X-File-Name"), contentType),
        contentType,
        size: data.length,
        data,
        expiresAt: room.expiresAt,
      });
      if (!(await keepIfActive(room, note, res))) return;
      res.status(201).json({ note: note.toView() });
      changed(room);
    } catch (error) {
      console.error("Add session file failed:", error);
      res.status(500).json({ message: "Unable to add that file." });
    }
  },
);

router.delete("/:roomId/notes/:id", sessionNotesLimiter, async (req, res) => {
  if (!OBJECT_ID_RE.test(req.params.id || "")) {
    return res.status(400).json({ message: "Invalid note." });
  }
  try {
    const room = await sessionFor(req, res, { hostOnly: true });
    if (!room) return;
    const { deletedCount } = await SessionNote.deleteOne({ _id: req.params.id, roomId: room.roomId });
    if (!deletedCount) return res.status(404).json({ message: "That note is already gone." });
    res.status(200).json({ deleted: true });
    changed(room);
  } catch (error) {
    console.error("Delete session note failed:", error);
    res.status(500).json({ message: "Unable to remove that note." });
  }
});

// Too big for express.raw → a clear message instead of a stack trace
router.use((error, req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ message: "Files can be up to 8 MB." });
  }
  next(error);
});

module.exports = router;

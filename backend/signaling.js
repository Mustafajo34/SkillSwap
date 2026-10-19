// WebRTC signaling server for Live Sessions.
//
// Video and audio go directly between browsers (peer-to-peer). This server
// only helps them find each other: it tracks who is in each room and relays
// the offer/answer/ICE-candidate messages between two peers in the same room.
// It never sees any media.
//
// Clients authenticate with the same access token as the REST API
// (socket.handshake.auth.token), so only signed-in users can join.
//
// Events (client → server):
//   room:join  { roomId, state: { mic, camera } }, ack → { peers, iceServers } | { error }
//   signal     { to, data: { description } | { candidate } }
//   peer:state { mic, camera }
//   room:leave
// Events (server → client):
//   peer:joined { id, userId, name, state }
//   session:ended { roomId } — the call is over; you've been taken out
//   peer:left   { id }
//   peer:state  { id, mic, camera }
//   signal      { from, data }

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("./models/userModel");
const LiveRoom = require("./models/liveRoomModel");
const Notification = require("./models/notificationModel");
const SessionNote = require("./models/sessionNoteModel");
const SessionChatMessage = require("./models/sessionChatModel");
const { setRealtimeServer, setRoomPresence, userRoom, emitToUser } = require("./services/realtime");
const { notify, actorFor } = require("./services/notifications");

// Every peer connects to every other peer (a mesh), so upload bandwidth grows
// with each person. 6 = host + up to 5 invited friends.
const MAX_PEERS = Number(process.env.ROOM_MAX_PEERS) || 6;
// A call ends when it drops to one person after having had two or more.
// Clicking Leave ends it at once; a dropped connection (Wi-Fi blip, page
// reload) gets this long to come back first.
const END_GRACE_MS = Number(process.env.SESSION_END_GRACE_MS) || 15_000;
const ROOM_ID_RE = /^[a-z0-9]{8,32}$/i;
// An SDP offer is a few KB; anything far bigger isn't a real signal.
const MAX_MESSAGE_BYTES = 64 * 1024;
// Per-socket flood guard: at most this many messages per window.
const RATE_LIMIT = 300;
const RATE_WINDOW_MS = 10_000;
// Live-session reactions (the React button). Only these keys are relayed —
// the emoji themselves live in the frontend (components/LiveSession.jsx).
const REACTIONS = new Set([
  "grin", "joy", "love", "frown", "cry", "thumbs", "clap", "wave", "balloon", "heart",
]);
// Per person: a burst of reactions is fine, a flood isn't
const REACTION_LIMIT = 12;
const REACTION_WINDOW_MS = 3_000;

// STUN lets peers discover their public address. Peers behind strict
// firewalls/NATs also need a TURN relay — set TURN_URL (comma-separated
// urls), TURN_USERNAME and TURN_CREDENTIAL to add one.
function iceServers() {
  const servers = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL.split(",").map((url) => url.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  return servers;
}

const cleanState = (state) => ({
  mic: Boolean(state?.mic),
  camera: Boolean(state?.camera),
});

// Only pass along the fields WebRTC needs, with the expected types.
function cleanSignal(data) {
  const description = data?.description;
  if (description) {
    if (
      (description.type === "offer" || description.type === "answer") &&
      typeof description.sdp === "string"
    ) {
      return { description: { type: description.type, sdp: description.sdp } };
    }
    return null;
  }
  const candidate = data?.candidate;
  if (candidate && typeof candidate.candidate === "string") {
    return {
      candidate: {
        candidate: candidate.candidate,
        sdpMid: typeof candidate.sdpMid === "string" ? candidate.sdpMid : null,
        sdpMLineIndex: Number.isInteger(candidate.sdpMLineIndex)
          ? candidate.sdpMLineIndex
          : null,
        usernameFragment:
          typeof candidate.usernameFragment === "string"
            ? candidate.usernameFragment
            : null,
      },
    };
  }
  return null;
}

function attachSignaling(httpServer, allowedOrigins) {
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
  });

  // roomId → Map(socketId → { id, name, state })
  const rooms = new Map();
  // roomId → most people in the call at once (has it been a real call?)
  const peaks = new Map();
  // roomId → pending "is the call over?" check
  const endTimers = new Map();
  // roomId → screen sharing: { presenter: socketId | null, allowed: Set(userId) }
  // The host can always share; anyone else only once the host allows them.
  // One presenter at a time (the host can take over).
  const shares = new Map();
  const shareOf = (roomId) => {
    if (!shares.has(roomId)) shares.set(roomId, { presenter: null, allowed: new Set() });
    return shares.get(roomId);
  };
  const shareView = (roomId) => {
    const share = shares.get(roomId);
    return { presenter: share?.presenter || null, allowed: [...(share?.allowed || [])] };
  };
  const broadcastShare = (roomId) => io.to(roomId).emit("share:state", shareView(roomId));
  // roomId → when the host started recording (ms). Only the host records
  // (in their browser); this just tells everyone it's happening and since
  // when, so every timer shows the real recording length.
  const recordings = new Map();
  const recView = (roomId) => {
    const startedAt = recordings.get(roomId);
    return { active: Boolean(startedAt), elapsedMs: startedAt ? Date.now() - startedAt : 0 };
  };
  const broadcastRec = (roomId) => io.to(roomId).emit("rec:state", recView(roomId));

  // The call is over: mark the session ended so it can't be joined again,
  // disconnect whoever is still in the room, and tell everyone involved
  // (their bell's "Join" buttons and any ringing alert update live).
  async function endSession(roomId) {
    const members = rooms.get(roomId);
    members?.forEach((_member, socketId) => {
      const s = io.sockets.sockets.get(socketId);
      if (!s) return;
      s.emit("session:ended", { roomId });
      s.leave(roomId);
      s.data.roomId = null;
    });
    rooms.delete(roomId);
    peaks.delete(roomId);
    shares.delete(roomId);
    recordings.delete(roomId);

    try {
      const endedAt = new Date();
      const room = await LiveRoom.findOneAndUpdate(
        { roomId, endedAt: null },
        { endedAt },
        { returnDocument: "after" },
      );
      // The session's chat and shared notes go with it — every time, even
      // if it was already marked ended (a retry after a failed cleanup)
      await Promise.all([
        SessionChatMessage.deleteMany({ roomId }),
        SessionNote.deleteMany({ roomId }),
      ]);
      if (!room) return;
      await Notification.updateMany(
        { type: "session_invite", "data.roomId": roomId },
        { $set: { "data.endedAt": endedAt } },
      );
      [room.host, ...room.invited].forEach((userId) =>
        emitToUser(userId, "session:ended", { roomId }),
      );
    } catch (err) {
      console.error("Ending session failed:", err);
    }
  }

  function checkCallOver(roomId, delay) {
    clearTimeout(endTimers.get(roomId));
    const check = () => {
      endTimers.delete(roomId);
      const size = rooms.get(roomId)?.size || 0;
      if (size <= 1 && (peaks.get(roomId) || 0) >= 2) endSession(roomId);
      else if (size === 0) {
        peaks.delete(roomId);
        // Nobody's in the room any more (left, signed out, closed the tab):
        // the chat only lives while the session is live
        SessionChatMessage.deleteMany({ roomId }).catch((err) =>
          console.error("Clearing session chat failed:", err),
        );
      }
    };
    if (delay <= 0) return check();
    endTimers.set(roomId, setTimeout(check, delay));
  }

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || !token) {
      return next(new Error("Not signed in"));
    }

    let userId;
    try {
      userId = jwt.verify(token, process.env.MYACCESSKEY).id;
    } catch {
      return next(new Error("Session expired. Please sign in again."));
    }

    try {
      const user = await User.findById(userId)
        .select("firstName lastName userName photoVersion")
        .lean();
      if (!user) return next(new Error("Account not found"));
      socket.data.userId = userId;
      socket.data.photoV = user.photoVersion || null;
      socket.data.name =
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.userName;
      next();
    } catch (err) {
      console.error("Signaling auth lookup failed:", err);
      next(new Error("Server error. Please try again."));
    }
  });

  setRealtimeServer(io);
  setRoomPresence((roomId, userId) => {
    for (const member of rooms.get(roomId)?.values() || []) {
      if (member.userId === userId) return true;
    }
    return false;
  });

  io.on("connection", (socket) => {
    // Private room for app-wide live updates (see services/realtime.js)
    socket.join(userRoom(socket.data.userId));

    let windowStart = Date.now();
    let count = 0;
    const allowed = () => {
      const now = Date.now();
      if (now - windowStart > RATE_WINDOW_MS) {
        windowStart = now;
        count = 0;
      }
      return ++count <= RATE_LIMIT;
    };

    let reactionStart = 0;
    let reactionCount = 0;
    const reactionAllowed = () => {
      const now = Date.now();
      if (now - reactionStart > REACTION_WINDOW_MS) {
        reactionStart = now;
        reactionCount = 0;
      }
      return ++reactionCount <= REACTION_LIMIT;
    };

    // explicit = they clicked Leave (or switched room) rather than dropped
    const leave = (explicit) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const members = rooms.get(roomId);
      members?.delete(socket.id);
      if (members && members.size === 0) rooms.delete(roomId);
      socket.leave(roomId);
      socket.data.roomId = null;
      socket.to(roomId).emit("peer:left", { id: socket.id });
      // Their screen share stops with them; an empty room starts fresh
      const share = shares.get(roomId);
      // The host leaving (or the room emptying) ends their recording
      const wasHost = socket.data.isHost;
      socket.data.isHost = false;
      if (!rooms.has(roomId)) recordings.delete(roomId);
      else if (wasHost && recordings.has(roomId)) {
        recordings.delete(roomId);
        broadcastRec(roomId);
      }
      if (!rooms.has(roomId)) shares.delete(roomId);
      else if (share?.presenter === socket.id) {
        share.presenter = null;
        broadcastShare(roomId);
      }
      checkCallOver(roomId, explicit ? 0 : END_GRACE_MS);
    };

    socket.on("room:join", async (payload, ack) => {
      if (typeof ack !== "function" || !allowed()) return;
      let joiningAsHost = false;
      const roomId = payload?.roomId;
      if (typeof roomId !== "string" || !ROOM_ID_RE.test(roomId)) {
        return ack({ error: "This session link isn't valid." });
      }

      // Invite-only: the host and invited people only (see routes/sessionRoute.js)
      try {
        const room = await LiveRoom.findActive({ roomId });
        if (!room) {
          return ack({ error: "This session has ended or doesn't exist." });
        }
        if (!room.canJoin(socket.data.userId)) {
          return ack({
            error: "This session is invite-only. Ask the host for an invite link.",
          });
        }
        joiningAsHost = room.isHost(socket.data.userId);
        // Their current photo (it may have changed since the socket connected)
        const me = await User.findById(socket.data.userId).select("photoVersion").lean();
        socket.data.photoV = me?.photoVersion || null;
      } catch (err) {
        console.error("Session lookup failed:", err);
        return ack({ error: "Couldn't join the session. Please try again." });
      }
      if (!socket.connected) return;
      if (socket.data.roomId) leave(true);

      const members = rooms.get(roomId) ?? new Map();
      if (members.size >= MAX_PEERS) {
        return ack({
          error: `This session is full (${MAX_PEERS} people max).`,
        });
      }

      const me = {
        id: socket.id,
        // Account id, so "Call again" can invite them to a new session
        userId: String(socket.data.userId),
        photoV: socket.data.photoV,
        name: socket.data.name,
        state: cleanState(payload?.state),
      };
      const peers = [...members.values()];
      members.set(socket.id, me);
      peaks.set(roomId, Math.max(peaks.get(roomId) || 0, members.size));
      // Someone came back in time — the call carries on
      clearTimeout(endTimers.get(roomId));
      endTimers.delete(roomId);
      rooms.set(roomId, members);
      socket.data.roomId = roomId;
      socket.join(roomId);

      socket.to(roomId).emit("peer:joined", me);
      socket.data.isHost = joiningAsHost;
      // On the attendee list, so they can rate (and be rated) after the call
      LiveRoom.updateOne({ roomId }, { $addToSet: { attendees: socket.data.userId } }).catch(
        (err) => console.error("Recording attendee failed:", err),
      );
      ack({ peers, iceServers: iceServers(), share: shareView(roomId), rec: recView(roomId) });
      // Joining while it's being recorded: they get the saved notice too
      if (recordings.has(roomId) && !joiningAsHost) {
        const host = [...members.values()].find((m) => io.sockets.sockets.get(m.id)?.data.isHost);
        if (host) {
          actorFor(host.userId)
            .then((actor) => notify(me.userId, "session_recording", actor, { roomId }))
            .catch((err) => console.error("Recording notification failed:", err));
        }
      }
    });

    socket.on("signal", (payload) => {
      if (!allowed()) return;
      const roomId = socket.data.roomId;
      const to = payload?.to;
      // Only relay between two members of the same room
      if (
        !roomId ||
        typeof to !== "string" ||
        to === socket.id ||
        !rooms.get(roomId)?.has(to)
      ) {
        return;
      }
      const data = cleanSignal(payload.data);
      if (data) io.to(to).emit("signal", { from: socket.id, data });
    });

    socket.on("peer:state", (state) => {
      if (!allowed()) return;
      const roomId = socket.data.roomId;
      const me = rooms.get(roomId)?.get(socket.id);
      if (!me) return;
      me.state = cleanState(state);
      socket.to(roomId).emit("peer:state", { id: socket.id, ...me.state });
    });

    // A floating emoji for everyone else in the call
    socket.on("reaction", (key) => {
      if (!allowed() || typeof key !== "string" || !REACTIONS.has(key)) return;
      const roomId = socket.data.roomId;
      if (!roomId || !rooms.get(roomId)?.has(socket.id) || !reactionAllowed()) return;
      socket.to(roomId).emit("reaction", { id: socket.id, key });
    });

    // ── Screen sharing ──
    // Start presenting. The host always may (and takes over from anyone
    // else); others need the host's permission and a free "stage".
    socket.on("share:start", (ack) => {
      if (typeof ack !== "function" || !allowed()) return;
      const roomId = socket.data.roomId;
      const me = rooms.get(roomId)?.get(socket.id);
      if (!me) return ack({ error: "Join the session first." });
      const share = shareOf(roomId);
      if (!socket.data.isHost && !share.allowed.has(me.userId)) {
        return ack({ error: "The host hasn't allowed you to share your screen." });
      }
      if (share.presenter && share.presenter !== socket.id && !socket.data.isHost) {
        const name = rooms.get(roomId)?.get(share.presenter)?.name || "Someone";
        return ack({ error: `${name} is already sharing their screen.` });
      }
      share.presenter = socket.id;
      ack({ share: shareView(roomId) });
      broadcastShare(roomId);
    });

    socket.on("share:stop", () => {
      if (!allowed()) return;
      const roomId = socket.data.roomId;
      const share = shares.get(roomId);
      if (!share || share.presenter !== socket.id) return;
      share.presenter = null;
      broadcastShare(roomId);
    });

    // Host only: let someone in the session share (or take it back — which
    // also stops their share if they're presenting)
    socket.on("share:allow", (payload) => {
      if (!allowed() || !socket.data.isHost) return;
      const roomId = socket.data.roomId;
      const members = rooms.get(roomId);
      const userId = payload?.userId;
      if (!members || typeof userId !== "string" || !/^[a-f0-9]{24}$/i.test(userId)) return;
      if (userId === String(socket.data.userId)) return;
      const share = shareOf(roomId);
      if (payload.allow === true) share.allowed.add(userId);
      else if (payload.allow === false) {
        share.allowed.delete(userId);
        if (share.presenter && members.get(share.presenter)?.userId === userId) share.presenter = null;
      } else return;
      broadcastShare(roomId);
    });

    // ── Recording (host only, during an active call) ──
    socket.on("rec:start", (ack) => {
      if (typeof ack !== "function" || !allowed()) return;
      const roomId = socket.data.roomId;
      const members = rooms.get(roomId);
      if (!members?.has(socket.id)) return ack({ error: "Join the session first." });
      if (!socket.data.isHost) return ack({ error: "Only the host can record this session." });
      if (members.size < 2) return ack({ error: "You can record once someone joins your session." });
      // Already recording: keep the original start time, nothing new to announce
      if (recordings.has(roomId)) return ack({ rec: recView(roomId) });
      recordings.set(roomId, Date.now());
      ack({ rec: recView(roomId) });
      broadcastRec(roomId);
      // Everyone being recorded also gets a saved notification on their own
      // account (the bell), so they know — and have a record of it
      const hostId = String(socket.data.userId);
      const recorded = new Set(
        [...members.values()].map((m) => m.userId).filter((id) => id && id !== hostId),
      );
      if (recorded.size) {
        actorFor(hostId)
          .then((actor) =>
            Promise.all([...recorded].map((id) => notify(id, "session_recording", actor, { roomId }))),
          )
          .catch((err) => console.error("Recording notifications failed:", err));
      }
    });

    socket.on("rec:stop", () => {
      if (!allowed() || !socket.data.isHost) return;
      const roomId = socket.data.roomId;
      if (!recordings.has(roomId)) return;
      recordings.delete(roomId);
      broadcastRec(roomId);
    });

    // "…is typing" in the session chat, for everyone else in the call
    socket.on("chat:typing", (typing) => {
      if (!allowed() || typeof typing !== "boolean") return;
      const roomId = socket.data.roomId;
      if (!roomId || !rooms.get(roomId)?.has(socket.id)) return;
      socket.to(roomId).emit("chat:typing", { id: socket.id, typing });
    });

    socket.on("room:leave", () => leave(true));
    socket.on("disconnect", (reason) => leave(reason === "client namespace disconnect"));
  });

  return io;
}

module.exports = { attachSignaling };

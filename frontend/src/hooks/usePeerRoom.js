import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_BASE } from "../utils/api";

// Peer-to-peer video for Live Sessions.
//
// Every participant opens one RTCPeerConnection to every other participant
// (a mesh). The backend signaling server (backend/signaling.js) only relays
// the messages needed to set those connections up; audio and video flow
// directly between browsers.
//
// Negotiation follows the "perfect negotiation" pattern
// (https://developer.mozilla.org/docs/Web/API/WebRTC_API/Perfect_negotiation):
// either side may send an offer at any time, and if both do at once the
// "polite" peer backs off. That keeps adding a camera mid-call simple.

const FALLBACK_ICE = [{ urls: "stun:stun.l.google.com:19302" }];

// Adds/replaces this peer's outgoing tracks to match ours. replaceTrack
// swaps a device without renegotiating; addTrack (first time a kind is
// sent) triggers onnegotiationneeded.
function syncSenders(entry, tracks) {
  for (const kind of ["audio", "video"]) {
    const track = tracks[kind];
    const sender = entry.senders[kind];
    if (sender) {
      if (sender.track !== track) sender.replaceTrack(track).catch(() => {});
    } else if (track) {
      entry.senders[kind] = entry.pc.addTrack(track, entry.localStream);
    }
  }
}

const NO_SHARE = { presenter: null, allowed: [] };
// Recording (host only): is it on, and since when (local clock, ms)
const NO_REC = { active: false, since: 0 };
const SHARE_ACK_TIMEOUT_MS = 5000;

export function usePeerRoom({
  roomId,
  enabled,
  token,
  tracks,
  mic,
  camera,
  onReaction,
  onTyping,
  onShareChange,
  onRecChange,
}) {
  // id → { id, userId, photoV, name, stream, mic, camera, connection }
  const [peers, setPeers] = useState({});
  // idle | connecting | connected | reconnecting | error | ended
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState(null);

  const tokenRef = useRef(token);
  const onReactionRef = useRef(onReaction);
  const onTypingRef = useRef(onTyping);
  const onShareChangeRef = useRef(onShareChange);
  const onRecChangeRef = useRef(onRecChange);
  const [rec, setRec] = useState(NO_REC);
  const recRef = useRef(NO_REC);
  // Screen sharing (server-decided): who's presenting (socket id) and which
  // accounts the host has allowed to share
  const [share, setShare] = useState(NO_SHARE);
  const shareRef = useRef(NO_SHARE);
  // Our own socket id, to tell "I'm presenting" from "someone else is"
  const [selfId, setSelfId] = useState(null);
  const tracksRef = useRef(tracks);
  const stateRef = useRef({ mic, camera });
  const socketRef = useRef(null);
  const pcsRef = useRef(new Map());

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    onReactionRef.current = onReaction;
    onTypingRef.current = onTyping;
    onShareChangeRef.current = onShareChange;
    onRecChangeRef.current = onRecChange;
  }, [onReaction, onTyping, onShareChange, onRecChange]);

  useEffect(() => {
    if (!enabled || !roomId) return;

    const socket = io(API_BASE, {
      // A function, so reconnects use the latest (refreshed) access token
      auth: (cb) => cb({ token: tokenRef.current }),
      withCredentials: true,
    });
    socketRef.current = socket;
    const pcs = new Map();
    pcsRef.current = pcs;
    let iceServers = FALLBACK_ICE;

    const updatePeer = (id, patch) =>
      setPeers((all) =>
        all[id] ? { ...all, [id]: { ...all[id], ...patch } } : all,
      );

    const closePeer = (id) => {
      pcs.get(id)?.pc.close();
      pcs.delete(id);
      setPeers((all) => {
        const next = { ...all };
        delete next[id];
        return next;
      });
    };

    const closeAll = () => {
      pcs.forEach((entry) => entry.pc.close());
      pcs.clear();
      setPeers({});
    };

    const send = (to, data) => socket.emit("signal", { to, data });

    // Recording state from the server. elapsedMs → a local start time, so
    // timers are right even if this computer's clock is off.
    const applyRec = (view) => {
      const prev = recRef.current;
      const next = view?.active ? { active: true, since: Date.now() - (view.elapsedMs || 0) } : NO_REC;
      recRef.current = next;
      setRec(next);
      if (prev.active !== next.active) onRecChangeRef.current?.(next);
    };

    // New share state from the server; tells the room what changed
    const applyShare = (next) => {
      const prev = shareRef.current;
      shareRef.current = next;
      setShare(next);
      onShareChangeRef.current?.(prev, next, socket.id);
    };

    const createPeer = (id, name, state, userId, photoV) => {
      const existing = pcs.get(id);
      if (existing) {
        if (name) updatePeer(id, { name, ...(userId && { userId, photoV: photoV || null }) });
        return existing;
      }

      const pc = new RTCPeerConnection({ iceServers });
      const entry = {
        pc,
        // Exactly one side of each pair is polite
        polite: socket.id > id,
        makingOffer: false,
        ignoreOffer: false,
        senders: {},
        localStream: new MediaStream(),
        remoteStream: new MediaStream(),
        // Handle this peer's signals one at a time, in order
        queue: Promise.resolve(),
      };
      pcs.set(id, entry);

      setPeers((all) => ({
        ...all,
        [id]: {
          id,
          name: name || "Guest",
          userId: userId || null,
          photoV: photoV || null,
          stream: entry.remoteStream,
          mic: state?.mic ?? true,
          camera: state?.camera ?? true,
          connection: "connecting",
        },
      }));

      pc.ontrack = ({ track }) => {
        // New MediaStream object so the <video> re-attaches it
        entry.remoteStream = new MediaStream([
          ...entry.remoteStream
            .getTracks()
            .filter((t) => t.kind !== track.kind),
          track,
        ]);
        updatePeer(id, { stream: entry.remoteStream });
      };

      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          send(id, { description: pc.localDescription.toJSON() });
        } catch (err) {
          console.error("WebRTC offer failed:", err);
        } finally {
          entry.makingOffer = false;
        }
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) send(id, { candidate: candidate.toJSON() });
      };

      pc.onconnectionstatechange = () => {
        updatePeer(id, { connection: pc.connectionState });
        // Network changed (e.g. Wi-Fi → mobile data): find a new route
        if (pc.connectionState === "failed") pc.restartIce();
      };

      syncSenders(entry, tracksRef.current);
      return entry;
    };

    const handleSignal = async (from, data) => {
      const entry = pcs.get(from) || createPeer(from);
      const { pc } = entry;
      if (data.description) {
        const offerCollision =
          data.description.type === "offer" &&
          (entry.makingOffer || pc.signalingState !== "stable");
        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) return;

        await pc.setRemoteDescription(data.description);
        if (data.description.type === "offer") {
          await pc.setLocalDescription();
          send(from, { description: pc.localDescription.toJSON() });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!entry.ignoreOffer) throw err;
        }
      }
    };

    socket.on("connect", () => {
      setStatus("connecting");
      setError(null);
      socket.emit(
        "room:join",
        { roomId, state: stateRef.current },
        (res) => {
          if (res?.error) {
            setStatus("error");
            setError(res.error);
            return;
          }
          if (res?.iceServers?.length) iceServers = res.iceServers;
          setStatus("connected");
          setSelfId(socket.id);
          applyShare(res?.share || NO_SHARE);
          applyRec(res?.rec);
          // We're the newcomer: connect to everyone already here
          res?.peers?.forEach((p) => createPeer(p.id, p.name, p.state, p.userId, p.photoV));
        },
      );
    });

    socket.on("connect_error", (err) => {
      if (socket.active) {
        // Network problem — Socket.IO keeps retrying on its own
        setStatus("reconnecting");
        setError("Can't reach the session server. Retrying…");
      } else {
        // Rejected by the server (e.g. not signed in) — needs retry()
        setStatus("error");
        setError(err?.message || "Couldn't join the session.");
      }
    });

    socket.on("disconnect", (reason) => {
      // Our socket id changes on reconnect, so every connection restarts
      closeAll();
      applyShare(NO_SHARE);
      applyRec(null);
      if (reason === "io server disconnect") {
        setStatus("error");
        setError("The session server closed the connection.");
      } else if (reason !== "io client disconnect") {
        setStatus("reconnecting");
      }
    });

    socket.on("peer:joined", ({ id, name, state, userId, photoV }) =>
      createPeer(id, name, state, userId, photoV),
    );
    socket.on("peer:left", ({ id }) => closePeer(id));
    // The call is over (everyone else left) — the server has already taken
    // us out of the room; drop the connections and stay disconnected
    // (Ignore news about other sessions — this socket also hears your
    // account-wide events, e.g. an old call of yours ending.)
    socket.on("session:ended", ({ roomId: endedRoom } = {}) => {
      if (endedRoom !== roomId) return;
      closeAll();
      setStatus("ended");
      setError(null);
      socket.disconnect();
    });

    socket.on("peer:state", ({ id, mic: peerMic, camera: peerCamera }) =>
      updatePeer(id, { mic: peerMic, camera: peerCamera }),
    );
    // Someone else in the room reacted (the React button)
    socket.on("reaction", ({ id, key } = {}) => onReactionRef.current?.(id, key));
    socket.on("share:state", (next) => next && applyShare(next));
    socket.on("rec:state", applyRec);
    // Someone started/stopped typing in the session chat
    socket.on("chat:typing", ({ id, typing } = {}) => onTypingRef.current?.(id, typing));
    socket.on("signal", ({ from, data }) => {
      const entry = pcs.get(from) || createPeer(from);
      entry.queue = entry.queue
        .then(() => handleSignal(from, data))
        .catch((err) => console.error("WebRTC signaling error:", err));
    });

    return () => {
      socket.emit("room:leave");
      socket.disconnect();
      pcs.forEach((entry) => entry.pc.close());
      pcs.clear();
      socketRef.current = null;
    };
  }, [roomId, enabled]);

  // Send our current camera/mic tracks to every peer
  useEffect(() => {
    tracksRef.current = tracks;
    pcsRef.current.forEach((entry) => syncSenders(entry, tracks));
  }, [tracks]);

  // Let everyone show our mute / camera-off state
  useEffect(() => {
    stateRef.current = { mic, camera };
    socketRef.current?.emit("peer:state", { mic, camera });
  }, [mic, camera]);

  // After a sign-in/auth error, try again (uses the latest token)
  const retry = useCallback(() => {
    setStatus("connecting");
    setError(null);
    socketRef.current?.connect();
  }, []);

  // Send a reaction to everyone else in the room (the server checks the key)
  const sendReaction = useCallback((key) => {
    socketRef.current?.emit("reaction", key);
  }, []);

  // Tell everyone else in the room we're typing in the chat (or stopped)
  const sendTyping = useCallback((typing) => {
    socketRef.current?.emit("chat:typing", Boolean(typing));
  }, []);

  // Screen sharing — the server checks who may share (host, or allowed)
  const startShare = useCallback(
    () =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) return resolve({ error: "Not connected to the session." });
        const timer = setTimeout(
          () => resolve({ error: "The session didn't answer. Please try again." }),
          SHARE_ACK_TIMEOUT_MS,
        );
        socket.emit("share:start", (res) => {
          clearTimeout(timer);
          resolve(res || {});
        });
      }),
    [],
  );
  const stopShare = useCallback(() => socketRef.current?.emit("share:stop"), []);
  // Host only: tell everyone recording started / stopped (the server checks)
  const startRec = useCallback(
    () =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) return resolve({ error: "Not connected to the session." });
        const timer = setTimeout(
          () => resolve({ error: "The session didn't answer. Please try again." }),
          SHARE_ACK_TIMEOUT_MS,
        );
        socket.emit("rec:start", (res) => {
          clearTimeout(timer);
          resolve(res || {});
        });
      }),
    [],
  );
  const stopRec = useCallback(() => socketRef.current?.emit("rec:stop"), []);
  // Host only: let someone share their screen (or take it back)
  const allowShare = useCallback(
    (userId, allow) => socketRef.current?.emit("share:allow", { userId, allow }),
    [],
  );

  return {
    share: enabled ? share : NO_SHARE,
    rec: enabled ? rec : NO_REC,
    startRec,
    stopRec,
    selfId,
    startShare,
    stopShare,
    allowShare,
    sendReaction,
    sendTyping,
    peers: enabled ? Object.values(peers) : [],
    status: enabled ? status : "idle",
    error,
    retry,
  };
}

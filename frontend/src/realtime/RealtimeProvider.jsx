import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "../auth/useAuth";
import { API_BASE } from "../utils/api";
import { RealtimeContext } from "./useRealtime";
import { resetPhotoVersions, setPhotoVersion } from "../utils/photos";

// One Socket.IO connection for the whole dashboard. The server puts it in a
// private room for the signed-in user and pushes events such as
// "connects:changed" (see backend/services/realtime.js). Components listen
// with subscribe(event, handler), which returns an unsubscribe function.
//
// After a dropped connection comes back, listeners of "realtime:reconnected"
// are called so they can reload anything they may have missed meanwhile.
//
// It also keeps shared profile state in sync everywhere:
//   member:photo     { id, photoV }  → every avatar of that person updates
//   member:updated   { member }      → someone edited their profile; their
//                                      photo version updates here, and
//                                      screens patch their lists
//                                      (hooks/useMemberUpdates.js)
//   profile:updated  { user }        → your own account (skills, details…)
//                                      changed in another tab or device

export default function RealtimeProvider({ children }) {
  const { accessToken, user, updateUser } = useAuth();
  const [connected, setConnected] = useState(false);
  const tokenRef = useRef(accessToken);
  const socketRef = useRef(null);
  const listenersRef = useRef(new Map());

  const dispatch = useCallback((event, payload) => {
    listenersRef.current.get(event)?.forEach((handler) => handler(payload));
  }, []);

  useEffect(() => {
    tokenRef.current = accessToken;
    // The server turned us away (e.g. token expired) — retry with the new one
    const socket = socketRef.current;
    if (accessToken && socket && !socket.connected && !socket.active) {
      socket.connect();
    }
  }, [accessToken]);

  useEffect(() => {
    let connectedBefore = false;
    const socket = io(API_BASE, {
      // A function, so every (re)connect sends the latest access token
      auth: (cb) => cb({ token: tokenRef.current }),
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      if (connectedBefore) dispatch("realtime:reconnected");
      connectedBefore = true;
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.onAny((event, payload) => dispatch(event, payload));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [dispatch]);

  const subscribe = useCallback((event, handler) => {
    const listeners = listenersRef.current;
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event)?.delete(handler);
  }, []);

  // Your own photo version is known from your account
  const myId = user?.id;
  const myPhotoV = user?.photoV;
  useEffect(() => {
    if (myId) setPhotoVersion(myId, myPhotoV);
  }, [myId, myPhotoV]);

  // Latest updateUser (AuthProvider recreates it each render)
  const updateUserRef = useRef(updateUser);
  useEffect(() => {
    updateUserRef.current = updateUser;
  }, [updateUser]);

  useEffect(() => {
    const offPhoto = subscribe("member:photo", ({ id, photoV } = {}) =>
      setPhotoVersion(id, photoV),
    );
    const offMember = subscribe("member:updated", ({ member } = {}) => {
      if (member?.id && "photoV" in member) setPhotoVersion(member.id, member.photoV);
    });
    const offProfile = subscribe("profile:updated", ({ user: next } = {}) => {
      if (next) updateUserRef.current(next);
    });
    const offReconnect = subscribe("realtime:reconnected", () =>
      resetPhotoVersions(myId),
    );
    return () => {
      offPhoto();
      offMember();
      offProfile();
      offReconnect();
    };
  }, [subscribe, myId]);

  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

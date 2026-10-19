import { useCallback, useEffect, useRef, useState } from "react";

// Camera + microphone for Live Sessions, through the Navigator MediaDevices
// API. Nothing turns on by itself — the caller decides when. Flow:
//   1. Check the Permissions API (no browser prompt yet) → `permission`
//   2. When a video session starts, the UI calls request() — straight away
//      if access was allowed before, otherwise after explaining why. That
//      opens the browser's own permission prompt (getUserMedia)
//   3. On success the tracks are in `tracks`; mic/camera can be toggled
//   4. release() turns everything off again (e.g. everyone else left)
// Every track is stopped (camera light off) when turned off or on unmount.
//
// Settings (the Settings panel): which camera / microphone to use, and how
// the mic is processed — "Original sound" (no filters, for music) or the
// usual echo cancellation + noise reduction. Changes apply to the live
// devices straight away and are remembered on this device (localStorage).

const VIDEO = {
  facingMode: "user",
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

const PREFS_KEY = "skillswap.mediaPrefs";
const DEFAULT_PREFS = { originalSound: false, noiseReduction: true, cameraId: "", micId: "" };

function readPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return {
      originalSound: saved.originalSound === true,
      noiseReduction: saved.noiseReduction !== false,
      cameraId: typeof saved.cameraId === "string" ? saved.cameraId.slice(0, 256) : "",
      micId: typeof saved.micId === "string" ? saved.micId.slice(0, 256) : "",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode / blocked storage: settings just aren't remembered
  }
}

// Mic processing. Original sound turns every filter off.
function audioConstraints(prefs, exactId) {
  const processing = !prefs.originalSound;
  const id = exactId || prefs.micId;
  return {
    echoCancellation: processing,
    noiseSuppression: processing && prefs.noiseReduction,
    autoGainControl: processing,
    ...(id && { deviceId: exactId ? { exact: id } : { ideal: id } }),
  };
}

function videoConstraints(prefs, exactId) {
  const id = exactId || prefs.cameraId;
  return { ...VIDEO, ...(id && { deviceId: exactId ? { exact: id } : { ideal: id } }) };
}

// Did the browser apply the processing we asked for to this live track?
function processingMatches(track, wanted) {
  const now = track.getSettings?.() || {};
  return ["echoCancellation", "noiseSuppression", "autoGainControl"].every(
    (key) => now[key] === undefined || now[key] === wanted[key],
  );
}

const DEVICE_NAMES = { videoinput: "Camera", audioinput: "Microphone", audiooutput: "Speaker" };
const NO_DEVICES = { cameras: [], mics: [], speakers: [] };

// getUserMedia only exists in secure contexts (HTTPS or localhost).
const mediaSupported =
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

function mediaErrorMessage(err) {
  if (!mediaSupported) {
    return typeof window !== "undefined" && !window.isSecureContext
      ? "Camera and microphone need a secure (HTTPS) connection."
      : "This browser doesn't support camera or microphone access.";
  }
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Access to your camera and microphone was blocked.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera or microphone was found on this device.";
    case "NotReadableError":
    case "AbortError":
      return "Your camera or microphone is being used by another app.";
    default:
      return "Couldn't start your camera or microphone.";
  }
}

// Asks for both; if one device is missing or busy, falls back to whichever
// one works so the user can still join.
async function getMedia(prefs) {
  const gum = (c) => navigator.mediaDevices.getUserMedia(c);
  const VIDEO_C = videoConstraints(prefs);
  const AUDIO_C = audioConstraints(prefs);
  try {
    return await gum({ video: VIDEO_C, audio: AUDIO_C });
  } catch (err) {
    const recoverable = [
      "NotFoundError",
      "OverconstrainedError",
      "NotReadableError",
    ];
    if (!recoverable.includes(err?.name)) throw err;
    for (const constraints of [{ video: VIDEO_C }, { audio: AUDIO_C }]) {
      try {
        return await gum(constraints);
      } catch {
        // try the next device
      }
    }
    throw err;
  }
}

// "granted" only when both are granted; "denied" if either is blocked.
// Browsers without the Permissions API (or without the "camera" name, like
// Firefox) report null, which counts as "prompt".
function combinePermissions(statuses) {
  const states = statuses.map((s) => s?.state ?? "prompt");
  if (states.includes("denied")) return "denied";
  if (states.every((s) => s === "granted")) return "granted";
  return "prompt";
}

function queryPermission(name) {
  if (!navigator.permissions?.query) return Promise.resolve(null);
  return navigator.permissions.query({ name }).catch(() => null);
}

export function useLocalMedia() {
  // checking | prompt | granted | denied | unsupported
  const [permission, setPermission] = useState(
    mediaSupported ? "checking" : "unsupported",
  );
  // idle | requesting | ready | skipped | error
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const [tracks, setTracks] = useState({ audio: null, video: null });
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  // Problem turning a device on mid-session (shown on the self-view tile)
  const [deviceError, setDeviceError] = useState(null);
  // Settings: saved device choices + mic processing, and what's plugged in
  const [prefs, setPrefs] = useState(readPrefs);
  const prefsRef = useRef(prefs);
  const [devices, setDevices] = useState(NO_DEVICES);

  const tracksRef = useRef(tracks);
  const wantRef = useRef({ mic, camera });
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);
  useEffect(() => {
    wantRef.current = { mic, camera };
  }, [mic, camera]);

  // Stop everything when leaving the session. `aliveRef` also lets a
  // request that finishes after leaving release its devices straight away.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      tracksRef.current.audio?.stop();
      tracksRef.current.video?.stop();
    };
  }, []);

  const adopt = useCallback((kind, track) => {
    // e.g. camera unplugged or permission revoked mid-session
    track?.addEventListener("ended", () => {
      setTracks((t) => (t[kind] === track ? { ...t, [kind]: null } : t));
      (kind === "video" ? setCamera : setMic)(false);
    });
    setTracks((t) => {
      if (t[kind] && t[kind] !== track) t[kind].stop();
      return { ...t, [kind]: track };
    });
  }, []);

  // Opens the browser's permission prompt (or uses an existing grant).
  const request = useCallback(async () => {
    if (!mediaSupported) {
      setPhase("error");
      setError({ name: "NotSupportedError", message: mediaErrorMessage() });
      return;
    }
    setPhase("requesting");
    setError(null);
    try {
      const stream = await getMedia(prefsRef.current);
      if (!aliveRef.current) return stream.getTracks().forEach((t) => t.stop());
      const audio = stream.getAudioTracks()[0] || null;
      let video = stream.getVideoTracks()[0] || null;
      const want = wantRef.current;

      if (audio) audio.enabled = want.mic;
      if (video && !want.camera) {
        video.stop();
        video = null;
      }
      adopt("audio", audio);
      adopt("video", video);
      setMic(Boolean(audio) && want.mic);
      setCamera(Boolean(video));
      setDeviceError(
        !audio
          ? "No microphone found."
          : !stream.getVideoTracks().length
            ? "No camera found."
            : null,
      );
      setPhase("ready");
    } catch (err) {
      if (err?.name === "NotAllowedError") setPermission("denied");
      setError({ name: err?.name, message: mediaErrorMessage(err) });
      setPhase("error");
    }
  }, [adopt]);

  // Join the session without a camera or mic (can still see/hear others).
  const skip = useCallback(() => {
    setMic(false);
    setCamera(false);
    setError(null);
    setPhase("skipped");
  }, []);

  // Check the current permission state without prompting. Also follows
  // changes, e.g. the user unblocks the site from the address bar.
  useEffect(() => {
    if (!mediaSupported) return;
    let cancelled = false;
    let statuses = [];

    Promise.all([queryPermission("camera"), queryPermission("microphone")]).then(
      (results) => {
        if (cancelled) return;
        statuses = results;
        const update = () => setPermission(combinePermissions(results));
        results.forEach((s) => s && (s.onchange = update));
        update();
      },
    );

    return () => {
      cancelled = true;
      statuses.forEach((s) => s && (s.onchange = null));
    };
  }, []);

  // Turning a device on asks for just that device; turning it off stops the
  // camera completely (light off) but only mutes the mic track.
  const enable = useCallback(
    async (kind) => {
      setDeviceError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          kind === "video"
            ? { video: videoConstraints(prefsRef.current) }
            : { audio: audioConstraints(prefsRef.current) },
        );
        if (!aliveRef.current) return stream.getTracks().forEach((t) => t.stop());
        const track =
          kind === "video"
            ? stream.getVideoTracks()[0]
            : stream.getAudioTracks()[0];
        adopt(kind, track);
        (kind === "video" ? setCamera : setMic)(true);
      } catch (err) {
        setDeviceError(mediaErrorMessage(err));
        (kind === "video" ? setCamera : setMic)(false);
      }
    },
    [adopt],
  );

  // Devices have been dealt with (started, or the user chose to skip them)
  const active = phase === "ready" || phase === "skipped";

  // Stop the camera and mic (light off) and go back to "not started". The
  // mic/camera on-off choices are kept for next time.
  const release = useCallback(() => {
    tracksRef.current.audio?.stop();
    tracksRef.current.video?.stop();
    setTracks({ audio: null, video: null });
    setDeviceError(null);
    setPhase((p) => (p === "ready" ? "idle" : p));
  }, []);

  const toggleMic = useCallback(() => {
    const track = tracksRef.current.audio;
    if (!active) return setMic((m) => !m);
    if (track) {
      track.enabled = !mic;
      setMic(!mic);
    } else if (!mic && mediaSupported) {
      enable("audio");
    }
  }, [active, mic, enable]);

  const toggleCamera = useCallback(() => {
    if (!active) return setCamera((c) => !c);
    if (camera) {
      tracksRef.current.video?.stop();
      setTracks((t) => ({ ...t, video: null }));
      setCamera(false);
      setDeviceError(null);
    } else if (mediaSupported) {
      enable("video");
    }
  }, [active, camera, enable]);

  // What's plugged in. Names only show once access was allowed, so this
  // refreshes when devices start, and when something is (un)plugged.
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    let cancelled = false;
    const refresh = () =>
      md
        .enumerateDevices()
        .then((list) => {
          if (cancelled) return;
          const pick = (kind) =>
            list
              .filter((d) => d.kind === kind && d.deviceId)
              .map((d, i) => ({ id: d.deviceId, label: d.label || `${DEVICE_NAMES[kind]} ${i + 1}` }));
          setDevices({ cameras: pick("videoinput"), mics: pick("audioinput"), speakers: pick("audiooutput") });
        })
        .catch(() => {});
    refresh();
    md.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      md.removeEventListener?.("devicechange", refresh);
    };
  }, [tracks.audio, tracks.video]);

  const updatePrefs = useCallback((patch) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    savePrefs(next);
    return next;
  }, []);

  // Reopen one device with new constraints and swap it in (peers get the
  // new track without renegotiating)
  const reopen = useCallback(
    async (kind, constraints) => {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === "video" ? { video: constraints } : { audio: constraints },
      );
      if (!aliveRef.current) return stream.getTracks().forEach((t) => t.stop());
      const track = kind === "video" ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
      if (kind === "audio") track.enabled = wantRef.current.mic;
      adopt(kind, track);
    },
    [adopt],
  );

  // Original sound / noise reduction. Tries to change the live mic in
  // place; browsers that can't, get the mic reopened with the new filters.
  const setAudioOptions = useCallback(
    async (patch) => {
      const next = updatePrefs(patch);
      const track = tracksRef.current.audio;
      if (!track || track.readyState !== "live") return;
      setDeviceError(null);
      const micId = track.getSettings?.().deviceId;
      const wanted = audioConstraints(next, micId);
      try {
        await track.applyConstraints(wanted);
        if (processingMatches(track, wanted)) return;
      } catch {
        // fall through to reopening
      }
      try {
        await reopen("audio", wanted);
      } catch (err) {
        setDeviceError(mediaErrorMessage(err));
      }
    },
    [updatePrefs, reopen],
  );

  // Pick a camera / microphone. Switches now if it's on; otherwise it's
  // used next time it turns on.
  const chooseDevice = useCallback(
    async (kind, id) => {
      updatePrefs(kind === "video" ? { cameraId: id } : { micId: id });
      const track = tracksRef.current[kind];
      if (!track || track.readyState !== "live" || track.getSettings?.().deviceId === id) return;
      setDeviceError(null);
      try {
        await reopen(
          kind,
          kind === "video"
            ? videoConstraints(prefsRef.current, id)
            : audioConstraints(prefsRef.current, id),
        );
      } catch (err) {
        setDeviceError(mediaErrorMessage(err));
      }
    },
    [updatePrefs, reopen],
  );

  // The device actually in use (falls back to the saved choice)
  const cameraId = tracks.video?.getSettings?.().deviceId || prefs.cameraId;
  const micId = tracks.audio?.getSettings?.().deviceId || prefs.micId;

  return {
    prefs,
    devices,
    cameraId,
    micId,
    setAudioOptions,
    chooseCamera: (id) => chooseDevice("video", id),
    chooseMic: (id) => chooseDevice("audio", id),
    permission,
    phase,
    error,
    active,
    tracks,
    mic,
    camera,
    deviceError,
    request,
    skip,
    release,
    toggleMic,
    toggleCamera,
  };
}

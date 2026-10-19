import { colorOf, initialsOf } from "./people";

// Records a Live Session in the host's browser and saves it to their
// computer. Everyone in the call is drawn onto one canvas — cameras, or a
// name + initials card when a camera is off, with the presenter's screen
// large when someone is sharing — and every voice is mixed into one track.
// MediaRecorder turns that into a video file, downloaded when it stops
// (it lands in the browser's Downloads folder).
//
//   const recording = startSessionRecording({ getTiles, title });
//   …
//   const { fileName } = await recording.stop();   // saves the file
//   recording.cancel();                             // stops, saves nothing
//
// getTiles() is called every frame and returns who to draw:
//   [{ key, name, userId, stream, showVideo, presenting }]

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const GAP = 8;
const MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
];

export const recordingSupported =
  typeof window !== "undefined" &&
  typeof window.MediaRecorder !== "undefined" &&
  typeof HTMLCanvasElement !== "undefined" &&
  typeof HTMLCanvasElement.prototype.captureStream === "function" &&
  Boolean(window.AudioContext || window.webkitAudioContext);

function pickMimeType() {
  return MIME_TYPES.find((type) => window.MediaRecorder.isTypeSupported?.(type)) || "";
}

function fileNameFor(title, mimeType) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const safeTitle = (title || "session").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "session";
  return `SkillSwap-${safeTitle}-${stamp}.${mimeType.includes("mp4") ? "mp4" : "webm"}`;
}

function saveFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download time to start before freeing the memory
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Draw `source` (video) to fill the box: crop (cover) or letterbox (contain)
function drawFitted(ctx, source, x, y, w, h, contain) {
  const sw = source.videoWidth;
  const sh = source.videoHeight;
  if (!sw || !sh) return false;
  const scale = contain ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
  return true;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function drawTile(ctx, tile, video, x, y, w, h) {
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = tile.presenting ? "#000" : "#151514";
  ctx.fill();

  const drewVideo =
    tile.showVideo && video && video.readyState >= 2 && drawFitted(ctx, video, x, y, w, h, tile.presenting);

  if (!drewVideo) {
    // Camera off: their initials in a circle
    const r = Math.max(18, Math.min(w, h) * 0.16);
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2 - 8, r, 0, Math.PI * 2);
    ctx.fillStyle = colorOf(tile.userId || tile.key);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.font = `800 ${Math.round(r * 0.8)}px "DM Sans", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsOf(tile.name), x + w / 2, y + h / 2 - 8);
  }

  // Name label
  const label = tile.presenting ? `${tile.name} · Presenting` : tile.name;
  const size = Math.max(11, Math.min(16, Math.round(h / 18)));
  ctx.font = `700 ${size}px "DM Sans", system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const text = label.length > 40 ? `${label.slice(0, 39)}…` : label;
  const tw = Math.min(ctx.measureText(text).width, w - 32);
  roundRect(ctx, x + 10, y + h - size - 22, tw + 20, size + 12, 8);
  ctx.fillStyle = "rgba(10,10,10,0.72)";
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x + 20, y + h - size / 2 - 16, w - 40);
}

// Same layouts as the call: a grid, or the presenter big with everyone
// else in a strip underneath
function layout(tiles) {
  const boxes = [];
  const inner = { x: GAP, y: GAP, w: WIDTH - GAP * 2, h: HEIGHT - GAP * 2 };
  const presenter = tiles.find((t) => t.presenting);
  if (presenter && tiles.length > 1) {
    const others = tiles.filter((t) => t !== presenter);
    const mainH = Math.round(inner.h * 0.76);
    boxes.push([presenter, inner.x, inner.y, inner.w, mainH]);
    const stripY = inner.y + mainH + GAP;
    const stripH = inner.h - mainH - GAP;
    const each = (inner.w - GAP * (others.length - 1)) / others.length;
    others.forEach((t, i) => boxes.push([t, inner.x + i * (each + GAP), stripY, each, stripH]));
    return boxes;
  }
  const n = Math.max(tiles.length, 1);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const w = (inner.w - GAP * (cols - 1)) / cols;
  const h = (inner.h - GAP * (rows - 1)) / rows;
  tiles.forEach((t, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    // Centre a short last row
    const offset = ((cols - inRow) * (w + GAP)) / 2;
    boxes.push([t, inner.x + offset + (i % cols) * (w + GAP), inner.y + row * (h + GAP), w, h]);
  });
  return boxes;
}

export function startSessionRecording({ getTiles, title }) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");

  // Off-screen <video> per stream, to draw frames from
  const videos = new Map(); // key → { el, stream }
  const syncVideos = (tiles) => {
    const keys = new Set();
    for (const tile of tiles) {
      if (!tile.stream || !tile.showVideo) continue;
      keys.add(tile.key);
      const current = videos.get(tile.key);
      if (current?.stream === tile.stream) continue;
      const el = current?.el || document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      el.srcObject = tile.stream;
      el.play().catch(() => {});
      videos.set(tile.key, { el, stream: tile.stream });
    }
    for (const [key, { el }] of videos) {
      if (!keys.has(key)) {
        el.srcObject = null;
        videos.delete(key);
      }
    }
  };

  // Every voice mixed into one audio track
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  audioCtx.resume().catch(() => {});
  const mix = audioCtx.createMediaStreamDestination();
  const voices = new Map(); // track id → source node
  const syncAudio = (tiles) => {
    const live = new Set();
    for (const tile of tiles) {
      for (const track of tile.stream?.getAudioTracks() || []) {
        if (track.readyState !== "live") continue;
        live.add(track.id);
        if (voices.has(track.id)) continue;
        try {
          const node = audioCtx.createMediaStreamSource(new MediaStream([track]));
          node.connect(mix);
          voices.set(track.id, node);
        } catch {
          // a track the browser won't mix — skip it
        }
      }
    }
    for (const [id, node] of voices) {
      if (!live.has(id)) {
        node.disconnect();
        voices.delete(id);
      }
    }
  };

  const draw = () => {
    const tiles = getTiles() || [];
    syncVideos(tiles);
    syncAudio(tiles);
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const [tile, x, y, w, h] of layout(tiles)) {
      drawTile(ctx, tile, videos.get(tile.key)?.el, x, y, w, h);
    }
  };
  draw();
  const timer = setInterval(draw, 1000 / FPS);

  const output = new MediaStream([
    ...canvas.captureStream(FPS).getVideoTracks(),
    ...mix.stream.getAudioTracks(),
  ]);
  const mimeType = pickMimeType();
  const recorder = new window.MediaRecorder(output, {
    ...(mimeType && { mimeType }),
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
  recorder.start(1000); // a chunk every second, so little is lost if the tab crashes

  let finished = false;
  const cleanup = () => {
    clearInterval(timer);
    output.getTracks().forEach((t) => t.stop());
    voices.forEach((node) => node.disconnect());
    voices.clear();
    videos.forEach(({ el }) => (el.srcObject = null));
    videos.clear();
    audioCtx.close().catch(() => {});
  };

  const finish = (save) =>
    new Promise((resolve) => {
      if (finished) return resolve(null);
      finished = true;
      recorder.onstop = () => {
        cleanup();
        if (!save || chunks.length === 0) return resolve(null);
        const type = recorder.mimeType || mimeType || "video/webm";
        const blob = new Blob(chunks, { type });
        const fileName = fileNameFor(title, type);
        saveFile(blob, fileName);
        resolve({ fileName, size: blob.size });
      };
      if (recorder.state === "inactive") recorder.onstop();
      else recorder.stop();
    });

  return {
    stop: () => finish(true),
    cancel: () => finish(false),
  };
}

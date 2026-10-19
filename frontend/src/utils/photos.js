import { useSyncExternalStore } from "react";
import { API_BASE } from "./api";

// Shared profile photos. Every person the API returns carries `photoV`
// (their photo's version, or null for no photo); the image itself comes from
// GET /avatars/:id?v=<photoV>. This store holds versions learned *live* —
// your own uploads and "member:photo" socket events — which win over the
// (possibly older) photoV a list was loaded with. So when anyone changes
// their photo, every avatar of them in the app updates at once.

const versions = new Map(); // userId → photoV (number) or null
const listeners = new Set();

const notify = () => listeners.forEach((listener) => listener());

export function setPhotoVersion(userId, photoV) {
  if (!userId) return;
  const id = String(userId);
  const next = photoV || null;
  if (versions.has(id) && versions.get(id) === next) return;
  versions.set(id, next);
  notify();
}

// After a reconnect, lists reload with fresh data — drop live overrides
// (except your own) so a missed event can't leave an old photo showing.
export function resetPhotoVersions(keepUserId) {
  const keep = keepUserId ? versions.get(String(keepUserId)) : undefined;
  versions.clear();
  if (keep !== undefined) versions.set(String(keepUserId), keep);
  notify();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The photo version to show for someone: the live one if known, else the
// one their data came with
export function usePhotoVersion(userId, hint) {
  const id = userId ? String(userId) : "";
  const live = useSyncExternalStore(subscribe, () =>
    versions.has(id) ? versions.get(id) : undefined,
  );
  return live === undefined ? hint || null : live;
}

export const photoUrl = (userId, photoV) =>
  `${API_BASE}/avatars/${encodeURIComponent(userId)}?v=${photoV}`;

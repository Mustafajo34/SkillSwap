import { lazy } from "react";

// Loading dashboard tabs on demand, safely.
//
// A tab's file can fail to download: a network blip, or — after a new
// version is deployed — the old file names no longer exist on the server.
// loadWithRetry() tries again once after a short pause; if the file is still
// missing it reloads the page once to pick up the new version (guarded so it
// can never loop, and skipped while offline). Anything else is thrown, and
// the tab's error boundary (components/TabErrorBoundary.jsx) shows a retry.

const RETRY_DELAY_MS = 900;
const RELOAD_KEY = "skillswap-chunk-reload";
const RELOAD_WINDOW_MS = 30_000;

// What browsers say when a lazily-loaded file can't be fetched
const CHUNK_ERROR_RE =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk|Unable to preload CSS/i;

const isChunkLoadError = (error) => CHUNK_ERROR_RE.test(String(error?.message || error));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function reloadedRecently() {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_KEY));
    return Number.isFinite(at) && Date.now() - at < RELOAD_WINDOW_MS;
  } catch {
    return true; // can't remember → don't risk a reload loop
  }
}

function markReload() {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

async function loadWithRetry(load) {
  try {
    return await load();
  } catch (firstError) {
    await wait(RETRY_DELAY_MS);
    try {
      return await load();
    } catch (error) {
      const online = typeof navigator === "undefined" || navigator.onLine !== false;
      if (isChunkLoadError(error) && online && !reloadedRecently() && markReload()) {
        window.location.reload();
        return new Promise(() => {}); // the page is reloading
      }
      throw error || firstError;
    }
  }
}

// A lazy component that retries; make a fresh one to retry after a failure
// (React remembers a failed lazy load, so the old one can't try again).
export const lazyWithRetry = (load) => lazy(() => loadWithRetry(load));

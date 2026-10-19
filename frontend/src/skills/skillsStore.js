import { useSyncExternalStore } from "react";

// The skills editor's state (Edit Profile): the skill picked in the "add"
// box, its level, and any unsaved edits to your list. Kept outside the
// component so it survives leaving the page and coming back. Saved skills
// themselves live on your account (useAuth), shared across the app.

let state = {
  draft: null, // your edited list, or null when there are no unsaved changes
  pick: { name: "", level: "Intermediate" },
};
const listeners = new Set();

export function updateSkillsEditor(change) {
  state = { ...state, ...(typeof change === "function" ? change(state) : change) };
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useSkillsEditor = () => useSyncExternalStore(subscribe, () => state);

// Skill names and levels, fetched once and shared
let catalog = null;
let catalogRequest = null;
export function loadSkillCatalog(fetchCatalog) {
  if (catalog) return Promise.resolve(catalog);
  if (!catalogRequest) {
    catalogRequest = fetchCatalog()
      .then((data) => (catalog = { skills: data.skills, levels: data.levels }))
      .finally(() => {
        catalogRequest = null;
      });
  }
  return catalogRequest;
}
export const cachedSkillCatalog = () => catalog;

// Shared helpers for showing members (Browse Skills, My Skills), so the same
// person gets the same initials and avatar colour everywhere.

const AVATAR_COLORS = [
  "#e4b743",
  "#b1ada4",
  "#f6d878",
  "#817d76",
  "#d9a441",
  "#c9c4b8",
  "#efcb6a",
  "#9a958c",
];

export const initialsOf = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

// A member's public card changed (they edited their profile, or their
// rating / swap count moved — see the "member:updated" event). Copies the
// new details onto our copy of them and keeps everything else (connect
// status, …). Only the fields the event carries are copied.
const CARD_FIELDS = [
  "name",
  "userName",
  "occupation",
  "location",
  "bio",
  "skills",
  "photoV",
  "swaps",
  "rating",
  "reviews",
];

export function patchMember(member, update) {
  if (!member || !update || member.id !== update.id) return member;
  const next = { ...member };
  for (const key of CARD_FIELDS) if (key in update) next[key] = update[key];
  return next;
}

// Same for a list; returns the same array when they aren't in it (no re-render)
export function patchMembers(list, update) {
  if (!Array.isArray(list) || !list.some((m) => m?.id === update?.id)) return list;
  return list.map((m) => patchMember(m, update));
}

export const colorOf = (id = "") =>
  AVATAR_COLORS[
    [...String(id)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) %
      AVATAR_COLORS.length
  ];

import { useEffect, useRef } from "react";
import { useRealtime } from "../realtime/useRealtime";

// Calls onUpdate(member) whenever someone edits their profile (bio,
// username, occupation, skills, photo…), live from the server's
// "member:updated" event. Pair it with patchMember / patchMembers from
// utils/people.js to update the lists a screen is showing.
export function useMemberUpdates(onUpdate) {
  const { subscribe } = useRealtime();
  const handler = useRef(onUpdate);
  useEffect(() => {
    handler.current = onUpdate;
  }, [onUpdate]);

  useEffect(
    () =>
      subscribe("member:updated", (event) => {
        const member = event?.member;
        if (member && typeof member.id === "string") handler.current?.(member);
      }),
    [subscribe],
  );
}

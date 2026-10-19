// Text and state helpers for notifications (bell, toasts, call alert).

export function describeNotification(n) {
  const name = n.actor?.name || "Someone";
  switch (n.type) {
    case "session_invite":
      return `${name} wants to video chat with you`;
    case "session_response":
      return n.data?.response === "accept"
        ? `${name} accepted your video invite`
        : `${name} declined your video invite`;
    case "session_link_join":
      return `${name} is joining your session with your invite link`;
    case "connect_request":
      return `${name} wants to connect with you`;
    case "connect_accept":
      return `${name} accepted your connect request`;
    case "session_rating":
      return n.data?.rating
        ? `${name} rated your session ${"★".repeat(n.data.rating)}`
        : `${name} rated your session`;
    case "session_recording":
      return `${name} started recording a video session you're in`;
    case "swap_request":
      return n.data?.offer && n.data?.want
        ? `${name} wants to swap ${n.data.offer} for your ${n.data.want}`
        : `${name} proposed a skill swap`;
    case "swap_response":
      return (
        {
          accept: `${name} accepted your skill swap`,
          decline: `${name} declined your skill swap`,
          cancel: `${name} called off your skill swap`,
          complete: `${name} marked your skill swap complete — rate it!`,
        }[n.data?.response] || `${name} updated your skill swap`
      );
    default:
      return "New notification";
  }
}

// Can this video invite still be joined? Not once the call has ended or
// the session has expired.
export const isSessionInviteActive = (n) =>
  n.type === "session_invite" &&
  !n.data?.endedAt &&
  (!n.data?.sessionExpiresAt || new Date(n.data.sessionExpiresAt) > new Date());

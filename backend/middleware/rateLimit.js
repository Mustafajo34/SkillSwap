const { rateLimit } = require("express-rate-limit");

// Limits are per IP address. Responses are JSON with a `message`, which the
// frontend shows to the user.
const limiter = (windowMs, limit, message, options = {}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res, next, opts) =>
      res.status(opts.statusCode).json({ message }),
    ...options,
  });

// Slows down password guessing. Successful sign-ins don't count.
const signinLimiter = limiter(
  15 * 60 * 1000,
  10,
  "Too many sign-in attempts. Please try again in 15 minutes.",
  { skipSuccessfulRequests: true },
);

const signupLimiter = limiter(
  60 * 60 * 1000,
  20,
  "Too many sign-up attempts. Please try again later.",
);

// The signup form checks usernames as the user types (debounced)
const usernameCheckLimiter = limiter(
  60 * 1000,
  60,
  "Too many requests. Please slow down.",
);

// Stops friend-request spam (sending, re-sending after cancelling, …)
const friendRequestLimiter = limiter(
  15 * 60 * 1000,
  60,
  "Too many friend requests. Please try again later.",
);

const profileUpdateLimiter = limiter(
  15 * 60 * 1000,
  30,
  "Too many profile updates. Please try again later.",
);

// Guessing the current password on the change-password form. Successful
// changes don't count.
const passwordChangeLimiter = limiter(
  15 * 60 * 1000,
  10,
  "Too many password attempts. Please try again in 15 minutes.",
  { skipSuccessfulRequests: true },
);

// Starting sessions, joining by invite link and sending session invites
const sessionLimiter = limiter(
  15 * 60 * 1000,
  60,
  "Too many session requests. Please try again later.",
);

// Message board: new posts/replies, and image uploads
const boardPostLimiter = limiter(
  15 * 60 * 1000,
  60,
  "You're posting very quickly. Please wait a few minutes.",
);
const boardUploadLimiter = limiter(
  15 * 60 * 1000,
  60,
  "Too many image uploads. Please wait a few minutes.",
);

// Skill swaps: proposing, answering, completing and rating
const swapLimiter = limiter(
  15 * 60 * 1000,
  120,
  "Too many swap updates. Please try again later.",
);

// Live Session notes: the host adding/removing links and files
const sessionNotesLimiter = limiter(
  15 * 60 * 1000,
  120,
  "You're adding notes very quickly. Please wait a few minutes.",
);

// Live Session chat: messages and reactions
const sessionChatLimiter = limiter(
  5 * 60 * 1000,
  300,
  "You're sending messages very quickly. Please slow down a little.",
);

module.exports = {
  sessionChatLimiter,
  sessionNotesLimiter,
  swapLimiter,
  boardPostLimiter,
  boardUploadLimiter,
  passwordChangeLimiter,
  sessionLimiter,
  signinLimiter,
  signupLimiter,
  usernameCheckLimiter,
  friendRequestLimiter,
  profileUpdateLimiter,
};

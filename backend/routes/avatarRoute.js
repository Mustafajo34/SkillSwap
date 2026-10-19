// Profile photos, as images: GET /avatars/:userId?v=<photoV>
//
// Public on purpose — profile photos are shown to everyone on SkillSwap, and
// an <img> tag can't send the access token. Only the photo is exposed, never
// any other account data. `v` comes from the photoV field the API returns
// for every person (null = no photo), so the browser can cache each version
// for good and fetch a new photo the moment it changes.

const router = require("express").Router();
const User = require("../models/userModel");

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

router.get("/:userId", async (req, res) => {
  const { userId } = req.params;
  if (!OBJECT_ID_RE.test(userId)) return res.sendStatus(404);
  try {
    const user = await User.findById(userId).select("avatar photoVersion").lean();
    const match = user?.avatar && DATA_URL_RE.exec(user.avatar);
    if (!match) return res.sendStatus(404);

    const etag = `"p${user.photoVersion || 0}"`;
    // The app loads <img> tags from the frontend's own address
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.set("ETag", etag);
    res.set(
      "Cache-Control",
      String(req.query.v) === String(user.photoVersion)
        ? "public, max-age=31536000, immutable" // this exact version never changes
        : "no-cache", // unversioned: check back each time (cheap 304s)
    );
    if (req.get("If-None-Match") === etag) return res.sendStatus(304);

    res.type(match[1]).send(Buffer.from(match[2], "base64"));
  } catch (error) {
    console.error("Avatar lookup failed:", error);
    res.sendStatus(500);
  }
});

module.exports = router;

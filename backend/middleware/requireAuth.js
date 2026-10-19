const jwt = require("jsonwebtoken");

// Protects a route: requires "Authorization: Bearer <access token>" (the
// frontend's authFetch adds it). On success sets req.userId and continues.
//
// Answers 401 when the token is missing, expired or invalid — the frontend
// treats a 401 as "refresh the access token and retry once".
function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Not signed in" });
  }

  try {
    const decoded = jwt.verify(token, process.env.MYACCESSKEY);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

module.exports = { requireAuth };

// Backend base URL, shared by the REST API (auth/AuthProvider.jsx) and the
// Live Sessions signaling socket. Matches backend/server.js (PORT=1989). Set
// VITE_API_URL when building for production.
export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:1989";

// Calls an API route through authFetch (adds the access token, refreshes it
// on 401) and returns the parsed JSON. Throws an Error with the server's
// `message`/`error` text (plus the HTTP `status`, and the `field` the server
// blamed, if any) when the response isn't OK.
export async function requestJson(authFetch, path, options = {}) {
  const response = await authFetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      data?.message || data?.error || "Something went wrong. Please try again.",
    );
    error.status = response.status;
    error.field = data?.field;
    throw error;
  }
  return data;
}

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useRealtime } from "../realtime/useRealtime";
import { API_BASE, requestJson } from "../utils/api";
import { checkNoteLink } from "../utils/attachments";
import { feedLinkProblem } from "../utils/contentSafety";

// Live Session → Notes panel. The host shares links, PDFs and images with
// everyone in the session (backend/routes/sessionNotesRoute.js):
//   • Host: an input bar — paste a link and press Enter/➤, or 📎 to attach
//     images/PDFs (or drop/paste files). Each note can be removed.
//     Only real web links, PDFs and images are accepted — the bar refuses
//     plain text, numbers and script (checkNoteLink; the server re-checks).
//   • Everyone else: read-only — open links, view/download images and PDFs.
// Changes show up live for everyone ("sessionNotes:changed").

const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
// The name has to match too (a renamed .exe/.svg/.html can't sneak through)
const FILE_EXTENSIONS = /\.(jpe?g|png|webp|gif|pdf)$/i;
const FILE_ACCEPT = FILE_TYPES.join(",");
const FILE_MAX_BYTES = 8 * 1024 * 1024;
const FILES_AT_ONCE = 5;

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function describeLink(url) {
  try {
    const u = new URL(url);
    const rest = `${u.pathname === "/" ? "" : u.pathname}${u.search}`;
    return { host: u.hostname.replace(/^www\./, ""), rest };
  } catch {
    return { host: url, rest: "" };
  }
}

const PATHS = {
  clip: <path d="m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6A4 4 0 1 1 18 8.8l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5" />,
  send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />,
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h4" />
    </>
  ),
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
};

function Glyph({ name, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export default function SessionNotes({ roomId, hostName }) {
  const { authFetch } = useAuth();
  const { subscribe } = useRealtime();
  const [state, setState] = useState({ status: "loading", notes: [], isHost: false, error: "" });
  const [version, setVersion] = useState(0);
  const [text, setText] = useState("");
  // Show the link problem once they've finished typing (blur / Enter)
  const [touched, setTouched] = useState(false);
  const [uploading, setUploading] = useState([]); // names being uploaded
  const [removing, setRemoving] = useState(() => new Set());
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    requestJson(authFetch, `/sessionNotes/${roomId}`, { signal: controller.signal })
      .then((data) => setState({ status: "ready", notes: data.notes, isHost: data.isHost, error: "" }))
      .catch((err) => {
        if (err.name === "AbortError") return;
        setState((s) => ({ ...s, status: s.status === "ready" ? "ready" : "error", error: err.message }));
      });
    return () => controller.abort();
  }, [authFetch, roomId, version]);

  // Live: the host added/removed something (or we reconnected)
  useEffect(() => {
    const reload = () => setVersion((v) => v + 1);
    const offChange = subscribe("sessionNotes:changed", (e) => e?.roomId === roomId && reload());
    const offReconnect = subscribe("realtime:reconnected", reload);
    return () => {
      offChange();
      offReconnect();
    };
  }, [subscribe, roomId]);

  const add = (note) => setState((s) => ({ ...s, notes: [note, ...s.notes.filter((n) => n.id !== note.id)] }));

  // Note-link rules, then phishing shapes (look-alike domains, links
  // carrying passwords / tokens) — the server checks both again
  const noteCheck = checkNoteLink(text);
  const phishing = noteCheck.url ? feedLinkProblem(noteCheck.url) : "";
  const linkCheck = phishing ? { error: phishing } : noteCheck;
  const linkProblem = text.trim() ? linkCheck.error : "";

  const addLink = async (e) => {
    e.preventDefault();
    setTouched(true);
    const { url, error: problem } = linkCheck;
    if (!url) {
      setError(`${problem} Use 📎 for PDFs and images.`);
      return;
    }
    setError("");
    try {
      const { note } = await requestJson(authFetch, `/sessionNotes/${roomId}/links`, {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      add(note);
      setText("");
      setTouched(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const uploadFiles = async (fileList) => {
    const files = [...fileList].slice(0, FILES_AT_ONCE);
    setError("");
    const problems = [];
    for (const file of files) {
      if (!FILE_TYPES.includes(file.type) || !FILE_EXTENSIONS.test(file.name)) {
        problems.push(`${file.name}: only images (JPEG, PNG, WEBP, GIF) and PDFs`);
        continue;
      }
      if (file.size > FILE_MAX_BYTES) {
        problems.push(`${file.name}: files can be up to 8 MB`);
        continue;
      }
      setUploading((u) => [...u, file.name]);
      try {
        const response = await authFetch(`${API_BASE}/sessionNotes/${roomId}/files`, {
          method: "POST",
          headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
          body: file,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.message || "Upload failed. Please try again.");
        add(data.note);
      } catch (err) {
        problems.push(`${file.name}: ${err.message}`);
      } finally {
        setUploading((u) => {
          const i = u.indexOf(file.name);
          return i === -1 ? u : [...u.slice(0, i), ...u.slice(i + 1)];
        });
      }
    }
    if (fileList.length > FILES_AT_ONCE) problems.push(`Add up to ${FILES_AT_ONCE} files at a time.`);
    if (problems.length) setError(problems.join(" · "));
  };

  const remove = async (note) => {
    setRemoving((r) => new Set(r).add(note.id));
    setError("");
    try {
      await requestJson(authFetch, `/sessionNotes/${roomId}/notes/${note.id}`, { method: "DELETE" });
      setState((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== note.id) }));
    } catch (err) {
      setError(err.message);
      if (err.status === 404) setVersion((v) => v + 1);
    } finally {
      setRemoving((r) => {
        const next = new Set(r);
        next.delete(note.id);
        return next;
      });
    }
  };

  const { isHost, notes, status } = state;
  // Drop files anywhere on the panel (host, mouse/trackpad)
  const dropProps = isHost
    ? {
        onDragOver: (e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        },
        onDragLeave: (e) => !e.currentTarget.contains(e.relatedTarget) && setDragging(false),
        onDrop: (e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
        },
      }
    : {};

  return (
    <div className={`session-notes ${dragging ? "is-dragging" : ""}`} {...dropProps}>
      {isHost ? (
        <>
          <form className="sn-bar" onSubmit={addLink}>
            <button
              type="button"
              className="sn-attach"
              onClick={() => fileInput.current?.click()}
              aria-label="Attach images or PDFs"
              title="Attach images or PDFs"
            >
              <Glyph name="clip" />
            </button>
            <input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (error) setError("");
              }}
              onBlur={() => text.trim() && setTouched(true)}
              // Pasting an image/PDF uploads it; pasted text must be a link
              onPaste={(e) => {
                const files = e.clipboardData?.files;
                if (files?.length) {
                  e.preventDefault();
                  uploadFiles(files);
                }
              }}
              aria-invalid={Boolean(touched && linkProblem) || undefined}
              aria-describedby="sn-link-problem"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="send"
              maxLength={2048}
              placeholder="Paste a link…"
              aria-label="Paste a link to share"
            />
            <button type="submit" className="sn-send" disabled={!linkCheck.url} aria-label="Share link">
              <Glyph name="send" size={16} />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={FILE_ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </form>
          {touched && linkProblem ? (
            <p className="sn-error" id="sn-link-problem" role="alert">
              {linkProblem}
            </p>
          ) : (
            <p className="sn-hint" id="sn-link-problem">
              Web links (https://…), PDFs and images up to 8 MB. Only you can add notes.
            </p>
          )}
        </>
      ) : (
        status === "ready" && (
          <p className="sn-hint">
            Shared by {hostName || "the host"} — tap a link to open it, or download files.
          </p>
        )
      )}

      {error && (
        <p className="sn-error" role="alert">
          {error}
        </p>
      )}

      {uploading.map((name, i) => (
        <div className="sn-item is-uploading" key={`${name}-${i}`} role="status">
          <span className="sn-icon">
            <i className="sn-spinner" />
          </span>
          <span className="sn-text">
            <strong>{name}</strong>
            <small>Uploading…</small>
          </span>
        </div>
      ))}

      {status === "loading" && <p className="sn-hint">Loading notes…</p>}
      {status === "error" && (
        <p className="sn-error" role="alert">
          {state.error}{" "}
          <button type="button" className="sn-retry" onClick={() => setVersion((v) => v + 1)}>
            Try again
          </button>
        </p>
      )}
      {status === "ready" && notes.length === 0 && uploading.length === 0 && (
        <p className="sn-empty">
          {isHost
            ? "Nothing shared yet. Add links, slides or images for everyone in the session."
            : "Nothing shared yet. Anything the host adds shows up here."}
        </p>
      )}

      <ul className="sn-list">
        {notes.map((note) => {
          const busy = removing.has(note.id);
          const removeButton = isHost && (
            <button
              type="button"
              className="sn-remove"
              onClick={() => remove(note)}
              disabled={busy}
              aria-label={`Remove ${note.kind === "link" ? describeLink(note.url).host : note.name}`}
            >
              <Glyph name="close" size={14} />
            </button>
          );

          if (note.kind === "link") {
            const { host, rest } = describeLink(note.url);
            return (
              <li key={note.id} className={`sn-item ${busy ? "is-busy" : ""}`}>
                <a className="sn-main" href={note.url} target="_blank" rel="noopener noreferrer nofollow">
                  <span className="sn-icon">
                    <Glyph name="link" />
                  </span>
                  <span className="sn-text">
                    <strong>{host}</strong>
                    <small>{rest || note.url}</small>
                  </span>
                </a>
                {removeButton}
              </li>
            );
          }

          const download = (
            <a
              className="sn-download"
              href={`${API_BASE}${note.downloadUrl}`}
              download={note.name}
              aria-label={`Download ${note.name}`}
              title="Download"
            >
              <Glyph name="download" size={16} />
            </a>
          );

          if (note.kind === "image") {
            return (
              <li key={note.id} className={`sn-item sn-image ${busy ? "is-busy" : ""}`}>
                <a
                  className="sn-thumb"
                  href={`${API_BASE}${note.fileUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${note.name}`}
                >
                  <img src={`${API_BASE}${note.fileUrl}`} alt={note.name} loading="lazy" decoding="async" />
                </a>
                <span className="sn-row">
                  <span className="sn-text">
                    <strong>{note.name}</strong>
                    <small>{formatSize(note.size)}</small>
                  </span>
                  {download}
                  {removeButton}
                </span>
              </li>
            );
          }

          return (
            <li key={note.id} className={`sn-item ${busy ? "is-busy" : ""}`}>
              <a className="sn-main" href={`${API_BASE}${note.downloadUrl}`} download={note.name}>
                <span className="sn-icon is-pdf">
                  <Glyph name="file" />
                </span>
                <span className="sn-text">
                  <strong>{note.name}</strong>
                  <small>PDF · {formatSize(note.size)}</small>
                </span>
              </a>
              {download}
              {removeButton}
            </li>
          );
        })}
      </ul>

      {dragging && <div className="sn-drop">Drop images or PDFs to share</div>}
    </div>
  );
}

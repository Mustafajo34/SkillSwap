import { useEffect, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { requestJson } from "../utils/api";
import {
  cachedSkillCatalog,
  loadSkillCatalog,
  updateSkillsEditor,
  useSkillsEditor,
} from "./skillsStore";

// "Skills you teach" editor, on the Edit Profile page. Its state lives in a
// shared store (skillsStore.js), so a half-finished edit survives leaving
// the page and coming back. Saving (PATCH /members/me) updates your account
// everywhere in the app — and in your other tabs, via the server's live
// "profile:updated" event.

const MAX_SKILLS = 10;

const sameSkills = (a = [], b = []) =>
  a.length === b.length && a.every((s, i) => s.name === b[i].name && s.level === b[i].level);

const fieldClass =
  "w-full min-w-0 rounded-xl border border-border bg-background px-4 py-3 text-base font-medium text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:opacity-60 sm:text-sm";

function Icon({ path, className = "size-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export default function SkillsEditor() {
  const { authFetch, user, updateUser } = useAuth();
  const { draft, pick } = useSkillsEditor();
  const [catalog, setCatalog] = useState(cachedSkillCatalog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    if (catalog) return;
    let active = true;
    loadSkillCatalog(() => requestJson(authFetch, "/members/skills"))
      .then((data) => active && setCatalog(data))
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [authFetch, catalog]);

  useEffect(() => {
    if (!savedAt) return;
    const timer = setTimeout(() => setSavedAt(0), 3000);
    return () => clearTimeout(timer);
  }, [savedAt]);

  const saved = user?.skills || [];
  const skills = draft ?? saved;
  const dirty = draft !== null && !sameSkills(draft, saved);
  const levels = catalog?.levels || [];
  const available = (catalog?.skills || []).filter((name) => !skills.some((s) => s.name === name));
  const full = skills.length >= MAX_SKILLS;

  // Every edit goes to the shared draft (an unchanged list clears it)
  const edit = (next) =>
    updateSkillsEditor({ draft: sameSkills(next, saved) ? null : next });

  const add = () => {
    if (!pick.name || full) return;
    edit([...skills, { name: pick.name, level: pick.level }]);
    updateSkillsEditor((s) => ({ pick: { ...s.pick, name: "" } }));
  };

  const save = async () => {
    setError("");
    setBusy(true);
    try {
      const data = await requestJson(authFetch, "/members/me", {
        method: "PATCH",
        body: JSON.stringify({ skills }),
      });
      updateUser({ skills: data.user.skills });
      updateSkillsEditor({ draft: null });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {skills.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          You haven’t added any skills yet — add one below so people can find you.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2.5" aria-label="Skills you teach">
          {skills.map((s) => (
            <li
              key={s.name}
              className="flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 py-1.5 pl-3.5 pr-1.5 text-sm font-bold text-foreground"
            >
              {s.name}
              <select
                aria-label={`${s.name} level`}
                value={s.level}
                onChange={(e) =>
                  edit(skills.map((x) => (x.name === s.name ? { ...x, level: e.target.value } : x)))
                }
                className="rounded-full border border-border bg-card px-2 py-1 text-[11px] font-semibold text-foreground outline-none focus:border-primary"
              >
                {(levels.length ? levels : [s.level]).map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                onClick={() => edit(skills.filter((x) => x.name !== s.name))}
                className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-red-500/15 hover:text-red-500"
              >
                <Icon path="m6 6 12 12M18 6 6 18" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px_auto]">
        <select
          aria-label="Skill to add"
          value={pick.name}
          onChange={(e) => updateSkillsEditor((s) => ({ pick: { ...s.pick, name: e.target.value } }))}
          disabled={full || !catalog}
          className={fieldClass}
        >
          <option value="">
            {full ? `You’ve added ${MAX_SKILLS} skills` : catalog ? "Choose a skill to add…" : "Loading skills…"}
          </option>
          {available.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Your level"
          value={pick.level}
          onChange={(e) => updateSkillsEditor((s) => ({ pick: { ...s.pick, level: e.target.value } }))}
          disabled={!catalog}
          className={fieldClass}
        >
          {(levels.length ? levels : [pick.level]).map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={add}
          disabled={!pick.name || full}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-xs font-bold text-foreground transition hover:border-primary/50 disabled:opacity-50"
        >
          <Icon path="M12 5v14M5 12h14" />
          Add
        </button>
      </div>

      {error && (
        <p className="mt-4 text-xs font-semibold text-red-500" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-bold" aria-live="polite">
          {savedAt ? (
            <span className="text-emerald-500">Skills saved — you’ll show up in Browse Skills.</span>
          ) : dirty ? (
            <span className="text-primary">Unsaved changes</span>
          ) : null}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <button
            type="button"
            onClick={() => updateSkillsEditor({ draft: null })}
            disabled={!dirty || busy}
            className="min-h-11 rounded-xl px-4 py-3 text-xs font-bold text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || busy}
            className="min-h-11 rounded-xl bg-foreground px-6 py-3 text-xs font-bold text-background shadow-[0_8px_20px_rgba(0,0,0,.15)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save skills"}
          </button>
        </div>
      </div>
    </div>
  );
}

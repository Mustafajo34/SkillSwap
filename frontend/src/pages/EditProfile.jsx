import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { requestJson } from "../utils/api";
import { validateForm, validators, USERNAME_HINT, PASSWORD_REQUIREMENTS } from "../utils/validation";
import { ThemeContext } from "../theme/useTheme";
import { readDarkMode, storeDarkMode } from "../theme/storedTheme";
import RealtimeProvider from "../realtime/RealtimeProvider";
import NotificationsProvider from "../notifications/NotificationsProvider";
import IncomingCallAlert from "../notifications/IncomingCallAlert";
import UserAvatar from "../components/UserAvatar";
import SkillsEditor from "../skills/SkillsEditor";
import { setPhotoVersion } from "../utils/photos";
import "../css/Dashboard.css";
import "../css/EditProfile.css";
import Copyright from "../components/Copyright";

// Edit Profile (/profile) — its own page, opened from the account menu.
//   Personal information   PATCH /auth/me          (+ photo: PUT /auth/me/avatar)
//   Skills you teach       PATCH /members/me       (what Browse Skills shows)
//   Password               POST  /auth/password
// Uses the dashboard's theme tokens (.dashboard / .dashboard.light) and the
// light/dark choice remembered from the dashboard. Video invites still ring
// here (IncomingCallAlert); accepting one opens the session on the dashboard.

const GRADUATED_OPTIONS = ["Yes", "No", "In Progress"];
const BIO_MAX = 300;
const LOCATION_MAX = 80;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_SIZE = 256;

const PROFILE_RULES = {
  firstName: validators.name("First name"),
  lastName: validators.name("Last name"),
  userName: validators.username,
  email: validators.email,
  occupation: validators.text("Occupation"),
  school: validators.letters("School"),
  major: validators.letters("Major"),
  graduated: validators.oneOf("Graduated", GRADUATED_OPTIONS),
  bio: validators.freeText("Bio", BIO_MAX),
  location: validators.place("Location", LOCATION_MAX),
};

// Check one field (on blur) with the same rules the server uses
const fieldError = (rules, field, value) =>
  validateForm({ [field]: value }, { [field]: rules[field] }).errors[field] || "";

const profileFrom = (user) => ({
  firstName: user?.firstName || "",
  lastName: user?.lastName || "",
  userName: user?.userName || "",
  email: user?.email || "",
  occupation: user?.occupation || "",
  school: user?.school || "",
  major: user?.major || "",
  graduated: user?.graduated || "No",
  bio: user?.bio || "",
  location: user?.location || "",
});

// Square-crops and shrinks a photo to 256px JPEG, so uploads stay small
async function resizePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("That file couldn't be read as an image."));
      image.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    canvas
      .getContext("2d")
      .drawImage(
        img,
        (img.naturalWidth - side) / 2,
        (img.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        PHOTO_SIZE,
        PHOTO_SIZE,
      );
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Icons ────────────────────────────────────────────────────────────────────

const ICONS = {
  user: <path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />,
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9.5 12 1.7 1.7 3.6-3.9" />
    </>
  ),
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  camera: (
    <>
      <path d="M15 8h.01M4 7h3l1.5-2h7L17 7h3v12H4V7Z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12c1-3.5 5-8 10-8s9 4.5 10 8c-1 3.5-5 8-10 8S3 15.5 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <path d="m3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.9 10.9 0 0 1 12 4c5 0 9 4.5 10 8a12.4 12.4 0 0 1-2 3.9M6.6 6.6A11.5 11.5 0 0 0 2 12c1 3.5 5 8 10 8 1.5 0 2.9-.4 4.1-1" />
  ),
  arrow: <path d="m9 18 6-6-6-6" />,
  back: <path d="m15 18-6-6 6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
};

function Icon({ name, className = "size-5" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

// ── Form pieces ──────────────────────────────────────────────────────────────

const inputClass =
  "w-full min-w-0 rounded-xl border bg-background px-4 py-3.5 text-base font-medium text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/15 sm:text-sm";
const inputBorder = (error) =>
  error ? "border-red-500" : "border-border hover:border-primary/40";

function Field({ label, error, hint, children, className = "" }) {
  return (
    <label className={`group block ${className}`}>
      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground transition-colors group-focus-within:text-primary">
        {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs font-semibold text-red-500" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1.5 block text-[11px] text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

function SavedNote({ show, children }) {
  return (
    <div
      className={`flex items-center gap-2 text-xs font-bold text-emerald-500 transition-opacity ${show ? "opacity-100" : "opacity-0"}`}
      aria-live="polite"
    >
      {show && (
        <>
          <span className="grid size-5 place-items-center rounded-full bg-emerald-500/15">
            <Icon name="check" className="size-3" />
          </span>
          {children}
        </>
      )}
    </div>
  );
}

function Card({ id, title, subtitle, icon, children }) {
  return (
    <section
      id={id}
      className="mt-6 scroll-mt-32 overflow-hidden rounded-2xl sm:scroll-mt-36 lg:scroll-mt-24 border border-border bg-card text-card-foreground shadow-[0_18px_60px_rgba(0,0,0,0.07)] first:mt-0 sm:mt-7 sm:rounded-[24px]"
    >
      <div className="flex items-start justify-between border-b border-border px-4 py-5 min-[375px]:px-5 sm:px-8 sm:py-6">
        <div>
          <h2 className="text-base font-extrabold tracking-tight">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {icon && (
          <div className="hidden size-10 place-items-center rounded-xl bg-primary/15 text-primary sm:grid">
            <Icon name={icon} />
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

// Brief "saved" flag that switches itself off
function useFlash(ms = 2500) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return [on, () => setOn(true)];
}

// ── Personal information ─────────────────────────────────────────────────────

function PersonalSection({ user, onSaved }) {
  const { authFetch } = useAuth();
  const [values, setValues] = useState(() => profileFrom(user));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, flashSaved] = useFlash();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const fileInput = useRef(null);

  const original = profileFrom(user);
  const dirty = Object.keys(original).some((k) => original[k] !== values[k]);

  const set = (field) => (event) => {
    setValues((v) => ({ ...v, [field]: event.target.value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: "" }));
  };
  // Check each field as soon as you leave it (and again on save)
  const check = (field) => () =>
    setErrors((e) => ({ ...e, [field]: fieldError(PROFILE_RULES, field, values[field]) }));

  const save = async (event) => {
    event.preventDefault();
    setFormError("");
    const { values: clean, errors: found } = validateForm(values, PROFILE_RULES);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setBusy(true);
    try {
      const data = await requestJson(authFetch, "/auth/me", {
        method: "PATCH",
        body: JSON.stringify(clean),
      });
      onSaved(data.user);
      setValues(profileFrom(data.user));
      setErrors({});
      flashSaved();
    } catch (err) {
      if (err.status === 409 || err.status === 400) {
        // The server names the field when it can (e.g. "That username is taken.")
        if (err.field && err.field in values) setErrors((e) => ({ ...e, [err.field]: err.message }));
        else setFormError(err.message);
      } else {
        setFormError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setValues(profileFrom(user));
    setErrors({});
    setFormError("");
  };

  const uploadPhoto = async (avatar) => {
    setPhotoError("");
    setPhotoBusy(true);
    try {
      const data = await requestJson(authFetch, "/auth/me/avatar", {
        method: "PUT",
        body: JSON.stringify({ avatar }),
      });
      onSaved(data.user);
      setPhotoVersion(data.user.id, data.user.photoV); // every avatar of you
    } catch (err) {
      setPhotoError(err.message);
    } finally {
      setPhotoBusy(false);
    }
  };

  const choosePhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // so picking the same file again still triggers
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      setPhotoError("Please choose a JPG, PNG or WEBP image.");
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setPhotoError("That photo is over 5MB. Please choose a smaller one.");
      return;
    }
    try {
      await uploadPhoto(await resizePhoto(file));
    } catch (err) {
      setPhotoError(err.message);
    }
  };

  return (
    <Card
      id="profile"
      title="Personal information"
      subtitle="Your photo and the details people see on SkillSwap."
    >
      <form onSubmit={save} noValidate className="p-4 min-[375px]:p-5 sm:p-8">
        <div className="mb-8 flex flex-col items-center gap-5 rounded-2xl border border-border bg-background/60 p-4 text-center min-[420px]:items-start min-[420px]:text-left sm:mb-9 sm:flex-row sm:items-center sm:p-6">
          <div className="relative w-fit">
            <UserAvatar
              id={user?.id}
              name={`${user?.firstName || ""} ${user?.lastName || ""}`}
              photoV={user?.photoV}
              alt="Your profile photo"
              className="grid size-24 place-items-center overflow-hidden rounded-2xl text-xl font-black text-black shadow-[0_12px_30px_rgba(0,0,0,.14)]"
            />
            <button
              type="button"
              aria-label="Choose profile photo"
              disabled={photoBusy}
              onClick={() => fileInput.current?.click()}
              className="absolute -bottom-2 -right-2 grid size-9 place-items-center rounded-xl border-4 border-card bg-primary text-primary-foreground shadow-md transition hover:scale-105 disabled:opacity-60"
            >
              <Icon name="camera" className="size-4" />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={PHOTO_TYPES.join(",")}
              onChange={choosePhoto}
              className="hidden"
            />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold">Profile photo</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {photoBusy ? "Uploading…" : "JPG, PNG or WEBP, up to 5MB. We crop it to a square."}
            </p>
            {photoError && (
              <p className="mt-1 break-words text-xs font-semibold text-red-500" role="alert">
                {photoError}
              </p>
            )}
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            {user?.photoV && (
              <button
                type="button"
                disabled={photoBusy}
                onClick={() => uploadPhoto(null)}
                className="min-h-11 flex-1 rounded-xl px-4 py-2.5 text-xs font-bold text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-60 sm:flex-none"
              >
                Remove
              </button>
            )}
            <button
              type="button"
              disabled={photoBusy}
              onClick={() => fileInput.current?.click()}
              className="min-h-11 flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-bold shadow-sm transition hover:border-primary/50 disabled:opacity-60 sm:flex-none"
            >
              Change photo
            </button>
          </div>
        </div>

        <div className="grid min-w-0 gap-x-5 gap-y-6 md:grid-cols-2">
          <Field label="First name" error={errors.firstName}>
            <input className={`${inputClass} ${inputBorder(errors.firstName)}`} value={values.firstName} onChange={set("firstName")} onBlur={check("firstName")} autoComplete="given-name" maxLength={50} />
          </Field>
          <Field label="Last name" error={errors.lastName}>
            <input className={`${inputClass} ${inputBorder(errors.lastName)}`} value={values.lastName} onChange={set("lastName")} onBlur={check("lastName")} autoComplete="family-name" maxLength={50} />
          </Field>
          <Field label="Username" error={errors.userName} hint={USERNAME_HINT}>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                @
              </span>
              <input className={`${inputClass} ${inputBorder(errors.userName)} pl-8`} value={values.userName} onChange={set("userName")} onBlur={check("userName")} autoComplete="username" maxLength={20} />
            </div>
          </Field>
          <Field label="Email address" error={errors.email}>
            <input className={`${inputClass} ${inputBorder(errors.email)}`} type="email" value={values.email} onChange={set("email")} onBlur={check("email")} autoComplete="email" maxLength={254} />
          </Field>
          <Field label="Occupation" error={errors.occupation}>
            <input className={`${inputClass} ${inputBorder(errors.occupation)}`} value={values.occupation} onChange={set("occupation")} onBlur={check("occupation")} autoComplete="organization-title" maxLength={100} />
          </Field>
          <Field label="Location" error={errors.location} hint="Optional — e.g. Chicago, IL">
            <input className={`${inputClass} ${inputBorder(errors.location)}`} value={values.location} onChange={set("location")} onBlur={check("location")} autoComplete="address-level2" maxLength={LOCATION_MAX} />
          </Field>
          <Field label="School" error={errors.school}>
            <input className={`${inputClass} ${inputBorder(errors.school)}`} value={values.school} onChange={set("school")} onBlur={check("school")} maxLength={100} />
          </Field>
          <Field label="Major" error={errors.major}>
            <input className={`${inputClass} ${inputBorder(errors.major)}`} value={values.major} onChange={set("major")} onBlur={check("major")} maxLength={100} />
          </Field>
          <Field label="Graduated" error={errors.graduated}>
            <select className={`${inputClass} ${inputBorder(errors.graduated)}`} value={values.graduated} onChange={set("graduated")} onBlur={check("graduated")}>
              {GRADUATED_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bio" error={errors.bio} className="md:col-span-2">
            <div className="relative">
              <textarea
                className={`${inputClass} ${inputBorder(errors.bio)} min-h-28 resize-y pb-8`}
                value={values.bio}
                onChange={set("bio")} onBlur={check("bio")}
                maxLength={BIO_MAX}
                placeholder="What do you teach, and what do you want to learn?"
              />
              <span className="pointer-events-none absolute bottom-3 right-4 text-[10px] font-semibold text-muted-foreground">
                {values.bio.length} / {BIO_MAX}
              </span>
            </div>
          </Field>
        </div>

        {formError && (
          <p className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-500" role="alert">
            {formError}
          </p>
        )}

        <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <SavedNote show={saved}>Your changes have been saved.</SavedNote>
          <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto">
            <button
              type="button"
              onClick={cancel}
              disabled={!dirty || busy}
              className="min-h-11 rounded-xl px-4 py-3 text-xs font-bold text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50 sm:px-5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!dirty || busy}
              className="min-h-11 rounded-xl bg-foreground px-4 py-3 text-xs font-bold text-background shadow-[0_8px_20px_rgba(0,0,0,.15)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50 sm:px-6"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </form>
    </Card>
  );
}

// ── Skills you teach ─────────────────────────────────────────────────────────
// The skills editor (skills/SkillsEditor.jsx). Saved skills update your
// account everywhere in the app (Browse Skills, My Skills…).

function SkillsSection() {
  return (
    <Card
      id="skills"
      title="Skills you teach"
      subtitle="People find you in Browse Skills by these. Up to 10."
      icon="spark"
    >
      <div className="p-4 min-[375px]:p-5 sm:p-8">
        <SkillsEditor />
      </div>
    </Card>
  );
}

// ── Password ─────────────────────────────────────────────────────────────────

const EMPTY_PASSWORDS = { currentPassword: "", newPassword: "", confirm: "" };

function PasswordSection() {
  const { authFetch } = useAuth();
  const [values, setValues] = useState(EMPTY_PASSWORDS);
  const [errors, setErrors] = useState({});
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, flashSaved] = useFlash(3500);

  const set = (field) => (event) => {
    setValues((v) => ({ ...v, [field]: event.target.value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: "" }));
  };

  const save = async (event) => {
    event.preventDefault();
    const found = {};
    if (!values.currentPassword) found.currentPassword = "Enter your current password.";
    const strength = validators.password(values.newPassword);
    if (strength) found.newPassword = strength;
    if (values.confirm !== values.newPassword) found.confirm = "The new passwords don’t match.";
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setBusy(true);
    try {
      await requestJson(authFetch, "/auth/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      });
      setValues(EMPTY_PASSWORDS);
      setErrors({});
      flashSaved();
    } catch (err) {
      setErrors({ [err.field === "currentPassword" ? "currentPassword" : "newPassword"]: err.message });
    } finally {
      setBusy(false);
    }
  };

  const fields = [
    ["currentPassword", "Current password", "current-password"],
    ["newPassword", "New password", "new-password"],
    ["confirm", "Confirm new password", "new-password"],
  ];

  return (
    <Card
      id="security"
      title="Change password"
      subtitle="Choose a strong password you don’t use anywhere else."
      icon="shield"
    >
      <form onSubmit={save} noValidate className="p-4 min-[375px]:p-5 sm:p-8">
        <div className="grid min-w-0 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {fields.map(([field, label, autoComplete]) => (
            <Field label={label} key={field} error={errors[field]}>
              <div className="relative">
                <input
                  className={`${inputClass} ${inputBorder(errors[field])} pr-12`}
                  type={show ? "text" : "password"}
                  name={field}
                  value={values[field]}
                  onChange={set(field)}
                  placeholder="••••••••••"
                  autoComplete={autoComplete}
                  maxLength={72}
                />
                <button
                  type="button"
                  aria-label={show ? "Hide passwords" : "Show passwords"}
                  aria-pressed={show}
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                >
                  <Icon name={show ? "eyeOff" : "eye"} className="size-4.5" />
                </button>
              </div>
            </Field>
          ))}
        </div>

        <ul className="mt-6 grid gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 sm:grid-cols-3">
          {PASSWORD_REQUIREMENTS.map((req) => {
            const met = req.test(values.newPassword);
            return (
              <li
                key={req.id}
                className={`flex items-center gap-2 text-[11px] font-semibold ${met ? "text-emerald-500" : "text-muted-foreground"}`}
              >
                <Icon name={met ? "check" : "close"} className="size-3.5 shrink-0" />
                {req.label}
              </li>
            );
          })}
        </ul>

        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <SavedNote show={saved}>Password updated successfully.</SavedNote>
          <button
            type="submit"
            disabled={busy}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-xs font-black text-primary-foreground shadow-[0_8px_20px_rgba(201,162,39,.25)] transition hover:-translate-y-0.5 hover:bg-accent hover:text-accent-foreground disabled:translate-y-0 disabled:opacity-60 sm:w-auto"
          >
            {busy ? "Updating…" : "Update password"}
            <Icon name="arrow" className="size-4" />
          </button>
        </div>
      </form>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

// [id, label, icon, short label for the phone chips]
const SECTIONS = [
  ["profile", "Edit profile", "user", "Profile"],
  ["skills", "Skills you teach", "spark", "Skills"],
  ["security", "Password", "shield", "Password"],
];

function SkillSwapMark({ className = "size-10" }) {
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#c9a227] via-[#f5c518] to-[#c9a227] shadow-[0_0_28px_rgba(245,197,24,.18)] ${className}`}
    >
      <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2L8 8H4l4 4-2 6 6-3 6 3-2-6 4-4h-4L12 2z" fill="#0c0c0c" opacity="0.9" />
        <path d="M8 12 Q12 8 16 12 Q12 16 8 12Z" fill="#0c0c0c" opacity="0.5" />
      </svg>
    </div>
  );
}

const EditProfile = () => {
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const [darkMode, setDarkMode] = useState(readDarkMode);
  const [activeSection, setActiveSection] = useState("profile");

  const toggleDark = () => {
    setDarkMode(!darkMode);
    storeDarkMode(!darkMode);
  };

  const goTo = (section) => {
    setActiveSection(section);
    document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Highlight whichever section is in the middle of the screen as you scroll
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    SECTIONS.forEach(([id]) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  // How complete the profile is (shown in the sidebar)
  const strength = useMemo(() => {
    const checks = [
      Boolean(user?.photoV),
      Boolean(user?.bio),
      Boolean(user?.location),
      (user?.skills?.length || 0) > 0,
      Boolean(user?.occupation),
      Boolean(user?.school && user?.major),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [user]);
  const nextStep = !user?.skills?.length
    ? "Add a skill you can teach so people can find you."
    : !user?.photoV
      ? "Add a profile photo."
      : !user?.bio
        ? "Write a short bio."
        : !user?.location
          ? "Add your location."
          : "Your profile is looking great.";

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "SkillSwap member";

  return (
    <ThemeContext.Provider value={{ darkMode }}>
      <div className={`dashboard edit-profile ${darkMode ? "" : "light"}`}>
        {/* Video invites still ring here; Accept opens the session */}
        <RealtimeProvider>
          <NotificationsProvider>
            <IncomingCallAlert onJoin={(roomId) => navigate(`/dashboard?room=${encodeURIComponent(roomId)}`)} />

            <div className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="sticky top-0 hidden h-dvh flex-col overflow-hidden border-r border-border bg-card px-6 py-8 lg:flex xl:px-7">
                <div className="pointer-events-none absolute -left-24 top-28 size-64 rounded-full bg-primary/10 blur-3xl" />
                <button
                  type="button"
                  onClick={() => navigate("/dashboard")}
                  className="relative flex items-center gap-3 text-left"
                  aria-label="Back to the SkillSwap dashboard"
                >
                  <SkillSwapMark />
                  <span>
                    <span
                      className="block text-[1.15rem] leading-none text-foreground"
                      style={{ fontFamily: "'DM Serif Display', serif" }}
                    >
                      Skill<span className="text-primary">Swap</span>
                    </span>
                    <span
                      className="mt-1 block text-[0.6rem] uppercase tracking-[0.12em] text-muted-foreground"
                      style={{ fontFamily: "'DM Mono', monospace" }}
                    >
                      Exchange · Grow
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/dashboard")}
                  className="relative mt-10 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <Icon name="back" className="size-4" />
                  Back to dashboard
                </button>

                <div className="relative mt-6">
                  <p className="mb-4 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    Settings
                  </p>
                  <nav className="space-y-2" aria-label="Settings sections">
                    {SECTIONS.map(([id, label, icon]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => goTo(id)}
                        aria-current={activeSection === id ? "true" : undefined}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${
                          activeSection === id
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                        }`}
                      >
                        <Icon name={icon} />
                        {label}
                        {activeSection === id && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
                      </button>
                    ))}
                  </nav>
                </div>

                <div className="relative mt-auto rounded-2xl border border-border bg-background/60 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                      Profile strength
                    </span>
                    <span className="text-xs font-bold text-primary">{strength}%</span>
                  </div>
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="Profile strength"
                    aria-valuenow={strength}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${strength}%` }} />
                  </div>
                  <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{nextStep}</p>
                </div>
              </aside>

              <main className="relative min-w-0 overflow-x-clip">
                <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl sm:min-h-20 sm:px-8 lg:px-10 xl:px-12">
                  <button
                    type="button"
                    onClick={() => navigate("/dashboard")}
                    className="flex items-center gap-2 rounded-xl py-1.5 pr-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground lg:hidden"
                  >
                    <Icon name="back" className="size-4" />
                    <SkillSwapMark className="size-8" />
                    <span className="sr-only">Back to dashboard</span>
                  </button>
                  <div className="hidden lg:block">
                    <p className="text-xs font-semibold text-muted-foreground">Account settings</p>
                    <p className="mt-0.5 text-sm font-bold">Personal profile</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                    <button
                      type="button"
                      onClick={toggleDark}
                      aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                      className="grid size-11 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition hover:text-foreground"
                    >
                      <Icon name={darkMode ? "sun" : "moon"} className="size-4.5" />
                    </button>
                    <div className="h-7 w-px bg-border" />
                    <div className="flex items-center gap-2.5">
                      <UserAvatar
                        id={user?.id}
                        name={name}
                        photoV={user?.photoV}
                        className="grid size-11 place-items-center overflow-hidden rounded-full text-xs font-black text-black"
                      />
                      <span className="hidden min-w-0 sm:block">
                        <span className="block max-w-[11rem] truncate text-xs font-bold lg:max-w-[16rem]">{name}</span>
                        <span className="block max-w-[11rem] truncate text-[10px] text-muted-foreground lg:max-w-[16rem]">
                          @{user?.userName}
                        </span>
                      </span>
                    </div>
                  </div>
                </header>

                <div className="relative mx-auto w-full max-w-6xl px-4 py-8 min-[375px]:px-5 sm:px-8 sm:py-10 lg:px-10 lg:py-12 xl:px-12 xl:py-14">
                  <div className="pointer-events-none absolute right-0 top-0 h-80 w-80 translate-x-1/3 -translate-y-1/3 rounded-full border-[64px] border-primary/10" />
                  <div className="relative mb-8">
                    <p className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-primary">
                      <span className="h-px w-7 bg-primary" />
                      Account details
                    </p>
                    <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">Edit your profile</h1>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                      Keep your details, photo and skills up to date — this is what other members see.
                    </p>
                  </div>

                  {/* Section shortcuts on phones/tablets (the sidebar is hidden there) */}
                  <nav
                    aria-label="Settings sections"
                    className="relative z-10 -mx-4 mb-6 grid grid-cols-3 gap-2 bg-background/90 px-4 py-2 backdrop-blur-xl min-[375px]:-mx-5 min-[375px]:px-5 sm:-mx-8 sm:px-8 lg:hidden [@media(min-height:500px)]:sticky [@media(min-height:500px)]:top-16 sm:[@media(min-height:500px)]:top-20"
                  >
                    {/* Three equal chips that always fit the screen — no sideways scrolling */}
                    {SECTIONS.map(([id, label, , short]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => goTo(id)}
                        aria-current={activeSection === id ? "true" : undefined}
                        aria-label={label}
                        className={`min-w-0 truncate rounded-full border px-2 py-2 text-center text-xs font-bold transition sm:px-4 ${
                          activeSection === id
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-muted-foreground"
                        }`}
                      >
                        <span className="sm:hidden">{short}</span>
                        <span className="hidden sm:inline">{label}</span>
                      </button>
                    ))}
                  </nav>

                  <div className="relative">
                    <PersonalSection key={`p-${user?.id}`} user={user} onSaved={updateUser} />
                    <SkillsSection />
                    <PasswordSection />
                  </div>

                  <p className="mt-8 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Passwords are hashed and never shown to anyone
                  </p>
                  <footer className="mt-6 border-t border-border pt-4 text-center">
                    <Copyright className="text-[11px] text-muted-foreground" />
                  </footer>
                </div>
              </main>
            </div>
          </NotificationsProvider>
        </RealtimeProvider>
      </div>
    </ThemeContext.Provider>
  );
};

export default EditProfile;

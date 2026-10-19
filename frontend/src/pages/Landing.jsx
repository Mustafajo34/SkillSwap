import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import {
  cleanText,
  PASSWORD_REQUIREMENTS,
  USERNAME_HINT,
  validateForm,
  validators,
} from "../utils/validation";
import "../css/LandingCss.css";
import Copyright from "../components/Copyright";

const TESTIMONIALS = [
  {
    name: "Destiny Okafor",
    role: "Junior · Computer Science · Howard University",
    swap: "Taught Python → Learned Graphic Design",
    quote:
      "I showed Marcus how to build REST APIs and he redesigned my entire portfolio. No money changed hands — just pure knowledge. This platform changed how I think about learning.",
    initials: "DO",
  },
  {
    name: "Liam Reyes",
    role: "Graduate Student · Architecture · UT Austin",
    swap: "Taught CAD Drafting → Learned Spanish",
    quote:
      "I needed conversational Spanish for my thesis fieldwork in Mexico City. Sofia needed AutoCAD skills for her internship. We met twice a week for a month. We both got exactly what we needed — for free.",
    initials: "LR",
  },
  {
    name: "Priya Nambiar",
    role: "Teaching Assistant · Biology · Emory University",
    swap: "Taught Lab Techniques → Learned Data Analytics",
    quote:
      "SkillSwap matched me with a stats PhD student who wanted to understand lab protocols. I walked away knowing Excel, R, and how to visualize research data. Honestly better than any workshop I have paid for.",
    initials: "PN",
  },
  {
    name: "Jordan Ellis",
    role: "Sophomore · Music Production · Berklee",
    swap: "Taught Music Theory → Learned Web Dev",
    quote:
      "Built my first real website in exchange for teaching someone how to compose chord progressions. The sessions felt more like hanging out than studying. This community is genuinely different.",
    initials: "JE",
  },
  {
    name: "Amara Diallo",
    role: "Professor · French Literature · Spelman College",
    swap: "Taught Academic Writing → Learned Video Editing",
    quote:
      "My students kept asking me to put lectures online. I swapped essay-coaching sessions with a film student and now I run a full YouTube channel. SkillSwap made it possible without a budget.",
    initials: "AD",
  },
  {
    name: "Tyler Nguyen",
    role: "Alumni · Finance · NYU Stern",
    swap: "Taught Financial Modeling → Learned UX Research",
    quote:
      "I was transitioning into product management and needed UX skills. I traded six sessions of Excel financial modeling and got a full crash course in user research methods. Zero dollars. Maximum value.",
    initials: "TN",
  },
];

const bgUrl = (w, h) =>
  `https://images.unsplash.com/photo-1660128359946-5d09e282a8a7?w=${w}&h=${h}&fit=crop&auto=format`;
const toSrcSet = (sizes) =>
  sizes.map(([w, h]) => `${bgUrl(w, h)} ${w}w`).join(", ");

// Portrait crops for phones, landscape crops for tablets/desktops
const BG_IMAGE = bgUrl(1800, 1200);
const BG_SRCSET_PORTRAIT = toSrcSet([
  [640, 1000],
  [960, 1500],
]);
const BG_SRCSET_LANDSCAPE = toSrcSet([
  [1200, 800],
  [1800, 1200],
  [2600, 1733],
]);

const ERROR_COLOR = "#C0392B";
const SUCCESS_COLOR = "#1E8449";
const HINT_COLOR = "#6B6B6B";
const WARNING_COLOR = "#9A6700";
const MODAL_EXIT_MS = 200;

// ── Shared form helpers ──────────────────────────────────────────────────────

// Form state + per-field errors for a set of validation rules.
function useValidatedForm(rules, initialValues = {}) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(
      Object.keys(rules).map((key) => [key, initialValues[key] ?? ""]),
    ),
  );
  const [errors, setErrors] = useState({});

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear a field's error as soon as the user edits it
    setErrors((prev) => (prev[field] ? { ...prev, [field]: "" } : prev));
  }

  function validateField(field) {
    const { errors: fieldErrors } = validateForm(
      { [field]: form[field] },
      { [field]: rules[field] },
    );
    setErrors((prev) => ({ ...prev, [field]: fieldErrors[field] || "" }));
  }

  function validateAll() {
    const result = validateForm(form, rules);
    setErrors(result.errors);
    return result;
  }

  // Props shared by every text/password input bound to this form
  const fieldProps = (id) => ({
    id,
    name: id,
    value: form[id],
    error: errors[id],
    onChange: (e) => updateField(id, e.target.value),
    onBlur: () => form[id] && validateField(id),
  });

  return { form, errors, setErrors, updateField, validateAll, fieldProps };
}

const focusField = (id) => document.getElementById(id)?.focus();

// Live "is this username free?" check, debounced while the user types.
// Returns "idle" | "checking" | "available" | "taken" | "unknown".
function useUsernameAvailability(rawUsername, checkUsername) {
  const username = cleanText(rawUsername);
  const formatOk = !validators.username(username);
  const [result, setResult] = useState({ username: "", status: "idle" });

  useEffect(() => {
    if (!formatOk) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const available = await checkUsername(username, controller.signal);
        setResult({ username, status: available ? "available" : "taken" });
      } catch (error) {
        if (error.name !== "AbortError") {
          setResult({ username, status: "unknown" });
        }
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [username, formatOk, checkUsername]);

  if (!formatOk) return "idle";
  return result.username === username ? result.status : "checking";
}

const USERNAME_TAKEN = "That username is already taken. Please choose another.";

const USERNAME_STATUS = {
  checking: { text: "Checking availability…", color: HINT_COLOR },
  available: { text: "✓ Username is available", color: SUCCESS_COLOR },
  taken: { text: `✗ ${USERNAME_TAKEN}`, color: ERROR_COLOR },
  unknown: {
    text: "Couldn't check availability right now — we'll check again when you submit.",
    color: HINT_COLOR,
  },
};

// ── Shared form UI ───────────────────────────────────────────────────────────

function FieldMessage({ id, color = ERROR_COLOR, live, children }) {
  return (
    <p
      id={id}
      role={color === ERROR_COLOR && !live ? "alert" : undefined}
      aria-live={live}
      className="mt-1 text-xs"
      style={{ color, fontFamily: "var(--font-body)" }}
    >
      {children}
    </p>
  );
}

function FormError({ children }) {
  return (
    <p
      role="alert"
      className="text-sm px-3 py-2"
      style={{
        color: ERROR_COLOR,
        background: "rgba(192,57,43,0.08)",
        border: "1px solid rgba(192,57,43,0.25)",
        fontFamily: "var(--font-body)",
      }}
    >
      {children}
    </p>
  );
}

// Label + input + either the error or `hint` (a node shown when valid).
function TextField({ id, label, error, hint, type = "text", ...inputProps }) {
  return (
    <div>
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        required
        className="form-input"
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-message` : undefined}
        style={error ? { borderColor: ERROR_COLOR } : undefined}
        {...inputProps}
      />
      {error ? (
        <FieldMessage id={`${id}-message`}>{error}</FieldMessage>
      ) : (
        hint && (
          <FieldMessage
            id={`${id}-message`}
            color={hint.color}
            live="polite"
          >
            {hint.text}
          </FieldMessage>
        )
      )}
    </div>
  );
}

// Password input with a show/hide toggle, an optional live requirement list,
// and an optional warning for leading/trailing spaces. Passwords are never
// trimmed — the warning lets the user decide instead.
function PasswordField({
  id,
  label,
  error,
  value,
  showRequirements = false,
  warnEdgeSpaces = false,
  ...inputProps
}) {
  const [visible, setVisible] = useState(false);
  const hasEdgeSpaces = warnEdgeSpaces && value !== value.trim();
  const describedBy = [
    showRequirements && `${id}-requirements`,
    hasEdgeSpaces && `${id}-spaces`,
    error && `${id}-message`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          required
          // No maxLength: it would silently cut off a long pasted password.
          // Validation reports anything over PASSWORD_MAX instead.
          // While shown as plain text, keep the browser from spellchecking
          // (enhanced spellcheck can send field text to a cloud service),
          // autocorrecting or capitalizing it.
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
          className="form-input"
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          style={{
            paddingRight: "4.25rem",
            ...(error ? { borderColor: ERROR_COLOR } : {}),
          }}
          {...inputProps}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-bold uppercase tracking-wider"
          style={{ color: HINT_COLOR, fontFamily: "var(--font-body)" }}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {showRequirements && (
        <ul id={`${id}-requirements`} className="mt-2 space-y-1">
          {PASSWORD_REQUIREMENTS.map((req) => {
            const met = req.test(value);
            return (
              <li
                key={req.id}
                className="flex items-center gap-2 text-xs"
                style={{
                  color: met ? SUCCESS_COLOR : HINT_COLOR,
                  fontFamily: "var(--font-body)",
                }}
              >
                <span aria-hidden="true">{met ? "✓" : "○"}</span>
                {req.label}
                <span className="sr-only">{met ? "(met)" : "(not met)"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {hasEdgeSpaces && (
        <FieldMessage id={`${id}-spaces`} color={WARNING_COLOR} live="polite">
          ⚠ Your password starts or ends with a space. That's allowed, but
          you'll need to type the space every time you sign in.
        </FieldMessage>
      )}
      {error && <FieldMessage id={`${id}-message`}>{error}</FieldMessage>}
    </div>
  );
}

// Animated modal frame: fades/slides in on open and out on close
// (× button, backdrop click, Escape, or the parent setting `closeRequested`).
// `onClose` runs once the exit animation has finished.
function ModalShell({
  eyebrow,
  title,
  onClose,
  closeRequested = false,
  children,
}) {
  const [closeClicked, setCloseClicked] = useState(false);
  const closing = closeClicked || closeRequested;
  const requestClose = useCallback(() => setCloseClicked(true), []);

  // Always call the latest onClose, without restarting the exit timer
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => onCloseRef.current(), MODAL_EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  useEffect(() => {
    const onKeyDown = (e) => e.key === "Escape" && requestClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  return (
    <div
      className={`${closing ? "backdrop-animate-out" : "backdrop-animate"} fixed inset-0 z-50 flex items-center justify-center p-4`}
      style={{ background: "rgba(13,13,13,0.82)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`${closing ? "modal-animate-out" : "modal-animate"} relative w-full max-w-lg overflow-y-auto`}
        style={{
          background: "#FAFAFA",
          maxHeight: "92dvh",
          borderTop: "4px solid #F5C800",
          boxShadow:
            "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(201,168,76,0.2)",
        }}
      >
        {/* Header */}
        <div
          className="px-5 pt-6 pb-5 sm:px-8 sm:pt-8 sm:pb-6"
          style={{ borderBottom: "1px solid #E8E8E8" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div
                className="text-xs font-bold tracking-widest uppercase mb-2"
                style={{ color: "#C9A84C", fontFamily: "var(--font-body)" }}
              >
                {eyebrow}
              </div>
              <h2
                id="modal-title"
                className="text-2xl font-black leading-tight"
                style={{ fontFamily: "var(--font-display)", color: "#0D0D0D" }}
              >
                {title}
              </h2>
            </div>
            <button
              onClick={requestClose}
              className="shrink-0 mt-1 w-8 h-8 flex items-center justify-center text-xl transition-colors"
              style={{ color: HINT_COLOR }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}

function SwitchPrompt({ question, action, onClick }) {
  return (
    <p
      className="text-center text-xs"
      style={{ color: HINT_COLOR, fontFamily: "var(--font-body)" }}
    >
      {question}{" "}
      <button
        type="button"
        onClick={onClick}
        className="underline font-semibold transition-colors"
        style={{ color: "#C9A84C" }}
      >
        {action}
      </button>
    </p>
  );
}

function SubmitButton({ busy, busyText, disabled = false, children }) {
  return (
    <div className="pt-2">
      <button
        type="submit"
        className="btn-primary w-full text-center"
        style={{ width: "100%", padding: "0.85rem 1.6rem" }}
        disabled={busy || disabled}
      >
        {busy ? busyText : children}
      </button>
    </div>
  );
}

// ── Sign Up ──────────────────────────────────────────────────────────────────

const GRADUATED_OPTIONS = ["Yes", "No", "In Progress"];

const SIGNUP_RULES = {
  firstName: validators.name("First name"),
  lastName: validators.name("Last name"),
  username: validators.username,
  email: validators.email,
  password: validators.password,
  occupation: validators.text("Occupation"),
  school: validators.letters("School"),
  major: validators.letters("Major"),
  graduated: validators.oneOf("Whether you have graduated", GRADUATED_OPTIONS),
};

const SIGNUP_DETAIL_FIELDS = [
  {
    id: "occupation",
    label: "Occupation",
    placeholder: "Student / Teaching Assistant / Professor…",
    autoComplete: "organization-title",
  },
  {
    id: "school",
    label: "School / Institution",
    placeholder: "Howard University",
    autoComplete: "organization",
  },
  {
    id: "major",
    label: "Major / Field of Study",
    placeholder: "Computer Science",
    autoComplete: "off",
  },
];

// On success, animates out and calls onSignedUp(username) so the page can
// open the sign-in pop-up.
function SignUpModal({ onClose, onSignedUp }) {
  const { signUp, checkUsername } = useAuth();
  const { form, errors, setErrors, updateField, validateAll, fieldProps } =
    useValidatedForm(SIGNUP_RULES);
  const usernameStatus = useUsernameAvailability(form.username, checkUsername);
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Set once the account is created; triggers the exit animation
  const [createdUsername, setCreatedUsername] = useState("");

  function setFieldError(field, message) {
    setErrors((prev) => ({ ...prev, [field]: message }));
    focusField(field);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting || createdUsername) return;
    setServerError("");

    const { values, errors: formErrors } = validateAll();
    const firstInvalid = Object.keys(SIGNUP_RULES).find((f) => formErrors[f]);
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }

    setSubmitting(true);

    // Make sure the username is free. If the live check hasn't finished (or
    // couldn't reach the server), ask once more before creating the account.
    let taken = usernameStatus === "taken";
    if (usernameStatus !== "available" && !taken) {
      try {
        taken = !(await checkUsername(values.username));
      } catch {
        // Server unreachable — signUp below will surface that, and the
        // backend must reject duplicate usernames regardless.
      }
    }
    if (taken) {
      setSubmitting(false);
      setFieldError("username", USERNAME_TAKEN);
      return;
    }

    // Only send the known, cleaned fields — never spread raw form state
    const result = await signUp({
      ...values,
      email: values.email.toLowerCase(),
    });
    setSubmitting(false);

    if (result.ok) {
      setCreatedUsername(values.username);
    } else if (result.fields.includes("username")) {
      setFieldError("username", USERNAME_TAKEN);
    } else if (result.fields.includes("email")) {
      setFieldError("email", "An account with this email already exists.");
    } else {
      setServerError(result.message);
    }
  }

  const usernameHint = USERNAME_STATUS[usernameStatus] || {
    text: USERNAME_HINT,
    color: HINT_COLOR,
  };

  return (
    <ModalShell
      eyebrow="Join the Community"
      title="Create Your Account"
      onClose={createdUsername ? () => onSignedUp(createdUsername) : onClose}
      closeRequested={Boolean(createdUsername)}
    >
      <form
        onSubmit={handleSubmit}
        // POST as a fallback: if the JS handler ever failed, a default GET
        // submit would put the password in the URL and browser history.
        method="post"
        noValidate
        className="px-5 py-5 sm:px-8 sm:py-6 space-y-5"
      >
        {/* Row: First + Last */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            {...fieldProps("firstName")}
            label="First Name"
            placeholder="Maya"
            maxLength={50}
            autoComplete="given-name"
            autoFocus
          />
          <TextField
            {...fieldProps("lastName")}
            label="Last Name"
            placeholder="Johnson"
            maxLength={50}
            autoComplete="family-name"
          />
        </div>

        <TextField
          {...fieldProps("username")}
          label="Username"
          placeholder="maya_j"
          maxLength={20}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          hint={usernameHint}
          style={
            errors.username || usernameStatus === "taken"
              ? { borderColor: ERROR_COLOR }
              : undefined
          }
        />

        <TextField
          {...fieldProps("email")}
          label="Email Address"
          type="email"
          placeholder="maya@university.edu"
          maxLength={254}
          autoComplete="email"
        />

        <PasswordField
          {...fieldProps("password")}
          label="Password"
          autoComplete="new-password"
          showRequirements
          warnEdgeSpaces
        />

        {SIGNUP_DETAIL_FIELDS.map(({ id, ...field }) => (
          <TextField key={id} {...fieldProps(id)} {...field} maxLength={100} />
        ))}

        {/* Graduated */}
        <fieldset
          aria-describedby={errors.graduated ? "graduated-message" : undefined}
        >
          <legend className="form-label">Have You Graduated?</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2">
            {GRADUATED_OPTIONS.map((opt, i) => (
              <label
                key={opt}
                className="flex items-center gap-2 cursor-pointer select-none"
                style={{
                  fontFamily: "var(--font-body)",
                  color: "#0D0D0D",
                  fontSize: "0.875rem",
                  fontWeight: form.graduated === opt ? 700 : 500,
                }}
              >
                <input
                  id={i === 0 ? "graduated" : undefined}
                  type="radio"
                  name="graduated"
                  value={opt}
                  checked={form.graduated === opt}
                  onChange={() => updateField("graduated", opt)}
                  required
                  style={{
                    accentColor: "#C9A84C",
                    width: "16px",
                    height: "16px",
                  }}
                />
                {opt}
              </label>
            ))}
          </div>
          {errors.graduated && (
            <FieldMessage id="graduated-message">{errors.graduated}</FieldMessage>
          )}
        </fieldset>

        {serverError && <FormError>{serverError}</FormError>}

        <SubmitButton
          busy={submitting || Boolean(createdUsername)}
          busyText={createdUsername ? "✓ Account created!" : "Creating account…"}
        >
          Create Account
        </SubmitButton>
      </form>
    </ModalShell>
  );
}

// ── Sign In ──────────────────────────────────────────────────────────────────

const SIGNIN_RULES = {
  username: validators.username,
  password: validators.password,
};

// Sign-in rate limit: after 3 incorrect attempts, lock the form for 1 minute.
// Stored in localStorage so closing the modal or reloading doesn't reset it.
// This only slows people down in the browser — the backend must enforce its
// own limit, since anyone can call the API directly.
const SIGNIN_MAX_FAILURES = 3;
const SIGNIN_LOCKOUT_MS = 60_000;
const SIGNIN_LIMIT_KEY = "skillswap:signin-limit";

function readSignInLimit() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIGNIN_LIMIT_KEY));
    if (saved && Number.isFinite(saved.failures)) {
      return {
        failures: saved.failures,
        lockedUntil: Number(saved.lockedUntil) || 0,
      };
    }
  } catch {
    // Storage unavailable or corrupt — start fresh
  }
  return { failures: 0, lockedUntil: 0 };
}

function writeSignInLimit(limit) {
  try {
    localStorage.setItem(SIGNIN_LIMIT_KEY, JSON.stringify(limit));
  } catch {
    // Storage unavailable — the limit still applies for this session
  }
}

function useSignInRateLimit() {
  const [limit, setLimit] = useState(readSignInLimit);
  const [now, setNow] = useState(() => Date.now());
  const locked = limit.lockedUntil > now;

  // Tick while locked so the countdown updates and the lock lifts on time
  useEffect(() => {
    if (!locked) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [locked]);

  function recordFailure() {
    const time = Date.now();
    const lockExpired = limit.lockedUntil && limit.lockedUntil <= time;
    const failures = (lockExpired ? 0 : limit.failures) + 1;
    const next =
      failures >= SIGNIN_MAX_FAILURES
        ? { failures: 0, lockedUntil: time + SIGNIN_LOCKOUT_MS }
        : { failures, lockedUntil: 0 };
    writeSignInLimit(next);
    setLimit(next);
    setNow(time);
    return next;
  }

  function recordSuccess() {
    const next = { failures: 0, lockedUntil: 0 };
    writeSignInLimit(next);
    setLimit(next);
  }

  return {
    locked,
    secondsLeft: locked ? Math.ceil((limit.lockedUntil - now) / 1000) : 0,
    recordFailure,
    recordSuccess,
  };
}

const formatCountdown = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

// `justSignedUp` is the pop-up shown right after an account is created: it
// shows a success note, pre-fills the new username and hides the sign-up link.
function SignInModal({
  onClose,
  onSwitchToSignUp,
  initialUsername = "",
  justSignedUp = false,
}) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { validateAll, fieldProps } = useValidatedForm(SIGNIN_RULES, {
    username: initialUsername,
  });
  const { locked, secondsLeft, recordFailure, recordSuccess } =
    useSignInRateLimit();
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Cancels an in-flight sign-in if the modal closes or the page is left
  // (tab closed, reload, navigation) before the server answers, so a late
  // response can't sign the user in after they've walked away.
  const signInControllerRef = useRef(null);
  useEffect(() => {
    const abortSignIn = () => signInControllerRef.current?.abort();
    window.addEventListener("pagehide", abortSignIn);
    return () => {
      window.removeEventListener("pagehide", abortSignIn);
      abortSignIn();
    };
  }, []);

  // Counts an incorrect attempt and explains how many are left
  function failAttempt(message) {
    const next = recordFailure();
    if (next.lockedUntil) {
      setServerError("");
    } else {
      const left = SIGNIN_MAX_FAILURES - next.failures;
      setServerError(
        `${message} ${left} attempt${left === 1 ? "" : "s"} left before a 1-minute wait.`,
      );
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting || locked) return;
    setServerError("");

    const { values, errors: formErrors } = validateAll();
    const firstInvalid = Object.keys(SIGNIN_RULES).find((f) => formErrors[f]);
    if (firstInvalid) {
      // Empty fields aren't an attempt; a filled-in but invalid one is
      if (values.username && values.password) {
        failAttempt("Incorrect username or password.");
      }
      focusField(firstInvalid);
      return;
    }

    // Fresh controller per attempt; cancel any earlier one still running
    signInControllerRef.current?.abort();
    const controller = new AbortController();
    signInControllerRef.current = controller;

    setSubmitting(true);
    const result = await signIn(values, controller.signal);
    // Cancelled (modal closed / page left) — nothing to update, and it
    // doesn't count as an incorrect attempt
    if (result.aborted) return;
    signInControllerRef.current = null;
    setSubmitting(false);

    if (result.ok) {
      recordSuccess();
      onClose();
      // Back to the page that sent them here (e.g. a Live Session link)
      const from = location.state?.from;
      navigate(
        from?.pathname?.startsWith("/dashboard")
          ? `${from.pathname}${from.search || ""}`
          : "/dashboard",
      );
    } else if ([400, 401, 404].includes(result.status)) {
      // Don't reveal which of the two was wrong
      failAttempt("Incorrect username or password.");
    } else {
      // Server/network problems don't count against the user
      setServerError(result.message);
    }
  }

  return (
    <ModalShell
      eyebrow={justSignedUp ? "You're In" : "Welcome Back"}
      title="Sign In"
      onClose={onClose}
    >
      <form
        onSubmit={handleSubmit}
        // POST as a fallback: if the JS handler ever failed, a default GET
        // submit would put the password in the URL and browser history.
        method="post"
        noValidate
        className="px-5 py-5 sm:px-8 sm:py-6 space-y-5"
      >
        {justSignedUp && (
          <p
            role="status"
            className="text-sm px-3 py-2"
            style={{
              color: SUCCESS_COLOR,
              background: "rgba(30,132,73,0.08)",
              border: "1px solid rgba(30,132,73,0.25)",
              fontFamily: "var(--font-body)",
            }}
          >
            ✓ Your account was created! Sign in with your username and
            password to get started.
          </p>
        )}

        <TextField
          {...fieldProps("username")}
          label="Username"
          placeholder="maya_j"
          maxLength={20}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={!initialUsername}
        />

        <PasswordField
          {...fieldProps("password")}
          label="Password"
          autoComplete="current-password"
          autoFocus={Boolean(initialUsername)}
        />

        {locked ? (
          <FormError>
            Too many incorrect attempts. Please wait{" "}
            {formatCountdown(secondsLeft)} before trying again.
          </FormError>
        ) : (
          serverError && <FormError>{serverError}</FormError>
        )}

        <SubmitButton
          busy={submitting}
          busyText="Signing in…"
          disabled={locked}
        >
          {locked ? `Try again in ${formatCountdown(secondsLeft)}` : "Sign In"}
        </SubmitButton>

        {onSwitchToSignUp && (
          <SwitchPrompt
            question="New to SkillSwap?"
            action="Create an account"
            onClick={onSwitchToSignUp}
          />
        )}
      </form>
    </ModalShell>
  );
}

const Landing = () => {
  // Which auth modal is open, or null:
  //   { type: "signup" }
  //   { type: "signin" }                                 — from the header
  //   { type: "signin", username, justSignedUp: true }   — after signing up
  const [modal, setModal] = useState(null);
  const closeModal = useCallback(() => setModal(null), []);
  const openSignInAfterSignUp = useCallback(
    (username) => setModal({ type: "signin", username, justSignedUp: true }),
    [],
  );

  return (
    <div
      className="relative min-h-dvh flex flex-col overflow-hidden"
      style={{ background: "#0D0D0D" }}
    >
      {/* Background image — faded */}
      <div
        className="absolute inset-x-0 top-0 z-0 h-svh min-h-128"
        aria-hidden="true"
      >
        <picture>
          <source
            media="(max-width: 639px)"
            srcSet={BG_SRCSET_PORTRAIT}
            sizes="100vw"
          />
          <img
            src={BG_IMAGE}
            srcSet={BG_SRCSET_LANDSCAPE}
            sizes="100vw"
            alt="Tutor and student studying together"
            fetchPriority="high"
            decoding="async"
            className="block w-full h-full object-cover"
            style={{
              opacity: 0.18,
              objectPosition: "center 25%",
              maskImage:
                "linear-gradient(to bottom, #000 65%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, #000 65%, transparent 100%)",
            }}
          />
        </picture>
        {/* Gradient overlay for depth */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 40%, rgba(245,200,0,0.06) 0%, transparent 70%), linear-gradient(to bottom, rgba(13,13,13,0.4) 0%, rgba(13,13,13,0.1) 50%, rgba(13,13,13,0.6) 100%)",
          }}
        />
      </div>

      {/* Nav bar */}
      <header className="relative z-10 flex items-center justify-between gap-2 px-4 py-4 sm:px-10 sm:py-6">
        {/* Sign Up — left */}
        <button className="btn-primary" onClick={() => setModal({ type: "signup" })}>
          Sign Up
        </button>

        {/* Brand — center */}
        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none select-none">
          <span
            className="text-base sm:text-xl font-black tracking-tight leading-none"
            style={{ fontFamily: "var(--font-display)", color: "#FAFAFA" }}
          >
            Skill<span style={{ color: "#F5C800" }}>Swap</span>
          </span>
        </div>

        {/* Sign In — right */}
        <button className="btn-outline" onClick={() => setModal({ type: "signin" })}>
          Sign In
        </button>
      </header>

      {/* Hero content */}
      <main className="relative z-10 flex flex-col items-center justify-center flex-1 px-5 py-10 sm:py-24 text-center">
        {/* Eyebrow */}
        <div
          className="inline-flex items-center gap-2 mb-6 px-4 py-2 text-xs font-bold tracking-widest uppercase rounded-full"
          style={{
            background: "rgba(201,168,76,0.08)",
            border: "1px solid rgba(201,168,76,0.4)",
            color: "#C9A84C",
            fontFamily: "var(--font-body)",
            letterSpacing: "0.15em",
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: "#F5C800" }}
          />
          Peer-to-Peer Learning
        </div>

        {/* Headline */}
        <h1
          className="text-[2.5rem] min-[400px]:text-5xl sm:text-6xl md:text-8xl font-black leading-none mb-6 tracking-tight"
          style={{
            fontFamily: "var(--font-display)",
            color: "#FAFAFA",
            maxWidth: "820px",
          }}
        >
          Trade what
          <br />
          you <span className="gold-shimmer">know.</span>
          <br />
          <span style={{ fontStyle: "italic", fontWeight: 300 }}>
            Learn
          </span>{" "}
          what
          <br />
          you don't.
        </h1>

        {/* Subhead */}
        <p
          className="text-base sm:text-lg leading-relaxed mb-10 max-w-md"
          style={{
            color: "rgba(250,250,250,0.55)",
            fontFamily: "var(--font-body)",
            fontWeight: 400,
          }}
        >
          Connect with students and educators who swap skills — no payment
          required. Teach what you excel at, learn what you need.
        </p>

        {/* Testimonial carousel */}
        <div className="w-[calc(100%+2.5rem)] sm:w-full mt-10 mb-2">
          {/* Section label */}
          <p
            className="text-xs font-bold tracking-widest uppercase text-center mb-6"
            style={{
              color: "rgba(201,168,76,0.7)",
              fontFamily: "var(--font-body)",
            }}
          >
            Real swaps. Real people. Zero dollars.
          </p>

          {/* Scrolling track */}
          <div className="relative w-full overflow-hidden">
            {/* Edge fades */}
            <div className="carousel-fade-left absolute left-0 top-0 bottom-0 w-10 sm:w-20 z-10 pointer-events-none" />
            <div className="carousel-fade-right absolute right-0 top-0 bottom-0 w-10 sm:w-20 z-10 pointer-events-none" />

            <div className="carousel-track">
              {[...TESTIMONIALS, ...TESTIMONIALS].map((t, i) => (
                <div
                  key={i}
                  className="shrink-0 mx-2 sm:mx-3 p-5 sm:p-6 flex flex-col gap-4 text-left"
                  style={{
                    width: "min(300px, 80vw)",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(201,168,76,0.18)",
                    borderTop: "2px solid #C9A84C",
                  }}
                >
                  {/* Quote */}
                  <p
                    className="text-sm leading-relaxed"
                    style={{
                      color: "rgba(250,250,250,0.75)",
                      fontFamily: "var(--font-body)",
                      fontStyle: "italic",
                    }}
                  >
                    "{t.quote}"
                  </p>

                  {/* Swap badge */}
                  <div
                    className="text-xs font-bold px-3 py-1 self-start"
                    style={{
                      background: "rgba(245,200,0,0.12)",
                      color: "#F5C800",
                      fontFamily: "var(--font-body)",
                      letterSpacing: "0.04em",
                      border: "1px solid rgba(245,200,0,0.25)",
                    }}
                  >
                    {t.swap}
                  </div>

                  {/* Author */}
                  <div
                    className="flex items-center gap-3 mt-auto pt-2"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    <div
                      className="w-9 h-9 shrink-0 flex items-center justify-center text-xs font-black"
                      style={{
                        background: "#C9A84C",
                        color: "#0D0D0D",
                        fontFamily: "var(--font-display)",
                      }}
                    >
                      {t.initials}
                    </div>
                    <div>
                      <div
                        className="text-sm font-bold leading-tight"
                        style={{
                          color: "#FAFAFA",
                          fontFamily: "var(--font-body)",
                        }}
                      >
                        {t.name}
                      </div>
                      <div
                        className="text-xs leading-tight"
                        style={{
                          color: "rgba(250,250,250,0.35)",
                          fontFamily: "var(--font-body)",
                        }}
                      >
                        {t.role}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div
          className="mt-12 sm:mt-20 grid grid-cols-3 gap-2 sm:gap-px w-full max-w-lg"
          style={{
            borderTop: "1px solid rgba(201,168,76,0.2)",
            paddingTop: "2rem",
          }}
        >
          {[
            { value: "4,200+", label: "Active Swappers" },
            { value: "180+", label: "Skills Listed" },
            { value: "97%", label: "Match Rate" },
          ].map(({ value, label }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <span
                className="text-2xl sm:text-3xl font-black"
                style={{ fontFamily: "var(--font-display)", color: "#F5C800" }}
              >
                {value}
              </span>
              <span
                className="text-[0.65rem] sm:text-xs tracking-wider uppercase text-center"
                style={{
                  color: "rgba(250,250,250,0.4)",
                  fontFamily: "var(--font-body)",
                  fontWeight: 600,
                }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      </main>

      {/* Footer strip */}
      <footer
        className="relative z-10 px-5 py-4 sm:px-10 flex flex-col sm:flex-row items-center justify-between gap-1 text-center text-xs"
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          color: "rgba(250,250,250,0.25)",
          fontFamily: "var(--font-body)",
        }}
      >
        {/* Same copyright line as the dashboard, readable on the dark page */}
        <Copyright className="font-medium" style={{ color: "rgba(250,250,250,0.6)" }} />
        <span>Knowledge without borders.</span>
      </footer>

      {/* Modal */}
      {modal?.type === "signup" && (
        <SignUpModal onClose={closeModal} onSignedUp={openSignInAfterSignUp} />
      )}
      {modal?.type === "signin" && (
        <SignInModal
          onClose={closeModal}
          initialUsername={modal.username}
          justSignedUp={modal.justSignedUp}
          onSwitchToSignUp={
            modal.justSignedUp ? undefined : () => setModal({ type: "signup" })
          }
        />
      )}
    </div>
  );
};

export default Landing;

// Request validation middleware.
//
// Mirrors the rules in frontend/src/utils/validation.js so the server enforces
// the same limits even when someone calls the API directly. Each schema maps a
// field name to a rule; a rule returns an error message or "".
//
// On success the cleaned values (and only the fields in the schema) are put on
// req.validated. On failure it responds 400 { message, field } with the first
// problem found, which the frontend uses to highlight that field.

const { looksLikeInjection } = require("./security");
const { stripInvisible, textSafetyProblem } = require("../services/contentSafety");

// Shown when a field contains an SQL/NoSQL/JavaScript injection payload
const INJECTION_MESSAGE =
  "This contains code-like text (such as database commands) that isn't allowed.";

// Strip control characters, normalize unicode, collapse runs of whitespace.
function cleanText(value) {
  return (
    String(value ?? "")
      .normalize("NFC")
      // eslint-disable-next-line no-control-regex -- intentionally stripping control chars
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

const NAME_CHARS_RE = /^[\p{L}\p{M}' ’-]+$/u;
const NAME_RE = /^\p{L}\p{M}*(?:[-'’ ]?\p{L}\p{M}*)*$/u;
const EMAIL_LOCAL_RE = /^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*$/;
const EMAIL_DOMAIN_RE =
  /^([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const TEXT_RE = /^[\p{L}\p{M}\p{N} &,.'()/:-]+$/u;
const PLACE_RE = /^[\p{L}\p{M}\p{N} ,.'’()/#&-]+$/u;
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

const PASSWORD_MAX = 72; // bcrypt ignores bytes past 72
const GRADUATED_OPTIONS = ["Yes", "No", "In Progress"];

const lengthError = (label, value, min, max) => {
  if (value.length === 0) return `${label} is required.`;
  if (value.length < min) return `${label} must be at least ${min} characters.`;
  if (value.length > max) return `${label} must be ${max} characters or fewer.`;
  return "";
};

// Marks a rule whose value must be checked exactly as sent (not trimmed or
// collapsed) — passwords, where every character counts.
const exact = (rule) => Object.assign((value) => rule(value), { exact: true });

const rules = {
  userName: (value) =>
    lengthError("Username", value, 3, 20) ||
    (USERNAME_RE.test(value)
      ? ""
      : "Username must start with a letter and use only letters, numbers and underscores."),

  password: exact((value) => {
    if (value.length === 0) return "Password is required.";
    if (Buffer.byteLength(value, "utf8") > PASSWORD_MAX)
      return `Password must be ${PASSWORD_MAX} characters or fewer.`;
    if (value.length < 8 || !/\d/.test(value) || !/[^A-Za-z0-9\s]/.test(value))
      return "Password must be at least 8 characters and include a number and a special character.";
    return "";
  }),

  name: (label) => (value) => {
    const lengthProblem = lengthError(label, value, 1, 50);
    if (lengthProblem) return lengthProblem;
    if (/\p{N}/u.test(value)) return `${label} can't contain numbers.`;
    if (!NAME_CHARS_RE.test(value))
      return `${label} can only contain letters, spaces, hyphens (-) and apostrophes (').`;
    if (!NAME_RE.test(value))
      return `Hyphens, apostrophes and spaces in ${label.toLowerCase()} must be between letters.`;
    return "";
  },

  // Must have exactly one "@" and a "." in the domain — same messages as
  // frontend/src/utils/validation.js
  email: (value) => {
    const lengthProblem = lengthError("Email", value, 1, 254);
    if (lengthProblem) return lengthProblem;
    const at = value.indexOf("@");
    if (at === -1) return "Email must include an @ symbol (e.g. maya@university.edu).";
    if (value.indexOf("@", at + 1) !== -1) return "Email can only contain one @ symbol.";
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    if (!local) return "Enter the part of your email before the @.";
    if (!domain) return "Enter the domain after the @ (e.g. university.edu).";
    if (!domain.includes("."))
      return 'Email domain must include a "." (e.g. university.edu).';
    if (local.length > 64 || !EMAIL_LOCAL_RE.test(local))
      return "The part before the @ contains invalid characters or dots.";
    if (!EMAIL_DOMAIN_RE.test(domain))
      return "Enter a valid email domain (e.g. university.edu).";
    return "";
  },

  letters: (label) => (value) =>
    lengthError(label, value, 2, 100) ||
    (/^[\p{L}\p{M} ]+$/u.test(value)
      ? ""
      : `${label} can only contain letters and spaces.`),

  text: (label) => (value) =>
    lengthError(label, value, 2, 100) ||
    (TEXT_RE.test(value)
      ? ""
      : `${label} can only contain letters, numbers, spaces and basic punctuation.`),

  oneOf: (label, options) => (value) =>
    options.includes(value) ? "" : `${label} must be one of: ${options.join(", ")}.`,

  // Free text that may be left empty (bio): a length limit, no HTML tags,
  // and the same safety checks as everything members can see
  // (services/contentSafety.js)
  freeText: (label, max) => (value) => {
    if (value.length > max) return `${label} must be ${max} characters or fewer.`;
    if (/[<>]/.test(value)) return `${label} can't contain < or >.`;
    return textSafetyProblem(value);
  },

  // Optional place name: letters, numbers, spaces and basic punctuation
  place: (label, max) => (value) => {
    if (!value) return "";
    if (value.length > max) return `${label} must be ${max} characters or fewer.`;
    return PLACE_RE.test(value)
      ? ""
      : `${label} can only contain letters, numbers, spaces and , . ' ( ) / # & -`;
  },

  // Sign-in only checks that something sensible was sent; whether it's
  // right is the password check's job, and it shouldn't hint at the rules.
  present: (label, max) =>
    exact((value) =>
      value.length === 0
        ? `${label} is required.`
        : value.length > max
          ? `${label} is too long.`
          : "",
    ),
};

const schemas = {
  signup: {
    firstName: rules.name("First name"),
    lastName: rules.name("Last name"),
    userName: rules.userName,
    email: rules.email,
    password: rules.password,
    occupation: rules.text("Occupation"),
    school: rules.letters("School"),
    major: rules.letters("Major"),
    graduated: rules.oneOf("Graduated", GRADUATED_OPTIONS),
  },
  signin: {
    userName: rules.present("Username", 100),
    password: rules.present("Password", 200),
  },
  usernameQuery: {
    username: rules.userName,
  },
  // Edit Profile (PATCH /auth/me): the sign-up details plus bio/location
  profile: {
    firstName: rules.name("First name"),
    lastName: rules.name("Last name"),
    userName: rules.userName,
    email: rules.email,
    occupation: rules.text("Occupation"),
    school: rules.letters("School"),
    major: rules.letters("Major"),
    graduated: rules.oneOf("Graduated", GRADUATED_OPTIONS),
    bio: rules.freeText("Bio", 300),
    location: rules.place("Location", 80),
  },
  passwordChange: {
    currentPassword: rules.present("Current password", 200),
    newPassword: rules.password,
  },
};

// validate("signup") → middleware that checks req.body against that schema.
// Pass source "query" to check the query string instead.
function validate(schemaName, source = "body") {
  const schema = schemas[schemaName];
  if (!schema) throw new Error(`Unknown validation schema: ${schemaName}`);

  return (req, res, next) => {
    const input = req[source] || {};
    const values = {};

    for (const [field, rule] of Object.entries(schema)) {
      const raw = input[field];
      // Reject objects/arrays outright (e.g. { "$gt": "" } query injection)
      if (raw !== undefined && raw !== null && typeof raw !== "string") {
        return res
          .status(400)
          .json({ message: `${field} must be text.`, field });
      }
      values[field] = rule.exact ? String(raw ?? "") : cleanText(stripInvisible(raw));
      // Injection payloads (passwords are exempt: they're only ever hashed)
      if (!rule.exact && looksLikeInjection(values[field])) {
        return res.status(400).json({ message: INJECTION_MESSAGE, field });
      }
      const error = rule(values[field]);
      if (error) return res.status(400).json({ message: error, field });
    }

    if (values.email) values.email = values.email.toLowerCase();
    req.validated = values;
    next();
  };
}

module.exports = { validate, cleanText };

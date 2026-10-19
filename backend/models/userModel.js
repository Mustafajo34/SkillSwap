const mongoose = require("mongoose");
const {
  SKILLS,
  SKILL_LEVELS,
  MAX_PROFILE_SKILLS,
} = require("../data/skills");

// A skill the member can teach, e.g. { name: "Guitar", level: "Expert" }
const skillSchema = new mongoose.Schema(
  {
    name: { type: String, enum: SKILLS, required: true },
    level: { type: String, enum: SKILL_LEVELS, required: true },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "first name is required!"],
      maxLength: [50, "first name cannot exceed 50 characters"],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, "lastname is required!"],
      maxLength: [50, "last name cannot exceed 50 characters"],
      trim: true,
    },
    userName: {
      type: String,
      required: [true, "username required"],
      minLength: [3, "username must be at least 3 characters"],
      maxLength: [20, "username cannot exceed 20 characters"],
      // Unique ignoring case — see the index below
      trim: true,
    },
    email: {
      type: String,
      required: [true, "email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [
        true,
        "password must be 8 characters long with at least 1 number, 1 special character!",
      ],
      minLength: 8,
    },
    // Hash of the current refresh token (single use — replaced on every
    // refresh; see routes/userRoute.js). Null = signed out.
    refreshToken: {
      type: String,
      default: null,
    },
    // The one it replaced, and when: a refresh whose answer got lost (network
    // blip) can still be retried briefly instead of looking like theft
    prevRefreshToken: { type: String, default: null },
    refreshRotatedAt: { type: Date, default: null },
    occupation: {
      type: String,
      required: [true, "occupation is required!"],
      trim: true,
    },
    school: {
      type: String,
      required: [true, "school is required!"],
      trim: true,
    },
    major: {
      type: String,
      required: [true, "major is required!"],
      trim: true,
    },
    graduated: {
      type: String,
      enum: ["Yes", "No", "In Progress"],
      default: "No",
      required: true,
    },

    // ── Public profile (Browse Skills) ──
    bio: {
      type: String,
      maxLength: [300, "bio cannot exceed 300 characters"],
      trim: true,
      default: "",
    },
    location: {
      type: String,
      maxLength: [80, "location cannot exceed 80 characters"],
      trim: true,
      default: "",
    },
    skills: {
      type: [skillSchema],
      default: [],
      validate: {
        validator: (list) => list.length <= MAX_PROFILE_SKILLS,
        message: `You can list up to ${MAX_PROFILE_SKILLS} skills`,
      },
    },
    // Profile photo: a small JPEG/PNG/WEBP data URL (the browser shrinks it
    // to 256px before upload — see PUT /auth/me/avatar)
    avatar: { type: String, default: null, maxLength: 150000 },
    // Changes whenever the photo does (null = no photo). The app loads photos
    // from GET /avatars/:id?v=<photoVersion>, so browsers can cache each
    // version forever and still see a new photo straight away.
    photoVersion: { type: Number, default: null },
    // Completed skill swap meetings and the ratings they earned. Updated by
    // the swap/review flow, never directly by the member.
    swapCount: { type: Number, default: 0, min: 0 },
    ratingSum: { type: Number, default: 0, min: 0 },
    ratingCount: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
  },
);

// Browse Skills looks members up by the skills they teach
userSchema.index({ "skills.name": 1 });

// Compares strings ignoring case, so "Chris" and "chris" are the same
// username. Queries on userName must use it too to hit this index.
const USERNAME_COLLATION = { locale: "en", strength: 2 };

userSchema.index(
  { userName: 1 },
  { unique: true, collation: USERNAME_COLLATION, name: "userName_ci" },
);

userSchema.statics.USERNAME_COLLATION = USERNAME_COLLATION;

userSchema.methods.toPublic = function () {
  return {
    id: this.id,
    firstName: this.firstName,
    lastName: this.lastName,
    userName: this.userName,
    email: this.email,
    occupation: this.occupation,
    school: this.school,
    major: this.major,
    graduated: this.graduated,
    bio: this.bio,
    location: this.location,
    skills: this.skills.map(({ name, level }) => ({ name, level })),
    // Photo version for /avatars/:id (null = no photo); the image itself is
    // served separately so account responses stay small
    photoV: this.avatar ? this.photoVersion || null : null,
  };
};

// Average rating out of 5, one decimal place; null until the first review
userSchema.statics.averageRating = ({ ratingSum, ratingCount }) =>
  ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null;

module.exports = mongoose.model("User", userSchema);

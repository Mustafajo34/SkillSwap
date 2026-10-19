// Adds sample members (with skills, ratings and friendships between them)
// so Browse Skills has people to show in development.
//
//   npm run seed:members         add / refresh the sample members
//   npm run seed:members:reset   remove them again
//
// Sample accounts use the reserved "@demo.skillswap.invalid" email domain,
// so they never collide with real sign-ups and are easy to remove. They get
// a random password unless DEMO_PASSWORD is set in .env (handy for signing
// in as one of them to test friend requests from the other side).

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const crypto = require("crypto");
const mongoose = require("mongoose");
const bcryptjs = require("bcryptjs");
const User = require("../models/userModel");
const Friendship = require("../models/friendshipModel");

const DEMO_DOMAIN = "demo.skillswap.invalid";
const DEMO_EMAIL_RE = /@demo\.skillswap\.invalid$/;

// friends: positions (1-based) of other members in this list
const members = [
  { name: "Priya Patel", occupation: "Music teacher", location: "Chicago, IL",
    bio: "Gigging guitarist for 12 years. I love helping beginners get their first songs under their fingers — patience guaranteed.",
    skills: [["Guitar", "Expert"], ["Piano", "Intermediate"], ["Creative Writing", "Intermediate"]],
    friends: [11, 14, 16], swaps: 37, rating: 4.9, reviews: 31 },
  { name: "Marcus Green", occupation: "Data analyst", location: "Evanston, IL",
    bio: "I turn messy spreadsheets into clear answers. Happy to teach Python and data basics in exchange for anything creative.",
    skills: [["Python", "Expert"], ["Data Analysis", "Expert"], ["Excel", "Advanced"], ["JavaScript", "Intermediate"]],
    friends: [12, 14, 10], swaps: 52, rating: 4.8, reviews: 44 },
  { name: "Sofia Alvarez", occupation: "Translator", location: "Pilsen, Chicago",
    bio: "Native Spanish speaker, fluent in French. Conversation-first lessons with lots of real-world phrases and a little cooking on the side.",
    skills: [["Spanish", "Expert"], ["French", "Advanced"], ["Cooking", "Intermediate"]],
    friends: [8, 13], swaps: 41, rating: 5.0, reviews: 36 },
  { name: "Ethan Brooks", occupation: "Videographer", location: "Oak Park, IL",
    bio: "Wedding and documentary shooter. I'll show you composition, lighting and editing workflows that make footage feel cinematic.",
    skills: [["Photography", "Expert"], ["Video Editing", "Expert"], ["Animation", "Intermediate"]],
    friends: [7, 13, 16], swaps: 29, rating: 4.7, reviews: 22 },
  { name: "Lena Novak", occupation: "Product designer", location: "West Loop, Chicago",
    bio: "Designing apps for 8 years. I teach UI/UX through real portfolio projects and honest critique.",
    skills: [["UI/UX Design", "Expert"], ["Illustration", "Advanced"], ["Web Development", "Intermediate"]],
    friends: [7, 10], swaps: 46, rating: 4.9, reviews: 40 },
  { name: "Kwame Mensah", occupation: "Project manager", location: "Hyde Park, Chicago",
    bio: "Toastmasters club president and PMP. I help people speak with confidence and run projects without the chaos.",
    skills: [["Public Speaking", "Expert"], ["Project Management", "Expert"], ["Personal Finance", "Intermediate"]],
    friends: [11, 12, 16], swaps: 58, rating: 4.8, reviews: 51 },
  { name: "Hana Sato", occupation: "Illustrator", location: "Logan Square, Chicago",
    bio: "Children's book illustrator and hobby seamstress. Sketchbook sessions, character design and simple sewing projects.",
    skills: [["Illustration", "Expert"], ["Animation", "Advanced"], ["Sewing", "Intermediate"]],
    friends: [4, 5, 15], swaps: 24, rating: 4.9, reviews: 19 },
  { name: "Diego Ramos", occupation: "Chef", location: "Little Village, Chicago",
    bio: "Line cook turned private chef. Knife skills, weeknight meals and Mexican classics — plus morning yoga to balance it out.",
    skills: [["Cooking", "Expert"], ["Spanish", "Expert"], ["Yoga", "Intermediate"]],
    friends: [3, 11, 15], swaps: 33, rating: 4.6, reviews: 27 },
  { name: "Amara Okafor", occupation: "Marketing lead", location: "River North, Chicago",
    bio: "I've grown brands from zero to 100k followers. Strategy, copy that converts and social content that people actually share.",
    skills: [["Digital Marketing", "Expert"], ["Social Media", "Expert"], ["Copywriting", "Advanced"]],
    friends: [13, 15, 16], swaps: 61, rating: 4.9, reviews: 55 },
  { name: "Jordan Lee", occupation: "Front-end engineer", location: "Wicker Park, Chicago",
    bio: "React developer who loves teaching JavaScript fundamentals. Bring a project idea and we'll build it together.",
    skills: [["JavaScript", "Expert"], ["Web Development", "Expert"], ["UI/UX Design", "Intermediate"]],
    friends: [2, 5, 14], swaps: 49, rating: 4.8, reviews: 42 },
  { name: "Maya Chen", occupation: "Yoga instructor", location: "Lakeview, Chicago",
    bio: "Certified yoga teacher and budgeting nerd. Gentle flows for beginners and simple money habits that stick.",
    skills: [["Yoga", "Expert"], ["Personal Finance", "Advanced"], ["Creative Writing", "Intermediate"]],
    friends: [1, 6, 8], swaps: 38, rating: 5.0, reviews: 33 },
  { name: "Theo Martin", occupation: "Operations analyst", location: "Naperville, IL",
    bio: "Excel power user — pivot tables, formulas and dashboards. I also coach on keeping projects on track.",
    skills: [["Excel", "Expert"], ["Data Analysis", "Advanced"], ["Project Management", "Advanced"]],
    friends: [2, 6], swaps: 22, rating: 4.6, reviews: 18 },
  { name: "Chloé Dubois", occupation: "Copywriter", location: "Lincoln Park, Chicago",
    bio: "Born in Lyon, writing in Chicago. French conversation, street photography walks and punchy copywriting.",
    skills: [["French", "Expert"], ["Photography", "Advanced"], ["Copywriting", "Expert"]],
    friends: [3, 4, 9], swaps: 35, rating: 4.8, reviews: 29 },
  { name: "Ravi Kumar", occupation: "Software engineer", location: "Schaumburg, IL",
    bio: "Backend engineer by day, acoustic guitarist by night. Python and web development from first principles.",
    skills: [["Python", "Advanced"], ["Web Development", "Advanced"], ["Guitar", "Intermediate"]],
    friends: [1, 2, 10], swaps: 27, rating: 4.7, reviews: 21 },
  { name: "Nina Rossi", occupation: "Fashion designer", location: "Bucktown, Chicago",
    bio: "Sewing since I was nine. Alterations, simple patterns and Italian home cooking — and I'll help your brand shine on social.",
    skills: [["Sewing", "Expert"], ["Cooking", "Advanced"], ["Social Media", "Intermediate"]],
    friends: [7, 8, 9], swaps: 31, rating: 4.9, reviews: 26 },
  { name: "Sam Carter", occupation: "Content creator", location: "Uptown, Chicago",
    bio: "YouTuber with a knack for editing and storytelling. Video editing, growth marketing, speaking on camera and a bit of piano.",
    skills: [["Video Editing", "Advanced"], ["Digital Marketing", "Advanced"], ["Public Speaking", "Advanced"], ["Piano", "Intermediate"]],
    friends: [1, 4, 6, 9], swaps: 44, rating: 4.7, reviews: 38 },
];

// "Chloé Dubois" → "chloe_dubois" (fits the 3–20 char username rule)
const slug = (name) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);

async function removeDemo() {
  const demo = await User.find({ email: DEMO_EMAIL_RE }).select("_id").lean();
  const ids = demo.map((u) => u._id);
  const links = await Friendship.deleteMany({
    $or: [{ requester: { $in: ids } }, { recipient: { $in: ids } }],
  });
  const users = await User.deleteMany({ _id: { $in: ids } });
  console.log(
    `Removed ${users.deletedCount} sample members and ${links.deletedCount} friendships/requests.`,
  );
}

async function upsertMember(m, passwordHash) {
  const [firstName, ...rest] = m.name.split(" ");
  const base = slug(m.name);
  const email = `${base.replace(/_/g, ".")}@${DEMO_DOMAIN}`;
  const fields = {
    firstName,
    lastName: rest.join(" "),
    occupation: m.occupation,
    school: "SkillSwap Community",
    major: "Community Member",
    graduated: "Yes",
    bio: m.bio,
    location: m.location,
    skills: m.skills.map(([name, level]) => ({ name, level })),
    swapCount: m.swaps,
    ratingSum: Math.round(m.rating * m.reviews),
    ratingCount: m.reviews,
  };

  // A real user may already own the username — add a number if so
  for (let attempt = 0; attempt < 5; attempt++) {
    const userName = attempt ? `${base.slice(0, 17)}_${attempt + 1}` : base;
    try {
      return await User.findOneAndUpdate(
        { email },
        { $set: { ...fields, userName }, $setOnInsert: { password: passwordHash } },
        { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
      ).collation(User.USERNAME_COLLATION);
    } catch (error) {
      if (error.code !== 11000 || !error.keyPattern?.userName) throw error;
    }
  }
  throw new Error(`No free username for ${m.name}`);
}

async function main() {
  if (!process.env.MONGODB) throw new Error("MONGODB is not set in .env");
  await mongoose.connect(process.env.MONGODB);
  await Promise.all([User.init(), Friendship.init()]); // build indexes

  if (process.argv.includes("--reset")) {
    await removeDemo();
    return;
  }

  const password = process.env.DEMO_PASSWORD || crypto.randomBytes(24).toString("base64url");
  const passwordHash = await bcryptjs.hash(password, 12);

  const docs = [];
  for (const m of members) docs.push(await upsertMember(m, passwordHash));

  let friendships = 0;
  for (const [i, m] of members.entries()) {
    for (const position of m.friends) {
      const a = docs[i];
      const b = docs[position - 1];
      const pair = Friendship.pairKey(a._id, b._id);
      await Friendship.updateOne(
        { pair },
        {
          $setOnInsert: { requester: a._id, recipient: b._id, pair },
          $set: { status: "accepted", acceptedAt: new Date() },
        },
        { upsert: true },
      );
      friendships++;
    }
  }

  console.log(`Seeded ${docs.length} sample members (${friendships} friend links).`);
  console.log(
    process.env.DEMO_PASSWORD
      ? `Sign in as any of them, e.g. "${docs[0].userName}", with DEMO_PASSWORD.`
      : "They have random passwords (set DEMO_PASSWORD in .env to sign in as one).",
  );
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

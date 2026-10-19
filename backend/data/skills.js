// Skills members can list on their profile. Matches the `skills` list in
// frontend/src/components/BrowseSkill.jsx — add new skills to both.
const SKILLS = [
  "UI/UX Design",
  "JavaScript",
  "Photography",
  "Spanish",
  "Public Speaking",
  "Guitar",
  "Digital Marketing",
  "Python",
  "Creative Writing",
  "Yoga",
  "Video Editing",
  "French",
  "Data Analysis",
  "Cooking",
  "Illustration",
  "Project Management",
  "Piano",
  "Social Media",
  "Web Development",
  "Personal Finance",
  "Animation",
  "Excel",
  "Copywriting",
  "Sewing",
];

// How well a member can teach a skill, lowest to highest
const SKILL_LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"];

const MAX_PROFILE_SKILLS = 10;

module.exports = { SKILLS, SKILL_LEVELS, MAX_PROFILE_SKILLS };

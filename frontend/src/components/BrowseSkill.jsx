import { useEffect, useMemo, useRef, useState } from "react";
import SkillPeople from "./SkillPeople";
import { searchError, SEARCH_MAX } from "../utils/validation";
import "../css/BrowseSkill.css";

const skills = [
  { name: "UI/UX Design", category: "Design", level: "All levels" },
  { name: "JavaScript", category: "Development", level: "Intermediate" },
  { name: "Photography", category: "Creative", level: "Beginner" },
  { name: "Spanish", category: "Languages", level: "All levels" },
  { name: "Public Speaking", category: "Business", level: "Beginner" },
  { name: "Guitar", category: "Music", level: "All levels" },
  { name: "Digital Marketing", category: "Marketing", level: "Intermediate" },
  { name: "Python", category: "Development", level: "Beginner" },
  { name: "Creative Writing", category: "Writing", level: "All levels" },
  { name: "Yoga", category: "Wellness", level: "Beginner" },
  { name: "Video Editing", category: "Creative", level: "Intermediate" },
  { name: "French", category: "Languages", level: "All levels" },
  { name: "Data Analysis", category: "Data", level: "Intermediate" },
  { name: "Cooking", category: "Lifestyle", level: "Beginner" },
  { name: "Illustration", category: "Design", level: "All levels" },
  { name: "Project Management", category: "Business", level: "Intermediate" },
  { name: "Piano", category: "Music", level: "Beginner" },
  { name: "Social Media", category: "Marketing", level: "All levels" },
  { name: "Web Development", category: "Development", level: "Beginner" },
  { name: "Personal Finance", category: "Finance", level: "All levels" },
  { name: "Animation", category: "Creative", level: "Intermediate" },
  { name: "Excel", category: "Business", level: "Beginner" },
  { name: "Copywriting", category: "Writing", level: "All levels" },
  { name: "Sewing", category: "Lifestyle", level: "Beginner" },
];

function SearchIcon({ className = "" }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

const BrowseSkill = () => {
  const [query, setQuery] = useState("");
  // Skill whose teachers are shown in the people table
  const [selected, setSelected] = useState(null);
  const peopleRef = useRef(null);

  // Bring the people table into view when a skill is picked. The dashboard
  // scrolls inside its own panel, so scrollIntoView rather than window.scrollTo.
  useEffect(() => {
    if (selected)
      peopleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);


  // Search is checked as you type: letters and a little punctuation only —
  // no numbers, script tags, code or commands (see searchError)
  const problem = searchError(query);

  const visibleSkills = useMemo(() => {
    if (searchError(query)) return [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return skills;

    // Only skills whose name starts with what you've typed: "gu" → Guitar
    return skills.filter(({ name }) => name.toLowerCase().startsWith(normalizedQuery));
  }, [query]);

  return (
    <div
      className="browse-skills min-h-full bg-background text-foreground selection:bg-primary selection:text-primary-foreground"
    >
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden="true"
          className="absolute -right-24 top-14 h-64 w-64 rounded-full bg-primary/10 blur-3xl sm:h-96 sm:w-96"
        />
        <div
          aria-hidden="true"
          className="absolute -left-32 bottom-0 h-64 w-64 rounded-full bg-accent/5 blur-3xl"
        />

        <div className="relative mx-auto max-w-4xl px-5 py-10 text-center sm:px-8 sm:py-12 lg:py-14">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Community-powered learning
          </div>
          <h1 className="text-4xl font-black leading-none tracking-tight sm:text-6xl lg:text-7xl">
            Browse <span className="text-primary">Skills</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Search skills shared by real people, then swap what you know for
            what you want to learn.
          </p>

          <form
            className="mx-auto mt-6 max-w-2xl"
            onSubmit={(event) => event.preventDefault()}
            role="search"
          >
            <label className="sr-only" htmlFor="skill-search">
              Search for a skill
            </label>
            <div className="group relative">
              <SearchIcon className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
              <input
                autoComplete="off"
                spellCheck={false}
                className={`h-16 w-full rounded-2xl border bg-card pl-14 pr-24 text-base font-medium text-foreground shadow-xl shadow-black/10 outline-none transition-all placeholder:text-muted-foreground focus:ring-4 sm:h-18 sm:text-lg ${
                  problem
                    ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                    : "border-border focus:border-primary focus:ring-primary/20"
                }`}
                id="skill-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Try “Photography” or “Python”"
                type="search"
                value={query}
                maxLength={SEARCH_MAX}
                aria-invalid={Boolean(problem)}
                aria-describedby={problem ? "skill-search-error" : undefined}
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card"
                type="submit"
              >
                Search
              </button>
            </div>
            {problem && (
              <p
                id="skill-search-error"
                role="alert"
                className="mt-3 text-left text-sm font-semibold text-red-500"
              >
                {problem}
              </p>
            )}
          </form>
        </div>
      </section>

      <section
        className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12"
        id="skills"
      >
        <div ref={peopleRef} className="scroll-mt-4">
          {selected && (
            <SkillPeople
              key={selected}
              skill={selected}
              onClose={() => setSelected(null)}
            />
          )}
        </div>

        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
              Find your next skill
            </p>
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
              {query && !problem ? "Search results" : "Skills to explore"}
            </h2>
          </div>
          <p
            aria-live="polite"
            className="shrink-0 text-sm font-semibold text-muted-foreground"
          >
            {visibleSkills.length}{" "}
            {visibleSkills.length === 1 ? "skill" : "skills"}
          </p>
        </div>

        {visibleSkills.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleSkills.map((skill, index) => (
              <button
                className={`group flex min-h-32 flex-col justify-between rounded-2xl border bg-card p-5 text-left text-card-foreground transition-all duration-200 hover:-translate-y-1 hover:border-primary/60 hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring ${
                  selected === skill.name
                    ? "border-primary ring-2 ring-primary/40"
                    : "border-border"
                }`}
                key={skill.name}
                aria-pressed={selected === skill.name}
                onClick={() =>
                  setSelected((current) =>
                    current === skill.name ? null : skill.name,
                  )
                }
                type="button"
              >
                <div className="flex w-full items-start justify-between gap-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-primary">
                    {skill.category}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground/70">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="mt-7 flex w-full items-end justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-foreground">
                      {skill.name}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">{skill.level}</p>
                  </div>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <ArrowIcon />
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <SearchIcon className="mx-auto h-8 w-8 text-primary" />
            <h3 className="mt-5 text-xl font-bold">
              {problem ? "Check your search" : "No skills found"}
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {problem
                ? `${problem} Try a skill name like “Guitar” or “UI/UX Design.”`
                : `No skill names start with “${query.trim()}.” Try the first letters of a skill, like “Gui” for Guitar.`}
            </p>
            <button
              className="mt-6 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              onClick={() => setQuery("")}
              type="button"
            >
              Clear search
            </button>
          </div>
        )}
      </section>
    </div>
  );
};

export default BrowseSkill;

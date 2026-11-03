export const storyboardScriptFileName = "storyboard-script.md";

export type StoryboardScriptShot = {
  id: string;
  order: number;
  scriptText?: string;
};

export type StoryboardScriptProject<Shot extends StoryboardScriptShot = StoryboardScriptShot> = {
  shots: Shot[];
  updatedAt: string;
};

export type StoryboardScriptImportPlanItem =
  | { type: "existing"; shotId: string; scriptText: string }
  | { type: "new"; scriptText: string };

const trimLineEnd = (line: string): string => line.replace(/[ \t]+$/u, "");

const normalizeStoryboardScriptText = (text: string): string =>
  text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map(trimLineEnd)
    .join("\n")
    .trimEnd();

const sortedProjectShots = <Shot extends StoryboardScriptShot>(shots: Shot[]): Shot[] =>
  [...shots].sort((a, b) => a.order - b.order);

const scriptTextForShot = (shot: StoryboardScriptShot): string =>
  normalizeStoryboardScriptText(shot.scriptText ?? "");

export const serializeStoryboardScriptMarkdown = (project: StoryboardScriptProject): string => {
  return `${sortedProjectShots(project.shots)
    .map((shot, index) => {
      const lines = scriptTextForShot(shot).split("\n");
      const [firstLine = "", ...rest] = lines;
      const marker = `${index + 1}. `;
      const first = `${marker}${firstLine}`;
      return [first, ...rest.map((line) => `${" ".repeat(marker.length)}${line}`)].join("\n");
    })
    .join("\n")}\n`;
};

export const parseStoryboardScriptMarkdown = (markdown: string): string[] => {
  const entries: string[] = [];
  let current: string[] | undefined;

  for (const rawLine of markdown.replace(/\r\n?/gu, "\n").split("\n")) {
    const line = trimLineEnd(rawLine);
    const numbered = /^(\d+)\.\s?(.*)$/u.exec(line);

    if (numbered) {
      if (current) {
        entries.push(current.join("\n").trimEnd());
      }
      current = [numbered[2] ?? ""];
      continue;
    }

    if (!current || /^\s*$/u.test(line)) {
      continue;
    }

    const continuation = /^ {3,}(.*)$/u.exec(line);
    if (continuation) {
      current.push(continuation[1] ?? "");
    }
  }

  if (current) {
    entries.push(current.join("\n").trimEnd());
  }

  return entries;
};

export const storyboardScriptEntriesForProject = (project: StoryboardScriptProject): string[] =>
  sortedProjectShots(project.shots).map(scriptTextForShot);

export const storyboardScriptNeedsImport = (
  project: StoryboardScriptProject,
  markdown: string
): boolean => {
  const projectEntries = storyboardScriptEntriesForProject(project);
  const markdownEntries = parseStoryboardScriptMarkdown(markdown);

  return (
    projectEntries.length !== markdownEntries.length ||
    projectEntries.some((entry, index) => entry !== markdownEntries[index])
  );
};

export const planStoryboardScriptImport = (
  project: StoryboardScriptProject,
  markdownEntries: string[]
): StoryboardScriptImportPlanItem[] => {
  const remainingShots = sortedProjectShots(project.shots);
  if (markdownEntries.length === remainingShots.length) {
    return remainingShots.map((shot, index) => ({
      type: "existing",
      shotId: shot.id,
      scriptText: markdownEntries[index] ?? ""
    }));
  }

  const plan: StoryboardScriptImportPlanItem[] = [];

  for (const scriptText of markdownEntries) {
    const matchIndex = remainingShots.findIndex((shot) => scriptTextForShot(shot) === scriptText);
    if (matchIndex === -1) {
      plan.push({ type: "new", scriptText });
      continue;
    }

    const [shot] = remainingShots.splice(matchIndex, 1);
    plan.push({ type: "existing", shotId: shot.id, scriptText });
  }

  return [
    ...plan,
    ...remainingShots.map((shot) => ({
      type: "existing" as const,
      shotId: shot.id,
      scriptText: scriptTextForShot(shot)
    }))
  ];
};

export const applyStoryboardScriptImportPlan = <Project extends StoryboardScriptProject>(
  project: Project,
  plan: StoryboardScriptImportPlanItem[],
  newShots: Project["shots"]
): Project => {
  const existingById = new Map(project.shots.map((shot) => [shot.id, shot]));
  const newQueue = [...newShots];
  const shots = plan.map((item, order) => {
    const shot = item.type === "existing" ? existingById.get(item.shotId) : newQueue.shift();
    if (!shot) {
      throw new Error("Missing shot for storyboard script import plan");
    }

    return {
      ...shot,
      order,
      scriptText: item.scriptText
    };
  });

  return {
    ...project,
    shots,
    updatedAt: new Date().toISOString()
  };
};

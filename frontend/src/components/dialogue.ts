import { personaLines, type DialogueGroup, type Stage, type Tone } from "./personaLines";

export type DialogueContext = { task?: string; video?: string };
export type DialogueRequest = {
  id: string; tone: Tone; group: DialogueGroup; stage: Stage | 0; hasTask: boolean; hasVideo: boolean;
};
type DialoguePool = Pick<DialogueRequest, "tone" | "group"> & { stage: Stage };
export type DialogueSelection = { template: string; stage: Stage };

const variables = /\{(task|video)\}/g;
export const profanity = /씨[\s·]*발|시[\s·]*발|개[\s·]*(?:같|새[\s·]*끼)|존[\s·]*나|좆|병[\s·]*신|지랄|빌어먹|젠장|미친|개망|ㅅㅂ|ㅆㅂ/i;

function displayValue(value: string | undefined, limit: number, tone: Tone) {
  const normalized = value?.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  if (!normalized || (tone === "default" && profanity.test(normalized))) return undefined;
  // Values are not templates. Obvious placeholder-shaped input stays literal and
  // cannot introduce another substitution.
  const characters = Array.from(normalized.replaceAll("{", "｛").replaceAll("}", "｝"));
  return characters.length > limit ? characters.slice(0, limit - 1).join("") + "…" : characters.join("");
}

export function dialogueContext(tone: Tone, values: DialogueContext): DialogueContext {
  return { task: displayValue(values.task, 28, tone), video: displayValue(values.video, 36, tone) };
}

export function poolFor({ tone, group, stage }: DialoguePool): readonly string[] {
  return group === "youtube" || group === "inactivity" ? personaLines[tone][group][stage] : personaLines[tone][group];
}

function available(line: string, hasTask: boolean, hasVideo: boolean) {
  return (hasTask || !line.includes("{task}")) && (hasVideo || !line.includes("{video}"));
}

export function renderDialogue({ template, stage }: DialogueSelection, request: DialogueRequest, context: DialogueContext) {
  // A view can receive the event before its task snapshot. Keep placeholders
  // private and use a complete line from the same pool until context arrives.
  const pool = poolFor({ ...request, stage });
  const line = pool.includes(template) && available(template, !!context.task, !!context.video)
    ? template : pool.find(item => available(item, !!context.task, !!context.video))!;
  return line.replace(variables, (_, name: "task" | "video") => context[name]!);
}

export function pickDialogue(pool: readonly string[], recent: readonly string[], random: () => number) {
  const fresh = pool.filter(line => !recent.includes(line));
  const avoidPrevious = fresh.length ? fresh : pool.filter(line => line !== recent.at(-1));
  const candidates = avoidPrevious.length ? avoidPrevious : pool;
  return candidates[Math.floor(random() * candidates.length)];
}

export function createDialogueSelector(random = Math.random) {
  const events = new Map<string, string>();
  const recent = new Map<string, string[]>();
  const inactivityStages = new Map<string, Stage>();
  return (request: DialogueRequest) => {
    const { group, tone, id } = request;
    // The detector reports zero after input resumes but keeps the same question.
    // Late-opening windows reuse its previous stage without knowing a timer.
    const stage = request.stage || (group === "inactivity" && inactivityStages.get(id)) || 1;
    if (group === "inactivity" && request.stage) {
      inactivityStages.set(id, stage);
      if (inactivityStages.size > 128) inactivityStages.delete(inactivityStages.keys().next().value!);
    }
    const pool = `${tone}:${group}:${stage}`;
    const event = `${pool}:${request.id}`;
    const previous = events.get(event);
    if (previous !== undefined) return { template: previous, stage };
    const choices = poolFor({ tone, group, stage }).filter(line => available(line, request.hasTask, request.hasVideo));
    const history = recent.get(pool) ?? [];
    const template = pickDialogue(choices, history, random);
    events.set(event, template);
    if (events.size > 128) events.delete(events.keys().next().value!);
    recent.set(pool, [...history, template].slice(-5));
    return { template, stage };
  };
}

export function dialogueStage(stage: number | undefined): Stage {
  return stage === 2 || stage === 3 ? stage : 1;
}

export function isDialogueRequest(value: DialogueRequest | undefined): value is DialogueRequest {
  return !!value && typeof value.id === "string" && value.id.length <= 160 &&
    (value.tone === "default" || value.tone === "hardcore") &&
    (value.group === "youtube" || value.group === "inactivity" || value.group === "return" || value.group === "study") &&
    (value.stage === 1 || value.stage === 2 || value.stage === 3 || (value.stage === 0 && value.group === "inactivity")) &&
    typeof value.hasTask === "boolean" && typeof value.hasVideo === "boolean";
}

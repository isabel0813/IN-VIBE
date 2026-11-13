import type { TaskDraft } from "../api/types";
import { fromKstInput, toKstInput } from "./time";

export interface EditableDraft {
  key: string;
  name: string;
  deadline: string;
  minutes: string;
  important: boolean;
}

export function blankDraft(name = ""): EditableDraft {
  return {
    key: crypto.randomUUID(),
    name,
    deadline: "",
    minutes: "60",
    important: false,
  };
}

export function editDraft(draft: TaskDraft): EditableDraft {
  return {
    key: crypto.randomUUID(),
    name: draft.name,
    deadline: toKstInput(draft.deadline),
    minutes: String(draft.estimated_minutes),
    important: draft.important,
  };
}

export function validateDrafts(drafts: EditableDraft[]): string | null {
  if (!drafts.length || drafts.length > 30)
    return "작업은 한 번에 1~30개까지 등록할 수 있어요.";
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    if (!draft.name.trim() || draft.name.trim().length > 100)
      return `${i + 1}번째 작업 이름은 1~100자로 입력해 주세요.`;
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft.deadline) ||
      Number.isNaN(Date.parse(fromKstInput(draft.deadline)))
    )
      return `${i + 1}번째 작업의 마감 날짜와 시간을 입력해 주세요.`;
    const minutes = Number(draft.minutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 6000)
      return `${i + 1}번째 예상 시간은 5~6000분 사이의 정수로 입력해 주세요.`;
  }
  return null;
}

export function serializeDrafts(drafts: EditableDraft[]): TaskDraft[] {
  return drafts.map((draft) => ({
    name: draft.name.trim(),
    deadline: fromKstInput(draft.deadline),
    important: draft.important,
    estimated_minutes: Number(draft.minutes),
  }));
}

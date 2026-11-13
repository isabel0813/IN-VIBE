import type { EditableDraft } from "../lib/drafts";
import { blankDraft } from "../lib/drafts";
import Icon from "./Icon";

interface Props {
  drafts: EditableDraft[];
  onChange: (drafts: EditableDraft[]) => void;
  assumptions: string[];
  busy: boolean;
  editing: boolean;
  error: string;
  onSave: () => void;
  onBack: () => void;
}

export default function DraftEditor({
  drafts,
  onChange,
  assumptions,
  busy,
  editing,
  error,
  onSave,
  onBack,
}: Props) {
  function change(key: string, patch: Partial<EditableDraft>) {
    onChange(
      drafts.map((draft) =>
        draft.key === key ? { ...draft, ...patch } : draft,
      ),
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {editing ? "EDIT TASK" : "CHECK YOUR TASKS"}
          </span>
          <h1>
            {editing
              ? "작업을 수정해 볼까요?"
              : "시작하기 전에, 한 번 확인해요."}
          </h1>
          <p>
            마감과 예상 시간을 확인해 주세요. 모든 시간은 한국 시간 기준이에요.
          </p>
        </div>
      </div>
      {assumptions.length > 0 && (
        <aside className="notice">
          <Icon name="spark" />
          <div>
            <strong>초안을 만들 때 참고한 내용</strong>
            <ul>
              {assumptions.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          </div>
        </aside>
      )}
      <fieldset disabled={busy} className="draft-fieldset">
        <div className="drafts">
          {drafts.map((draft, index) => (
            <section
              className="draft-card"
              key={draft.key}
              aria-label={`작업 ${index + 1}`}
            >
              <div className="draft-top">
                <span className="small-label">
                  작업 {String(index + 1).padStart(2, "0")}
                </span>
                {!editing && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`${index + 1}번째 작업 삭제`}
                    onClick={() =>
                      onChange(drafts.filter((item) => item.key !== draft.key))
                    }
                  >
                    <Icon name="close" />
                  </button>
                )}
              </div>
              <label className="field">
                작업 이름
                <input
                  autoFocus={index === 0}
                  required
                  maxLength={100}
                  placeholder="어떤 일을 해야 하나요?"
                  value={draft.name}
                  onChange={(event) =>
                    change(draft.key, { name: event.target.value })
                  }
                />
              </label>
              <div className="draft-details">
                <label className="field">
                  마감 시간 (한국 시간)
                  <input
                    type="datetime-local"
                    required
                    value={draft.deadline}
                    onChange={(event) =>
                      change(draft.key, { deadline: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  예상 소요시간 (분)
                  <input
                    type="number"
                    required
                    min="5"
                    max="6000"
                    step="1"
                    value={draft.minutes}
                    onChange={(event) =>
                      change(draft.key, { minutes: event.target.value })
                    }
                  />
                </label>
                <label className="importance">
                  <input
                    type="checkbox"
                    checked={draft.important}
                    onChange={(event) =>
                      change(draft.key, { important: event.target.checked })
                    }
                  />
                  중요한 작업
                </label>
              </div>
            </section>
          ))}
        </div>
        {!editing && (
          <button
            type="button"
            className="add-draft"
            disabled={drafts.length >= 30}
            onClick={() => onChange([...drafts, blankDraft()])}
          >
            <Icon name="plus" /> 작업 추가 <span>{drafts.length}/30</span>
          </button>
        )}
      </fieldset>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onBack}
        >
          돌아가기
        </button>
        <button className="primary" disabled={busy || !drafts.length}>
          {busy
            ? "저장하는 중…"
            : editing
              ? "수정하고 계획 보기"
              : "저장하고 계획 보기"}
          <Icon name="arrow" />
        </button>
      </div>
    </form>
  );
}

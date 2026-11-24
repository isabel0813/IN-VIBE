import { useEffect, useRef, useState } from "react";
import { createDialogueSelector, dialogueContext, renderDialogue, type DialogueSelection } from "../components/dialogue";
import Icon from "../components/Icon";
import { ResponseButtons } from "../components/persona";
import type { DialogueGroup, Stage, Tone } from "../components/personaLines";
import UltimateDialog from "../components/UltimateDialog";
import { characterArt } from "../widget/character";

type Scenario = {
  id: string;
  label: string;
  note: string;
  video?: string;
  prompt?: "youtube" | "inactivity";
};
const scenarios: readonly Scenario[] = [
  { id: "study", label: "공부 관련 YouTube 영상", video: "강의로 전자기 유도 공부하기", note: "공부 관련 영상으로 가정했어요. 안뇽이는 개입하지 않아요." },
  { id: "music", label: "배경음악 재생", video: "집중용 잔잔한 연주곡", note: "배경음악으로 가정했어요. 안뇽이는 개입하지 않아요." },
  { id: "game", label: "게임 영상 시청", video: "롤 하이라이트 모음", prompt: "youtube", note: "집중 목표와 다른 게임 영상을 보는 상황이에요." },
  { id: "unrelated", label: "공부와 무관한 영상 시청", video: "예능 하이라이트 모음", prompt: "youtube", note: "집중 목표와 무관한 영상이 재생되는 상황이에요." },
  { id: "inactivity", label: "Windows 무입력 상황", prompt: "inactivity", note: "입력이 멈춘 상황이에요. 책을 읽거나 손으로 문제를 풀고 있을 수도 있어요." },
];
const milestones = [0, 10_000, 20_000, 30_000] as const;
type Outcome = "return" | "study";
type Observation = { id: number; scenario: Scenario; startedAt: number; elapsed: number; outcome?: Outcome };

function stageFor(elapsed: number): Stage | 0 {
  if (elapsed >= milestones[3]) return 3;
  if (elapsed >= milestones[2]) return 2;
  return elapsed >= milestones[1] ? 1 : 0;
}

function Line({ eventId, tone, group, stage, task, video, select, as: Element = "strong" }: {
  eventId: number;
  tone: Tone;
  group: DialogueGroup;
  stage: Stage;
  task: string;
  video?: string;
  select: ReturnType<typeof createDialogueSelector>;
  as?: "strong" | "h1";
}) {
  const [selection, setSelection] = useState<DialogueSelection>();
  const context = dialogueContext(tone, { task, video });
  const id = String(eventId);
  const hasTask = !!context.task, hasVideo = !!context.video;
  useEffect(() => {
    setSelection(select({ id, tone, group, stage, hasTask, hasVideo }));
  }, [id, tone, group, stage, hasTask, hasVideo, select]);
  return <Element className="experience-line">
    {selection ? renderDialogue(selection, { id, tone, group, stage, hasTask, hasVideo }, context) : null}
  </Element>;
}

export default function WebExperience({ initialTask, onExit }: { initialTask: string; onExit: () => void }) {
  const [draft, setDraft] = useState(initialTask);
  const [task, setTask] = useState("");
  const [tone, setTone] = useState<Tone>("default");
  const [observation, setObservation] = useState<Observation>();
  const [select] = useState(() => createDialogueSelector());
  const sequence = useRef(0);
  const title = useRef<HTMLHeadingElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const scenario = observation?.scenario;
  const outcome = observation?.outcome;
  const stage = scenario?.prompt ? stageFor(observation?.elapsed ?? 0) : 0;
  const ultimate = stage === 3 && !outcome;
  const ticking = !!scenario?.prompt && !outcome && !ultimate;
  const episode = observation?.id;
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => { if (outcome) result.current?.focus(); }, [outcome]);

  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => {
      setObservation(current => {
        if (!current || current.id !== episode || current.outcome) return current;
        const elapsed = Math.min(milestones[3], Math.max(current.elapsed, Date.now() - current.startedAt));
        return elapsed === current.elapsed ? current : { ...current, elapsed };
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [episode, ticking]);

  function choose(id: string) {
    const selected = scenarios.find(item => item.id === id);
    if (!selected) { setObservation(undefined); return; }
    setObservation({ scenario: selected, id: ++sequence.current, startedAt: Date.now(), elapsed: 0 });
  }
  function advance() {
    if (!ticking) return;
    setObservation(current => {
      if (!current || current.id !== episode || current.outcome) return current;
      const elapsed = milestones[Math.min(stageFor(current.elapsed) + 1, 3)];
      return { ...current, elapsed, startedAt: Date.now() - elapsed };
    });
  }
  function answer(next: Outcome) {
    setObservation(current => current?.id === episode && current && !current.outcome
      ? { ...current, outcome: next } : current);
  }
  function restart() {
    setTask("");
    setObservation(undefined);
    setTone("default");
    requestAnimationFrame(() => input.current?.focus());
  }
  const group = outcome ?? scenario?.prompt;
  const line = observation && group && (stage || outcome)
    ? <Line key={`${observation.id}:${tone}:${group}:${stage}`} eventId={observation.id}
        tone={tone} group={group} stage={outcome ? 1 : stage || 1} task={task}
        video={scenario?.video} select={select} as={ultimate ? "h1" : "strong"} />
    : null;
  const character = outcome ? "recovery" : stage ? "suspect" : "focus";

  return <>
    <section className="focus-settings-content web-experience" aria-labelledby="experience-title" inert={ultimate}>
      <div className="page-head">
        <button className="back-button" onClick={onExit}><Icon name="back" />체험 종료</button>
        <h1 id="experience-title" ref={title} tabIndex={-1}>웹에서 체험하기</h1>
      </div>
      <p className="hero-note">웹 체험 · 시뮬레이션</p>
      <p>가상의 상황으로 안뇽이가 언제 말을 걸고 어떻게 공부 복귀를 돕는지 체험해요.</p>

      {!task ? <form className="hero-form" onSubmit={event => { event.preventDefault(); setTask(draft.trim()); }}>
        <div className="hero-input">
          <input type="text" aria-label="체험용 할 일" placeholder="예: 물리학 실험 보고서 작성"
            ref={input} maxLength={100} value={draft} onChange={event => setDraft(event.target.value)} />
        </div>
        <button className="hero-start" disabled={!draft.trim()}><Icon name="play" />체험 시작</button>
      </form> : <>
        <p className="experience-task"><strong>체험 목표</strong> · {task}</p>
        <fieldset className="tone-settings">
          <legend>체험 말투</legend>
          <label><input type="radio" name="experience-tone" checked={tone === "default"} onChange={() => setTone("default")} /> 기본 · 욕설 없는 독설</label>
          <label><input type="radio" name="experience-tone" checked={tone === "hardcore"} onChange={() => setTone("hardcore")} /> 하드코어 · 강한 욕설과 과장된 농담</label>
        </fieldset>
        <label className="experience-scenario" htmlFor="experience-scenario">가상의 활동 선택
          <select id="experience-scenario" value={scenario?.id ?? ""} onChange={event => choose(event.target.value)}>
            <option value="">활동을 선택하세요</option>
            {scenarios.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        {scenario && <p className="experience-scenario-note">{scenario.note}</p>}
        <div className="experience-actions">
          {ticking && <button className="secondary" type="button" onClick={advance}>다음 개입 단계</button>}
          <button className="text-button" type="button" onClick={restart}>다시 체험하기</button>
        </div>
        {ticking && <p className="hero-note">체험 전용 진행 · 10초 첫 질문 → 20초 강화 → 30초 페이지 안 궁극기</p>}
        {!ultimate && <div className="pet-stage experience-preview" aria-label="안뇽이 위젯 체험">
          <div className={`pet-character state-${character}`} aria-hidden="true">
            <img src={characterArt[character]} alt="" draggable={false} />
            <span className="pet-state-dot" />
          </div>
          <div className="pet-bubble" ref={result} tabIndex={outcome ? -1 : undefined}>
            <div role="status" aria-label="체험 결과">
              <div className="pet-bubble-heading"><strong>{outcome === "study" ? "판단을 정정했어요"
                : outcome === "return" ? "집중으로 돌아왔어요"
                : stage ? `${stage}단계 · ${stage === 1 ? "첫 확인" : "강화 확인"}`
                : scenario?.prompt ? "체험 관측 중" : scenario ? "개입 없음" : "집중 상황을 골라 보세요"}</strong></div>
              {line && <p>{line}</p>}
              {scenario?.video && !outcome && <p className="cloud-question-title">{scenario.video}</p>}
              {outcome && <p>이어서 할 일 · <strong>{task}</strong></p>}
            </div>
            {stage > 0 && !outcome && <ResponseButtons busy={false} answer={answer} />}
          </div>
        </div>}
      </>}
    </section>
    {ultimate && <UltimateDialog label="웹 체험 안뇽이 궁극기" onEscape={onExit}>
      <p>웹 체험 · 시뮬레이션</p>
      {line}
      <p className="ultimate-video">{scenario?.video ?? scenario?.note}</p>
      <ResponseButtons busy={false} answer={answer} />
      <button className="text-button" type="button" onClick={onExit}>체험 종료</button>
    </UltimateDialog>}
  </>;
}

import type { Plan, Settings, Task } from "../api/types";
import { duration, formatDate } from "../lib/time";
import Icon from "./Icon";

interface Props {
  tasks: Task[];
  plan: Plan | null;
  settings: Settings | null;
  busy: boolean;
  activeId: number | null;
  paused?: boolean;
  onStart: (id: number | null) => void;
  onDone: (task: Task) => void;
  onEdit: (task: Task) => void;
  onAdd: () => void;
}

export default function PlanView({
  tasks,
  plan,
  settings,
  busy,
  activeId,
  paused = false,
  onStart,
  onDone,
  onEdit,
  onAdd,
}: Props) {
  const nowTask = plan?.now_task;
  const active = tasks.find((task) => task.id === activeId && !task.done);
  const featured = active || nowTask;
  const featuredId = active?.id ?? nowTask?.task_id;
  const totalShort =
    plan?.order.reduce((sum, task) => sum + task.short_minutes, 0) ?? 0;
  const orderedIds = [
    ...(plan?.overdue.map((task) => task.task_id) ?? []),
    ...(plan?.order.map((task) => task.task_id) ?? []),
  ];
  const sorted = [...tasks].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (orderedIds.indexOf(a.id) + 1 || Infinity) -
        (orderedIds.indexOf(b.id) + 1 || Infinity),
  );
  const doneCount = tasks.filter((task) => task.done).length;
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR NEXT STEP</span>
          <h1>
            {active
              ? paused
                ? "잠깐 쉬어도 괜찮아요."
                : "지금은, 이 일에 집중해요."
              : "하나씩 하면, 괜찮아요."}
          </h1>
          <p>남은 시간에 맞춰 정리했어요. 지금 할 일부터 시작해 보세요.</p>
        </div>
        <button className="secondary" disabled={busy} onClick={onAdd}>
          <Icon name="plus" />할 일 추가
        </button>
      </div>
      {!plan ? (
        <div className="empty-state">
          <Icon name="refresh" />
          <h2>계획을 불러오지 못했어요.</h2>
          <p>상단의 새로고침으로 다시 연결해 주세요.</p>
        </div>
      ) : (
        <>
          {featured && featuredId !== undefined ? (
            <section className={`focus-card ${active ? "is-active" : ""}`}>
              <div className="focus-label">
                <span className="live-dot" />
                {active
                  ? paused
                    ? "일시정지"
                    : "집중 중"
                  : "지금 가장 먼저 할 일"}
                <span className="focus-tag">
                  {featured.important ? "중요한 작업" : "한 번에 한 가지"}
                </span>
              </div>
              <h2>{featured.name}</h2>
              <div className="focus-meta">
                <span>
                  <Icon name="clock" />
                  예상 {duration(featured.estimated_minutes)}
                </span>
                <span>{formatDate(featured.deadline)} 마감</span>
              </div>
              <div className="focus-bottom">
                <p>
                  {active
                    ? "다 끝냈다면 완료를 눌러 다음 한 걸음으로 넘어가요."
                    : plan.start_by
                      ? `${formatDate(plan.start_by)}까지 시작하면 돼요.`
                      : "시간이 부족해요. 우선 이 작업부터 시작해 볼까요?"}
                </p>
                {active ? (
                  <div className="button-group">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => onStart(null)}
                    >
                      집중 종료
                    </button>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => onDone(active)}
                    >
                      <Icon name="check" />
                      작업 완료
                    </button>
                  </div>
                ) : (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => onStart(featuredId)}
                  >
                    <Icon name="play" />
                    작업 시작
                  </button>
                )}
              </div>
              {active && (
                <p className="focus-note">
                  안뇽이와 같은 집중 세션을 보고 있어요. 앱을 종료하면 세션은
                  끝나요. Windows 활동 감지는 별도 동의 후에만 실행돼요.
                </p>
              )}
            </section>
          ) : (
            <section className="empty-state">
              <span className="empty-icon">
                <Icon name={plan.overdue.length ? "clock" : "check"} />
              </span>
              <h2>
                {plan.overdue.length
                  ? "마감이 지난 작업을 확인해 주세요."
                  : tasks.length
                    ? "등록한 일을 모두 마쳤어요."
                    : "아직 등록된 할 일이 없어요."}
              </h2>
              <p>
                {plan.overdue.length
                  ? "아래에서 마감을 수정하거나 완료한 일을 체크해 주세요."
                  : "새로운 할 일이 생기면 여기에 가볍게 적어 주세요."}
              </p>
            </section>
          )}
          <div className="plan-summary">
            <div>
              <span>남은 여유 시간</span>
              <strong>
                {plan.free_minutes === null ? "—" : duration(plan.free_minutes)}
              </strong>
            </div>
            <div>
              <span>부족한 시간</span>
              <strong className={totalShort ? "warning-text" : ""}>
                {duration(totalShort)}
              </strong>
            </div>
            <p className={`plan-status ${plan.status}`}>
              <span className="live-dot" />
              {plan.status === "short"
                ? "예상 시간을 모두 확보하기 어려워요"
                : plan.status === "tight"
                  ? "여유가 적어요. 곧 시작해 주세요"
                  : plan.order.length
                    ? "지금 계획대로 진행할 수 있어요"
                    : "새로운 계획을 기다리고 있어요"}
            </p>
          </div>
          {plan.overdue.length > 0 && (
            <p className="overdue-notice" role="status">
              마감이 지난 작업 {plan.overdue.length}개는 위 여유·부족 시간
              계산에서 제외돼요.
            </p>
          )}
        </>
      )}
      <section className="task-list">
        <div className="list-heading">
          <h2>
            나의 할 일 <span>{tasks.length}</span>
          </h2>
          <span>{doneCount}개 완료</span>
        </div>
        {sorted.length ? (
          <div>
            {sorted.map((task) => {
              const allocation = plan?.order.find(
                (item) => item.task_id === task.id,
              );
              const overdue =
                !task.done &&
                plan?.overdue.some((item) => item.task_id === task.id);
              return (
                <article
                  key={task.id}
                  className={`task-row ${task.done ? "is-done" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="task-checkbox"
                    aria-label={`${task.name} 완료`}
                    checked={task.done}
                    disabled={busy}
                    onChange={() => onDone(task)}
                  />
                  <div className="task-info">
                    <div className="task-title">
                      <strong>{task.name}</strong>
                      {task.important && <span className="badge">중요</span>}
                      {overdue && (
                        <span className="badge danger">마감 지남</span>
                      )}
                      {activeId === task.id && !task.done && (
                        <span className="badge">
                          {paused ? "일시정지" : "집중 중"}
                        </span>
                      )}
                    </div>
                    <p>
                      {formatDate(task.deadline)} 마감
                      {allocation && allocation.short_minutes > 0 && (
                        <span className="warning-text">
                          {" "}
                          · {duration(allocation.short_minutes)} 부족
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="task-duration">
                    <Icon name="clock" />
                    {duration(task.estimated_minutes)}
                  </span>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => onEdit(task)}
                    aria-label={`${task.name} 수정`}
                  >
                    수정
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="empty-list">
            할 일을 추가하면 마감 순서에 맞춰 정리해 드릴게요.
          </p>
        )}
      </section>
      <p className="plan-footnote">
        마감이 빠른 순서로, 같은 마감이면 중요한 일부터 정리해요.
        {settings && (
          <>
            {" "}
            내일 이후에는 하루 {duration(settings.daily_minutes)} 기준으로
            계산해요.
          </>
        )}
        <br />
        표시 시간은 한국 시간 기준이며, 계획은 1분마다 새로고침돼요.
      </p>
    </>
  );
}

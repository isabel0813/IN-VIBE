use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Character {
    #[default]
    Idle,
    Focus,
    Suspect,
    Checkin,
    Recovery,
    Complete,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct FocusTask {
    pub id: i64,
    pub name: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub revision: u64,
    pub task: Option<FocusTask>,
    pub started_at: Option<u64>,
    pub running: bool,
    pub paused: bool,
    pub character: Character,
    // A manual development expression never claims activity was measured.
    pub simulated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    Start { task: FocusTask },
    Pause,
    Resume,
    End,
    Complete { task_id: i64 },
    Rename { task: FocusTask },
    Character { character: Character },
    Checkin { choice: CheckinChoice },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckinChoice {
    Distracted,
    Studying,
    Break,
}

impl Session {
    pub fn apply(&mut self, action: Action, now: u64, development: bool) -> Result<(), String> {
        match action {
            Action::Start { task } => {
                if task.id <= 0 || task.name.trim().is_empty() || task.name.chars().count() > 100 {
                    return Err("유효한 작업을 선택해 주세요.".into());
                }
                self.task = Some(task);
                self.started_at = Some(now);
                self.running = true;
                self.paused = false;
                self.character = Character::Focus;
                self.simulated = false;
            }
            Action::End => {
                let revision = self.revision;
                *self = Self {
                    revision,
                    ..Self::default()
                };
            }
            Action::Pause | Action::Resume => {
                if !self.running {
                    return Err("진행 중인 세션이 없어요.".into());
                }
                self.paused = matches!(action, Action::Pause);
                self.character = if self.paused {
                    Character::Idle
                } else {
                    Character::Focus
                };
                self.simulated = false;
            }
            Action::Complete { task_id } => {
                if self.task.as_ref().map(|task| task.id) != Some(task_id) {
                    return Ok(());
                }
                self.running = false;
                self.paused = false;
                self.character = Character::Complete;
                self.simulated = false;
            }
            Action::Rename { task } => {
                if self.task.as_ref().map(|current| current.id) != Some(task.id) {
                    return Ok(());
                }
                if task.name.trim().is_empty() || task.name.chars().count() > 100 {
                    return Err("작업 이름을 확인해 주세요.".into());
                }
                self.task = Some(task);
            }
            Action::Character { character } => {
                if !development {
                    return Err("상태 시뮬레이션은 개발 빌드 전용이에요.".into());
                }
                self.character = character;
                self.simulated = true;
            }
            Action::Checkin { choice } => {
                if !self.running {
                    return Err("먼저 작업을 시작해 주세요.".into());
                }
                if self.character != Character::Checkin {
                    return Err("확인 중인 상태가 아니에요.".into());
                }
                self.paused = matches!(choice, CheckinChoice::Break);
                self.character = match choice {
                    CheckinChoice::Distracted => Character::Recovery,
                    CheckinChoice::Studying => Character::Focus,
                    CheckinChoice::Break => Character::Idle,
                };
                // No /plan/wasted call and no fabricated duration in Phase 2.
            }
        }
        self.revision += 1;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task() -> FocusTask {
        FocusTask {
            id: 7,
            name: "발표 준비".into(),
        }
    }
    #[test]
    fn session_lifecycle_and_restart() {
        let mut state = Session::default();
        state
            .apply(Action::Start { task: task() }, 123, false)
            .unwrap();
        assert_eq!(state.started_at, Some(123));
        state.apply(Action::Pause, 124, false).unwrap();
        assert!(state.running && state.paused);
        state.apply(Action::Resume, 125, false).unwrap();
        assert_eq!(state.started_at, Some(123));
        assert!(!state.paused);
        state
            .apply(Action::Complete { task_id: 99 }, 126, false)
            .unwrap();
        assert!(state.running);
        state
            .apply(Action::Complete { task_id: 7 }, 127, false)
            .unwrap();
        assert_eq!(state.character, Character::Complete);
        assert!(!state.running);
        state.apply(Action::End, 128, false).unwrap();
        assert!(state.task.is_none());
        assert!(!Session::default().running);
    }
    #[test]
    fn development_only_expressions_and_checkin() {
        let mut state = Session::default();
        assert!(state
            .apply(
                Action::Character {
                    character: Character::Checkin
                },
                0,
                false
            )
            .is_err());
        state
            .apply(Action::Start { task: task() }, 1, true)
            .unwrap();
        for choice in [
            CheckinChoice::Distracted,
            CheckinChoice::Studying,
            CheckinChoice::Break,
        ] {
            state
                .apply(
                    Action::Character {
                        character: Character::Checkin,
                    },
                    2,
                    true,
                )
                .unwrap();
            state.apply(Action::Checkin { choice }, 3, true).unwrap();
            assert!(state.simulated);
            assert_eq!(state.started_at, Some(1));
        }
        assert!(state.paused);
    }
}

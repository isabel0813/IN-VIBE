//! Swappable local classifier and an expiring, single-source observation gate.
use crate::activity::{Category, Sample};
use annyong_native_protocol::{Message, Observation, Status};
use serde::Serialize;

pub trait RelevanceClassifier {
    fn classify(&self, task: &str, title: &str) -> Category;
}
pub struct KeywordClassifier;
impl RelevanceClassifier for KeywordClassifier {
    fn classify(&self, task: &str, title: &str) -> Category {
        let title = title.to_lowercase();
        if [
            "study with me",
            "studywithme",
            "스터디윗미",
            "lofi",
            "asmr",
            "background music",
            "white noise",
            "백색소음",
            "플레이리스트",
            "공부 음악",
        ]
        .iter()
        .any(|s| title.contains(s))
        {
            return Category::Unknown;
        }
        let task = task.to_lowercase();
        let words: Vec<_> = task
            .split(|c: char| !c.is_alphanumeric())
            .filter(|s| {
                s.chars().count() >= 2
                    && !["공부", "학습", "하기", "준비", "study", "과제"].contains(s)
            })
            .collect();
        if !words.is_empty() && words.iter().all(|word| title.contains(word)) {
            return Category::Related;
        }
        if [
            "게임",
            "gameplay",
            "game play",
            "gaming",
            "먹방",
            "브이로그",
            "vlog",
            "실황",
        ]
        .iter()
        .any(|s| title.contains(s))
        {
            return Category::Suspect;
        }
        Category::Unknown
    }
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserView {
    pub consent: bool,
    pub connected: bool,
    pub collecting: bool,
    pub observing: bool,
    pub error: Option<String>,
}
pub struct Browser {
    pub view: BrowserView,
    pub generation: u64,
    last_seen: u64,
    latest: Option<(Observation, u64)>,
    candidates: Vec<(Observation, u64)>,
    snapshot: bool,
    consumed: Option<u64>,
    pub discontinuous: bool,
}
impl Default for Browser {
    fn default() -> Self {
        Self {
            view: BrowserView::default(),
            generation: crate::activity_now(),
            last_seen: 0,
            latest: None,
            candidates: vec![],
            snapshot: false,
            consumed: None,
            discontinuous: true,
        }
    }
}
pub enum Decision {
    Native,
    Skip,
    Observe(Sample, u64, String, Category),
}
impl Browser {
    pub fn visible_videos(&self, now: u64, titles: &[String]) -> Vec<Observation> {
        if !self.view.consent || !self.view.collecting {
            return vec![];
        }
        let values = if self.snapshot {
            self.candidates.clone()
        } else {
            self.latest.iter().cloned().collect()
        };
        let mut seen = std::collections::HashSet::new();
        values
            .iter()
            .filter(|(o, at)| {
                now.saturating_sub(*at) <= 2500
                    && o.playing
                    && o.kind == "watch"
                    && titles
                        .iter()
                        .filter(|title| title_matches(title, &o.title))
                        .count()
                        == 1
                    && !values.iter().any(|(other, other_at)| {
                        now.saturating_sub(*other_at) <= 2500
                            && other.playing
                            && other.video_id != o.video_id
                            && other
                                .title
                                .split_whitespace()
                                .eq(o.title.split_whitespace())
                    })
                    && seen.insert(o.video_id.clone())
            })
            .map(|(o, _)| o.clone())
            .collect()
    }
    pub fn choose_visible(
        &mut self,
        native: &Sample,
        task: &str,
        now: u64,
        titles: &[String],
    ) -> Decision {
        let videos = self.visible_videos(now, titles);
        let previous = self.latest.as_ref().and_then(|(o, _)| o.video_id.clone());
        let selected = videos
            .iter()
            .find(|o| {
                native.process.eq_ignore_ascii_case("chrome.exe")
                    && title_matches(&native.title, &o.title)
            })
            .or_else(|| videos.iter().find(|o| o.video_id == previous))
            .or(videos.first());
        if let Some(o) = selected {
            let at = self
                .candidates
                .iter()
                .find(|(candidate, _)| candidate.video_id == o.video_id)
                .map(|(_, at)| *at)
                .or(self.latest.as_ref().map(|(_, at)| *at))
                .unwrap_or(now);
            if previous != o.video_id {
                self.discontinuous = true;
            }
            self.latest = Some((o.clone(), at));
            // A visible background player proves playback, not active use.
            // Keep it observable without accumulating a local suspect streak.
            if !native.process.eq_ignore_ascii_case("chrome.exe")
                || !title_matches(&native.title, &o.title)
            {
                self.view.observing = true;
                self.consumed = None;
                self.discontinuous = true;
                return Decision::Observe(
                    Sample {
                        process: "chrome.exe".into(),
                        title: o.title.clone(),
                        idle: false,
                    },
                    at,
                    format!("youtube:{}", o.video_id.as_deref().unwrap_or("")),
                    Category::Unknown,
                );
            }
            return self.choose(
                &Sample {
                    process: "chrome.exe".into(),
                    title: format!("{} - YouTube", o.title),
                    idle: false,
                },
                task,
                now,
            );
        }
        self.latest = None;
        self.choose(native, task, now)
    }
    pub fn invalidate(&mut self) {
        self.generation += 1;
        self.latest = None;
        self.candidates.clear();
        self.snapshot = false;
        self.consumed = None;
        self.view.collecting = false;
        self.view.observing = false;
        self.discontinuous = true;
    }
    pub fn disconnect(&mut self) {
        self.invalidate();
        self.view.connected = false;
    }
    pub fn status(&mut self, now: u64, running: bool) -> BrowserView {
        if self.view.connected && now.saturating_sub(self.last_seen) > 3500 {
            self.disconnect();
        }
        self.view.collecting = self.view.consent && self.view.connected && running;
        self.view.clone()
    }
    pub fn accept(&mut self, m: &Message, now: u64, running: bool) -> Status {
        self.last_seen = now;
        self.view.connected = true;
        self.status(now, running);
        if m.kind == "clear" || !self.view.collecting {
            self.latest = None;
            self.candidates.clear();
            self.view.observing = false;
            self.discontinuous = true;
        } else if m.kind == "snapshot" && m.generation == self.generation {
            // A pause/removal between native polls must still break the streak.
            if self.latest.as_ref().is_some_and(|(old, _)| {
                !m.observations
                    .iter()
                    .any(|o| o.playing && o.kind == "watch" && o.video_id == old.video_id)
            }) {
                self.discontinuous = true;
                self.latest = None;
                self.consumed = None;
                self.view.observing = false;
            }
            self.snapshot = true;
            self.candidates = m.observations.iter().cloned().map(|o| (o, now)).collect();
        } else if m.kind == "observation" && m.generation == self.generation {
            self.snapshot = false;
            if m.observation
                .as_ref()
                .is_none_or(|o| !o.playing || o.kind != "watch")
            {
                self.discontinuous = true;
            }
            if self.latest.as_ref().is_some_and(|(old, _)| {
                m.observation
                    .as_ref()
                    .is_some_and(|new| old.video_id != new.video_id)
            }) {
                self.discontinuous = true;
            }
            self.latest = m.observation.clone().map(|o| (o, now));
        }
        Status {
            kind: "status".into(),
            connected: true,
            collecting: self.view.collecting,
            generation: self.generation,
        }
    }
    pub fn choose(&mut self, native: &Sample, task: &str, now: u64) -> Decision {
        self.view.observing = false;
        if !native.process.eq_ignore_ascii_case("chrome.exe") {
            self.consumed = None;
            self.discontinuous = true;
            return Decision::Native;
        }
        // Without extension consent retain the original Windows-only behavior.
        if !self.view.consent {
            return Decision::Native;
        }
        let unknown = || {
            Decision::Observe(
                Sample {
                    process: "chrome.exe".into(),
                    title: String::new(),
                    idle: false,
                },
                now,
                "youtube:unavailable".into(),
                Category::Unknown,
            )
        };
        let Some((o, at)) = &self.latest else {
            return unknown();
        };
        if !self.view.collecting
            || now.saturating_sub(*at) > 2500
            || !o.playing
            || o.kind != "watch"
            || !title_matches(&native.title, &o.title)
        {
            self.consumed = None;
            self.discontinuous = true;
            return unknown();
        }
        self.view.observing = true;
        if self.consumed == Some(*at) {
            return Decision::Skip;
        }
        self.consumed = Some(*at);
        Decision::Observe(
            Sample {
                process: "chrome.exe".into(),
                title: o.title.clone(),
                idle: false,
            },
            *at,
            format!("youtube:{}", o.video_id.as_deref().unwrap_or("")),
            KeywordClassifier.classify(task, &o.title),
        )
    }
}
fn title_matches(window: &str, video: &str) -> bool {
    let window = window.split_whitespace().collect::<Vec<_>>().join(" ");
    let without_notification = window.strip_prefix('(').and_then(|s| {
        s.split_once(") ")
            .filter(|(n, _)| n.chars().all(|c| c.is_ascii_digit()))
            .map(|(_, rest)| rest)
    });
    let video = video.split_whitespace().collect::<Vec<_>>().join(" ");
    let matches = |window: &str| {
        window
            .strip_prefix(&video)
            .is_some_and(|rest| rest == " - YouTube" || rest.starts_with(" - YouTube - "))
    };
    matches(&window) || without_notification.is_some_and(matches)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn background_playback_is_observable_but_never_a_local_suspect() {
        let mut b = Browser::default();
        b.view.consent = true;
        let m = message(b.generation, true);
        b.accept(&m, 1000, true);
        let titles = vec!["게임 플레이 - YouTube".into()];
        let background = Sample {
            process: "Code.exe".into(),
            title: "notes".into(),
            idle: false,
        };
        assert_eq!(b.visible_videos(1100, &titles).len(), 1);
        assert!(matches!(
            b.choose_visible(&background, "공부", 1100, &titles),
            Decision::Observe(_, _, _, Category::Unknown)
        ));
        assert!(b.view.observing && b.discontinuous);
        let foreground = Sample {
            process: "chrome.exe".into(),
            title: titles[0].clone(),
            idle: true,
        };
        assert!(matches!(
            b.choose_visible(&foreground, "공부", 1200, &titles),
            Decision::Observe(_, _, _, Category::Suspect)
        ));
    }
    #[test]
    fn foreground_video_is_preferred_over_a_previous_background_player() {
        let mut b = Browser::default();
        b.view.consent = true;
        let mut m = message(b.generation, true);
        let first = m.observation.take().unwrap();
        m.kind = "snapshot".into();
        m.observations = vec![
            first.clone(),
            Observation {
                video_id: Some("zyxwvutsrqp".into()),
                title: "전자기 유도 강의".into(),
                ..first
            },
        ];
        b.accept(&m, 1000, true);
        let titles = vec![
            "게임 플레이 - YouTube".into(),
            "전자기 유도 강의 - YouTube".into(),
        ];
        let native = Sample {
            process: "Code.exe".into(),
            title: "notes".into(),
            idle: false,
        };
        b.choose_visible(&native, "전자기 유도 공부", 1100, &titles);
        let focused = Sample {
            process: "chrome.exe".into(),
            title: titles[1].clone(),
            idle: false,
        };
        assert!(matches!(
            b.choose_visible(&focused, "전자기 유도 공부", 1200, &titles),
            Decision::Observe(_, _, _, Category::Related)
        ));
        assert_eq!(
            b.latest.as_ref().unwrap().0.video_id.as_deref(),
            Some("zyxwvutsrqp")
        );
    }
    #[test]
    fn notification_prefix_does_not_strip_a_real_video_title() {
        assert!(title_matches("(2) chapter - YouTube", "(2) chapter"));
        assert!(title_matches(
            "(3) chapter - YouTube - Google Chrome",
            "chapter"
        ));
        assert!(!title_matches("chapter extra - YouTube", "chapter"));
    }
    fn message(generation: u64, playing: bool) -> Message {
        Message {
            version: 1,
            observations: vec![],
            kind: "observation".into(),
            seq: 1,
            generation,
            observation: Some(Observation {
                kind: "watch".into(),
                video_id: Some("abcdefghijk".into()),
                title: "게임 플레이".into(),
                playing,
            }),
        }
    }
    #[test]
    fn rules_are_conservative() {
        let c = KeywordClassifier;
        assert_eq!(
            c.classify("전자기 유도 공부", "전자기 유도 강의"),
            Category::Related
        );
        assert_eq!(
            c.classify("전자기 유도 공부", "게임 플레이"),
            Category::Suspect
        );
        for title in ["Study With Me 게임", "뉴스", "전자기학"] {
            assert_eq!(c.classify("전자기 유도 공부", title), Category::Unknown);
        }
        assert_eq!(
            c.classify("게임 개발 공부", "게임 개발 강의"),
            Category::Related
        );
    }
    #[test]
    fn playback_supersedes_idle_but_never_wrong_window_or_stale_generation() {
        let mut b = Browser::default();
        b.view.consent = true;
        let n = Sample {
            process: "chrome.exe".into(),
            title: "게임 플레이 - YouTube - Chrome".into(),
            idle: true,
        };
        b.accept(&message(b.generation, true), 1000, true);
        assert!(matches!(
            b.choose(&n, "전자기 유도 공부", 1100),
            Decision::Observe(Sample { idle: false, .. }, 1000, _, Category::Suspect)
        ));
        assert!(matches!(b.choose(&n, "공부", 1200), Decision::Skip));
        assert!(matches!(
            b.choose(&n, "공부", 4000),
            Decision::Observe(_, _, _, Category::Unknown)
        ));
        b.invalidate();
        b.accept(&message(b.generation - 1, true), 5000, true);
        assert!(matches!(
            b.choose(&n, "공부", 5000),
            Decision::Observe(_, _, _, Category::Unknown)
        ));
        b.accept(&message(b.generation, false), 6000, true);
        assert!(matches!(
            b.choose(&n, "공부", 6000),
            Decision::Observe(_, _, _, Category::Unknown)
        ));
        b.accept(&message(b.generation, true), 7000, true);
        let other = Sample {
            title: "other - Chrome".into(),
            ..n
        };
        assert!(matches!(
            b.choose(&other, "공부", 7000),
            Decision::Observe(_, _, _, Category::Unknown)
        ));
        b.status(11000, true);
        assert!(!b.view.connected);
        assert!(!b.view.collecting);
    }
    #[test]
    fn stopped_session_and_disconnect_clear_observations() {
        let mut b = Browser::default();
        b.view.consent = true;
        b.accept(&message(b.generation, true), 0, false);
        assert!(b.latest.is_none());
        b.accept(&message(b.generation, true), 1000, true);
        b.disconnect();
        assert!(b.latest.is_none());
        assert!(!Browser::default().view.consent);
    }
    #[test]
    fn measured_youtube_recovery_correction_and_fast_switch() {
        use crate::activity::{Config, Detector};
        let mut b = Browser::default();
        b.view.consent = true;
        let mut d = Detector::default();
        d.configure(
            Config {
                consent: true,
                threshold_seconds: 10,
                related_terms: vec![],
                suspect_terms: vec![],
            },
            true,
        )
        .unwrap();
        let n = Sample {
            process: "chrome.exe".into(),
            title: "게임 플레이 - YouTube - Chrome".into(),
            idle: true,
        };
        fn feed(b: &mut Browser, d: &mut Detector, n: &Sample, now: u64) -> bool {
            b.accept(&message(b.generation, true), now, true);
            let decision = b.choose(n, "전자기 유도 공부", now);
            if std::mem::take(&mut b.discontinuous) {
                d.stop();
            }
            match decision {
                Decision::Observe(s, t, k, c) => d.observe_as(Ok(s), t, Some((k, c))),
                _ => panic!("missing observation"),
            }
        }
        for now in 0..=5 {
            assert!(!feed(&mut b, &mut d, &n, now * 1000));
        }
        let clear = Message {
            version: 1,
            observations: vec![],
            kind: "clear".into(),
            seq: 2,
            generation: b.generation,
            observation: None,
        };
        b.accept(&clear, 5500, true); // switch away and back before next native poll
        assert!(!feed(&mut b, &mut d, &n, 6000));
        assert_eq!(d.view.held_seconds, 0);
        for now in 7..16 {
            assert!(!feed(&mut b, &mut d, &n, now * 1000));
        }
        assert!(feed(&mut b, &mut d, &n, 16000));
        let incident = d.view.incident.clone().unwrap();
        assert_eq!(incident.seconds, 10);
        assert_eq!(d.view.totals.suspicions, 1);
        d.respond(incident.id, "studying", 17000).unwrap();
        feed(&mut b, &mut d, &n, 18000);
        assert_eq!(d.view.category, Category::Related);
        assert_eq!(d.view.totals.corrections, 1);
        d.reset_session();
        for now in 20..=30 {
            feed(&mut b, &mut d, &n, now * 1000);
        }
        let id = d.view.incident.as_ref().unwrap().id;
        d.respond(id, "claim", 31000).unwrap();
        assert!(d.respond(id, "claim", 31000).is_err());
        d.respond(id, "resolved", 32000).unwrap();
        assert_eq!(d.view.totals.confessions, 1);
        let related = Sample {
            process: "editor.exe".into(),
            title: "lecture".into(),
            idle: false,
        };
        d.observe_as(
            Ok(related),
            33000,
            Some(("next-study".into(), Category::Related)),
        );
        assert_eq!(d.view.totals.last_return_seconds, Some(3));
        b.disconnect();
        assert!(!b.view.collecting);
    }
    #[test]
    fn snapshots_support_visible_unfocused_windows_and_remove_paused_or_stale_videos() {
        let mut b = Browser::default();
        b.view.consent = true;
        let mut m = message(b.generation, true);
        m.kind = "snapshot".into();
        let first = m.observation.take().unwrap();
        let second = Observation {
            video_id: Some("zyxwvutsrqp".into()),
            title: "lofi background music".into(),
            ..first.clone()
        };
        m.observations = vec![first.clone(), second.clone(), first];
        let titles = vec![
            "(2) 게임 플레이 - YouTube - Google Chrome".into(),
            "lofi background music - YouTube".into(),
        ];
        b.accept(&m, 1000, true);
        assert_eq!(b.visible_videos(1100, &titles).len(), 2); // duplicate video is not counted twice
        let editor = Sample {
            process: "code.exe".into(),
            title: "editor".into(),
            idle: true,
        };
        assert!(matches!(
            b.choose_visible(&editor, "공부", 1100, &titles),
            Decision::Observe(Sample { idle: false, .. }, _, _, Category::Unknown)
        ));
        assert!(b.visible_videos(1100, &[]).is_empty()); // fully covered/minimized/window not matched
        m.observations = vec![second];
        b.accept(&m, 2000, true);
        assert_eq!(b.visible_videos(2100, &titles).len(), 1);
        assert!(b.visible_videos(5001, &titles).is_empty());
        b.disconnect();
        assert!(b.visible_videos(2100, &titles).is_empty());
    }
    #[test]
    fn a_new_snapshot_keeps_the_current_playing_video_observable_between_native_polls() {
        let mut browser = Browser::default();
        browser.view.consent = true;
        let mut snapshot = message(browser.generation, true);
        snapshot.kind = "snapshot".into();
        snapshot.observations = vec![snapshot.observation.take().unwrap()];
        let title = "게임 플레이 - YouTube".to_string();
        let foreground = Sample {
            process: "chrome.exe".into(),
            title: title.clone(),
            idle: false,
        };

        browser.accept(&snapshot, 1000, true);
        browser.choose_visible(&foreground, "공부", 1000, &[title]);
        assert!(browser.status(1000, true).observing);

        browser.accept(&snapshot, 1100, true);
        assert!(browser.status(1100, true).observing);

        snapshot.observations.clear();
        browser.accept(&snapshot, 1200, true);
        assert!(!browser.status(1200, true).observing);
    }
    #[test]
    fn pause_between_native_polls_breaks_continuity() {
        let mut b = Browser::default();
        b.view.consent = true;
        let mut m = message(b.generation, true);
        m.kind = "snapshot".into();
        let video = m.observation.take().unwrap();
        m.observations = vec![video.clone()];
        let native = Sample {
            process: "chrome.exe".into(),
            title: "게임 플레이 - YouTube".into(),
            idle: false,
        };
        let titles = vec![native.title.clone()];
        b.accept(&m, 1000, true);
        b.choose_visible(&native, "공부", 1000, &titles);
        b.discontinuous = false;
        m.observations.clear();
        b.accept(&m, 1500, true);
        m.observations = vec![video];
        b.accept(&m, 1900, true);
        b.choose_visible(&native, "공부", 2000, &titles);
        assert!(b.discontinuous);
    }
    #[test]
    fn two_different_ids_with_one_title_are_ambiguous() {
        let mut b = Browser::default();
        b.view.consent = true;
        let mut m = message(b.generation, true);
        m.kind = "snapshot".into();
        let first = m.observation.take().unwrap();
        m.observations = vec![
            first.clone(),
            Observation {
                video_id: Some("zyxwvutsrqp".into()),
                ..first
            },
        ];
        b.accept(&m, 1000, true);
        assert!(b
            .visible_videos(1100, &["게임 플레이 - YouTube".into()])
            .is_empty());
    }
}

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
        if ["study with me", "studywithme", "스터디윗미", "lofi", "asmr"]
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
    pub fn invalidate(&mut self) {
        self.generation += 1;
        self.latest = None;
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
            self.view.observing = false;
            self.discontinuous = true;
        } else if m.kind == "observation" && m.generation == self.generation {
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
            || !native.title.starts_with(&format!("{} - YouTube", o.title))
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
#[cfg(test)]
mod tests {
    use super::*;
    fn message(generation: u64, playing: bool) -> Message {
        Message {
            version: 1,
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
}

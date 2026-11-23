//! In-memory only. No hooks, screenshots, keystrokes, disk log or network client.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const INACTIVITY_MS: u64 = 60_000;
const SECOND_CHECK_MS: u64 = 300_000;
const FINAL_CHECK_MS: u64 = 600_000;

pub struct LastInput {
    pub tick: u32,
    pub elapsed_ms: u64,
}

#[derive(Default)]
struct Inactivity {
    since: Option<u64>,
    sampled_at: Option<u64>,
    prompt_tick: Option<u32>,
    answered_tick: Option<u32>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IncidentKind {
    Window,
    Inactivity,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Related,
    Suspect,
    #[default]
    Unknown,
    Idle,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub process: String,
    pub title: String,
    pub idle: bool,
}
impl Sample {
    fn key(&self) -> String {
        format!("{}\n{}", self.process, self.title)
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Incident {
    pub id: u64,
    pub kind: IncidentKind,
    pub stage: u8,
    pub started_at: u64,
    pub seconds: u64,
    pub process: String,
    pub title: String,
    pub claimed: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub totals: Totals,
    pub revision: u64,
    pub consent: bool,
    pub monitoring: bool,
    pub category: Category,
    pub current: Option<Sample>,
    pub held_seconds: u64,
    pub incident: Option<Incident>,
    pub threshold_seconds: u64,
    pub related_terms: Vec<String>,
    pub suspect_terms: Vec<String>,
    pub error: Option<String>,
}
impl Default for View {
    fn default() -> Self {
        Self {
            totals: Totals::default(),
            revision: 0,
            consent: false,
            monitoring: false,
            category: Category::Unknown,
            current: None,
            held_seconds: 0,
            incident: None,
            threshold_seconds: 300,
            related_terms: vec![],
            suspect_terms: vec![],
            error: None,
        }
    }
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub focus_seconds: u64,
    pub suspicions: u64,
    pub confessions: u64,
    pub corrections: u64,
    pub last_return_seconds: Option<u64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub consent: bool,
    pub threshold_seconds: u64,
    pub related_terms: Vec<String>,
    pub suspect_terms: Vec<String>,
}
#[derive(Default)]
pub struct Detector {
    inactivity: Inactivity,
    incident_key: Option<String>,
    focus_ms: u64,
    return_since: Option<u64>,
    pub view: View,
    previous: Option<(String, Category, u64)>,
    corrections: HashSet<String>,
    cooldown_until: u64,
    next_id: u64,
    held_ms: u64,
}
impl Detector {
    pub fn poll(
        &mut self,
        running: bool,
        paused: bool,
        now: u64,
        read: impl FnOnce() -> Result<Sample, String>,
    ) -> bool {
        if !running || paused || !self.view.consent {
            if self.view.monitoring || self.view.current.is_some() {
                self.stop();
            }
            return false;
        }
        self.observe(read(), now)
    }
    #[cfg(test)]
    pub fn configure(&mut self, config: Config, development: bool) -> Result<(), String> {
        self.configure_with(config, development, |_| Ok(()))
    }
    pub fn configure_with(
        &mut self,
        config: Config,
        development: bool,
        save_consent: impl FnOnce(bool) -> Result<(), String>,
    ) -> Result<(), String> {
        if !config.consent {
            self.reset_session();
            self.view.consent = false;
            self.view.revision += 1;
            return save_consent(false);
        }
        if !(if development { 10 } else { 300 }..=3600).contains(&config.threshold_seconds) {
            return Err("감지 기준은 기본 300초 이상, 개발 빌드에서만 10초 이상이에요.".into());
        }
        let clean = |terms: Vec<String>| -> Result<Vec<String>, String> {
            if terms.len() > 20 || terms.iter().any(|s| s.chars().count() > 80) {
                return Err("분류 단어는 80자 이하, 최대 20개예요.".into());
            }
            Ok(terms
                .into_iter()
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
                .collect())
        };
        let related = clean(config.related_terms)?;
        let suspect = clean(config.suspect_terms)?;
        save_consent(true)?;
        self.reset_session();
        self.view.consent = config.consent;
        self.view.threshold_seconds = config.threshold_seconds;
        self.view.related_terms = related;
        self.view.suspect_terms = suspect;
        self.view.revision += 1;
        Ok(())
    }
    pub fn reset_session(&mut self) {
        self.stop();
        self.reset_inactivity();
        self.view.incident = None;
        self.corrections.clear();
        self.cooldown_until = 0;
        self.incident_key = None;
    }
    pub fn stop(&mut self) {
        self.previous = None;
        self.view.current = None;
        self.view.held_seconds = 0;
        self.held_ms = 0;
        self.view.monitoring = false;
        self.view.category = Category::Unknown;
        self.view.error = None;
        self.view.revision += 1;
    }
    pub fn inactivity_pending(&self) -> bool {
        self.view
            .incident
            .as_ref()
            .is_some_and(|i| i.kind == IncidentKind::Inactivity)
    }
    pub fn begin_inactivity(&mut self, now: u64) {
        self.inactivity.since.get_or_insert(now);
    }
    pub fn suppress_inactivity_until_input(&mut self, input: Option<LastInput>) {
        if let Some(input) = input {
            self.inactivity.answered_tick = Some(input.tick);
        }
    }
    pub fn inactivity_stage(&self) -> u8 {
        self.view
            .incident
            .as_ref()
            .filter(|i| i.kind == IncidentKind::Inactivity)
            .map_or(0, |i| i.stage)
    }
    pub fn inactivity_id(&self) -> Option<u64> {
        self.view
            .incident
            .as_ref()
            .filter(|i| i.kind == IncidentKind::Inactivity)
            .map(|i| i.id)
    }
    pub fn can_show_inactivity_ultimate(&self, id: u64) -> bool {
        self.view.consent && self.inactivity_stage() == 3 && self.inactivity_id() == Some(id)
    }
    pub fn reset_inactivity(&mut self) {
        if self.inactivity_pending() {
            self.view.incident = None;
            self.view.revision += 1;
        }
        self.inactivity = Inactivity::default();
    }
    fn suspend_inactivity_clock(&mut self) {
        self.inactivity.prompt_tick = None;
        if let Some(incident) = self
            .view
            .incident
            .as_mut()
            .filter(|i| i.kind == IncidentKind::Inactivity && i.stage != 0)
        {
            incident.stage = 0;
            self.view.revision += 1;
        }
    }
    pub fn observe_inactivity(
        &mut self,
        now: u64,
        input: Option<LastInput>,
        youtube_playing: bool,
    ) -> bool {
        if !self.view.consent {
            self.reset_inactivity();
            return false;
        }
        // The fullscreen question stays answerable even when the pointer moves.
        // Pause/end/revocation and the answer handlers explicitly reset it.
        if self.inactivity_stage() == 3 {
            return false;
        }
        let Some(input) = input else {
            self.suspend_inactivity_clock();
            self.inactivity.since = None;
            return false;
        };
        if self
            .inactivity
            .sampled_at
            .is_some_and(|at| now.saturating_sub(at) > 2500)
        {
            // A sleep, suspend or missed poll is not a measured inactive interval.
            self.suspend_inactivity_clock();
            self.inactivity.since = None;
        }
        self.inactivity.sampled_at = Some(now);
        let since = *self.inactivity.since.get_or_insert(now);
        let elapsed = input.elapsed_ms.min(now.saturating_sub(since));
        if youtube_playing {
            self.suspend_inactivity_clock();
            // Watching a known visible playing video takes priority for this interval.
            if elapsed >= INACTIVITY_MS {
                self.inactivity.answered_tick = Some(input.tick);
            }
            return false;
        }
        if self.inactivity_pending() && self.inactivity.prompt_tick != Some(input.tick) {
            // New input ends escalation while keeping the visible question answerable.
            self.suspend_inactivity_clock();
            self.inactivity.prompt_tick = Some(input.tick);
        }
        let stage = if self.inactivity.answered_tick == Some(input.tick) {
            0
        } else if elapsed >= FINAL_CHECK_MS {
            3
        } else if elapsed >= SECOND_CHECK_MS {
            2
        } else if elapsed >= INACTIVITY_MS {
            1
        } else {
            0
        };
        if let Some(incident) = &mut self.view.incident {
            if incident.kind == IncidentKind::Inactivity
                && self.inactivity.prompt_tick == Some(input.tick)
            {
                if stage > incident.stage {
                    incident.stage = stage;
                    self.view.revision += 1;
                }
                if stage != 0 {
                    incident.seconds = elapsed / 1000;
                }
            }
            return false;
        }
        if stage == 0 {
            return false;
        }
        self.next_id += 1;
        self.inactivity.prompt_tick = Some(input.tick);
        self.view.incident = Some(Incident {
            id: self.next_id,
            kind: IncidentKind::Inactivity,
            stage,
            started_at: now.saturating_sub(elapsed),
            seconds: elapsed / 1000,
            process: String::new(),
            title: String::new(),
            claimed: false,
        });
        self.view.revision += 1;
        true
    }
    fn classify(&self, sample: &Sample) -> Category {
        if sample.idle {
            return Category::Idle;
        }
        let text = sample.key().to_lowercase();
        if self.corrections.contains(&sample.key())
            || sample.process.eq_ignore_ascii_case("in-vibe.exe")
            || self.view.related_terms.iter().any(|s| text.contains(s))
        {
            return Category::Related;
        }
        if self.view.suspect_terms.iter().any(|s| text.contains(s))
            || [
                "league of legends.exe",
                "valorant-win64-shipping.exe",
                "minecraft.exe",
            ]
            .contains(&sample.process.to_lowercase().as_str())
        {
            return Category::Suspect;
        }
        // A browser, video or an unknown app alone is never proof of distraction.
        Category::Unknown
    }
    pub fn observe(&mut self, sample: Result<Sample, String>, now: u64) -> bool {
        self.observe_as(sample, now, None)
    }
    pub fn observe_as(
        &mut self,
        sample: Result<Sample, String>,
        now: u64,
        override_class: Option<(String, Category)>,
    ) -> bool {
        self.view.revision += 1;
        self.view.monitoring = true;
        let sample = match sample {
            Ok(s) => s,
            Err(e) => {
                self.stop();
                self.view.error = Some(e);
                return false;
            }
        };
        let (key, mut category) =
            override_class.unwrap_or_else(|| (sample.key(), self.classify(&sample)));
        if !sample.idle && self.corrections.contains(&key) {
            category = Category::Related;
        }
        let delta = self
            .previous
            .as_ref()
            .filter(|(k, c, t)| *k == key && *c == category && now.saturating_sub(*t) <= 2500)
            .map(|(_, _, t)| now.saturating_sub(*t))
            .unwrap_or(0);
        // Count only observed consecutive samples. Sleep, lock, idle, errors and switches break a streak.
        if delta == 0 {
            self.held_ms = 0;
        }
        // Samples use a 1-second cadence. Wall-clock timestamps are only labels; callers supply monotonic elapsed time.
        self.held_ms += delta;
        if category == Category::Related {
            self.focus_ms += delta;
            self.view.totals.focus_seconds = self.focus_ms / 1000;
            if self.view.incident.is_none() && !sample.process.eq_ignore_ascii_case("in-vibe.exe") {
                if let Some(start) = self.return_since.take() {
                    self.view.totals.last_return_seconds = Some(now.saturating_sub(start) / 1000);
                }
            }
        }
        self.view.held_seconds = self.held_ms / 1000;
        self.previous = Some((key.clone(), category.clone(), now));
        self.view.category = category.clone();
        self.view.current = Some(sample.clone());
        self.view.error = None;
        if self.view.incident.is_some() {
            // Keep the original observation fixed once the user is asked to review it.
            return false;
        }
        if category == Category::Suspect
            && self.view.held_seconds >= self.view.threshold_seconds
            && now >= self.cooldown_until
        {
            self.next_id += 1;
            self.incident_key = Some(key);
            self.view.totals.suspicions += 1;
            self.return_since = Some(now);
            self.view.incident = Some(Incident {
                id: self.next_id,
                kind: IncidentKind::Window,
                stage: 1,
                started_at: now.saturating_sub(self.view.held_seconds * 1000),
                seconds: self.view.held_seconds,
                process: sample.process,
                title: sample.title,
                claimed: false,
            });
            return true;
        }
        false
    }
    pub fn respond(&mut self, id: u64, choice: &str, now: u64) -> Result<(), String> {
        let incident = self
            .view
            .incident
            .as_mut()
            .filter(|i| i.id == id)
            .ok_or("이미 끝난 확인이에요.")?;
        if incident.kind == IncidentKind::Inactivity && choice != "review" {
            match choice {
                "studying" | "break" | "return" => {}
                "confirm_local" => {
                    self.view.totals.confessions += 1;
                    self.return_since = Some(now);
                }
                _ => return Err("무입력 확인은 로컬 복귀만 지원해요.".into()),
            }
            self.inactivity.answered_tick = self.inactivity.prompt_tick.take();
            self.view.incident = None;
            self.previous = None;
            self.held_ms = 0;
            self.view.held_seconds = 0;
        } else if choice == "review" {
            if incident.claimed {
                return Err("이미 전송한 확인이에요.".into());
            }
        } else if choice == "claim" {
            if incident.claimed {
                return Err("이미 전송한 요청이에요. 계획 보기에서 결과를 확인하세요.".into());
            }
            incident.claimed = true;
            self.view.totals.confessions += 1;
        } else {
            if incident.claimed && choice != "resolved" {
                return Err("전송 후에는 확인 결과를 바꿀 수 없어요.".into());
            }
            if !["studying", "break", "resolved"].contains(&choice)
                || (choice == "resolved" && !incident.claimed)
            {
                return Err("알 수 없는 응답이에요.".into());
            }
            if choice == "studying" {
                self.view.totals.corrections += 1;
                self.return_since = None;
                self.corrections.insert(
                    self.incident_key
                        .clone()
                        .unwrap_or_else(|| format!("{}\n{}", incident.process, incident.title)),
                );
            }
            self.view.incident = None;
            self.previous = None;
            self.view.held_seconds = 0;
            self.held_ms = 0;
            self.cooldown_until = now + 300_000;
        }
        self.view.revision += 1;
        Ok(())
    }
}

#[cfg(test)]
mod inactivity_tests {
    use super::*;

    fn input(tick: u32, elapsed_ms: u64) -> Option<LastInput> {
        Some(LastInput { tick, elapsed_ms })
    }

    fn update(detector: &mut Detector, now: u64, tick: u32) {
        detector.observe_inactivity(now, input(tick, now - u64::from(tick)), false);
    }

    #[test]
    fn one_five_and_ten_minutes_share_the_same_last_input_and_silence_is_not_a_response() {
        let mut detector = Detector::default();
        detector.view.consent = true;
        let mut id = None;
        for now in (0..=610_000).step_by(1000) {
            update(&mut detector, now, 0);
            match now {
                59_000 => assert_eq!(detector.inactivity_stage(), 0),
                60_000 => {
                    id = detector.inactivity_id();
                    assert!(id.is_some());
                    assert_eq!(detector.inactivity_stage(), 1);
                }
                299_000 => assert_eq!(detector.inactivity_stage(), 1),
                300_000 => assert_eq!(detector.inactivity_stage(), 2),
                599_000 => assert_eq!(detector.inactivity_stage(), 2),
                600_000 => assert_eq!(detector.inactivity_stage(), 3),
                _ => {}
            }
        }
        let incident = detector.view.incident.as_ref().unwrap();
        assert_eq!(Some(incident.id), id);
        assert_eq!(incident.started_at, 0);
        assert_eq!(incident.seconds, 600);
        assert_eq!(detector.view.totals.confessions, 0);
        assert!(!incident.claimed);
        assert!(detector.can_show_inactivity_ultimate(incident.id));
        assert!(!detector.can_show_inactivity_ultimate(incident.id + 1));
        detector.observe_inactivity(611_000, input(611_000, 0), true);
        assert_eq!(detector.inactivity_stage(), 3);
        assert_eq!(detector.inactivity_id(), id);
        detector.respond(incident_id(id), "studying", 611_000).unwrap();
        assert!(detector.inactivity_id().is_none());
    }

    #[test]
    fn input_before_fullscreen_restarts_the_clock_without_dropping_the_question() {
        let mut detector = Detector::default();
        detector.view.consent = true;
        for now in (0..=60_000).step_by(1000) {
            update(&mut detector, now, 0);
        }
        let id = detector.inactivity_id();
        assert!(id.is_some());
        update(&mut detector, 61_000, 61_000);
        assert_eq!(detector.inactivity_stage(), 0);
        assert_eq!(detector.inactivity_id(), id);
        for now in (62_000..=160_000).step_by(1000) {
            update(&mut detector, now, now as u32);
            assert_eq!(detector.inactivity_id(), id);
            assert_eq!(detector.inactivity_stage(), 0);
        }
        for now in (161_000..220_000).step_by(1000) {
            update(&mut detector, now, 160_000);
            assert_eq!(detector.inactivity_stage(), 0);
        }
        update(&mut detector, 220_000, 160_000);
        assert_eq!(detector.inactivity_stage(), 1);
        assert_eq!(detector.inactivity_id(), id);
        detector
            .respond(incident_id(id), "studying", 220_000)
            .unwrap();
        assert!(detector.inactivity_id().is_none());
    }

    fn incident_id(id: Option<u64>) -> u64 {
        id.expect("inactivity incident should exist")
    }

    #[test]
    fn study_suppresses_the_same_interval_and_a_new_interval_can_prompt() {
        let mut detector = Detector::default();
        detector.view.consent = true;
        for now in (0..=60_000).step_by(1000) {
            update(&mut detector, now, 0);
        }
        let id = incident_id(detector.inactivity_id());
        assert!(detector.respond(id, "claim", 60_000).is_err());
        detector.respond(id, "studying", 60_000).unwrap();
        detector.suppress_inactivity_until_input(input(61_000, 0));
        for now in (61_000..=601_000).step_by(1000) {
            update(&mut detector, now, 61_000);
            assert!(detector.inactivity_id().is_none());
        }
        for now in (602_000..=662_000).step_by(1000) {
            update(&mut detector, now, 602_000);
        }
        let next = incident_id(detector.inactivity_id());
        assert_ne!(id, next);
        detector.respond(next, "confirm_local", 662_000).unwrap();
        assert!(detector.respond(next, "confirm_local", 662_000).is_err());
        assert_eq!(detector.view.totals.confessions, 1);
    }

    #[test]
    fn visible_youtube_stops_escalation_and_lifecycle_changes_clear_the_question() {
        let mut detector = Detector::default();
        detector.view.consent = true;
        for now in (0..=300_000).step_by(1000) {
            update(&mut detector, now, 0);
        }
        assert_eq!(detector.inactivity_stage(), 2);
        let pending = detector.inactivity_id();
        detector.observe_inactivity(301_000, input(0, 301_000), true);
        assert_eq!(detector.inactivity_id(), pending);
        assert_eq!(detector.inactivity_stage(), 0);
        update(&mut detector, 302_000, 0);
        assert_eq!(detector.inactivity_id(), pending);
        assert_eq!(detector.inactivity_stage(), 0);
        detector.reset_inactivity(); // pause, also applied on starting a new task
        detector.begin_inactivity(303_000);
        for now in (303_000..=362_000).step_by(1000) {
            update(&mut detector, now, 0);
        }
        assert!(detector.inactivity_id().is_none()); // pre-resume time is excluded
        update(&mut detector, 363_000, 0);
        assert!(detector.inactivity_id().is_some());
        detector.view.consent = false;
        update(&mut detector, 364_000, 0);
        assert!(detector.inactivity_id().is_none());
        detector.reset_session();
        assert_eq!(detector.view.totals.confessions, 0);
    }
}

#[cfg(windows)]
pub fn last_input() -> Option<LastInput> {
    use windows_sys::Win32::{
        System::SystemInformation::GetTickCount64,
        UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
    };
    // The OS supplies a timestamp, with no keys or pointer coordinates.
    unsafe {
        let mut input = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut input) == 0 {
            return None;
        }
        Some(LastInput {
            tick: input.dwTime,
            elapsed_ms: u64::from((GetTickCount64() as u32).wrapping_sub(input.dwTime)),
        })
    }
}
#[cfg(not(windows))]
pub fn last_input() -> Option<LastInput> {
    None
}

#[cfg(windows)]
pub fn sample(idle: bool) -> Result<Sample, String> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId},
    };
    // Read-only Win32 queries. LASTINPUTINFO exposes a timestamp, never the input itself.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return Err("활성 창을 확인하지 못했어요.".into());
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return Err("이 창의 프로세스는 읽을 수 없어 미분류로 둡니다.".into());
        }
        let mut path = [0u16; 32768];
        let mut length = path.len() as u32;
        let result = QueryFullProcessImageNameW(handle, 0, path.as_mut_ptr(), &mut length);
        CloseHandle(handle);
        if result == 0 {
            return Err("프로세스 이름을 확인하지 못했어요.".into());
        }
        let full = String::from_utf16_lossy(&path[..length as usize]);
        let process = full.rsplit('\\').next().unwrap_or("").to_string();
        let mut title = [0u16; 1024];
        let count = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32).max(0) as usize;
        Ok(Sample {
            process,
            title: String::from_utf16_lossy(&title[..count]),
            idle,
        })
    }
}
#[cfg(not(windows))]
pub fn sample(_idle: bool) -> Result<Sample, String> {
    Err("Windows에서만 활동 감지를 지원해요.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(title: &str) -> Sample {
        Sample {
            process: "chrome.exe".into(),
            title: title.into(),
            idle: false,
        }
    }
    fn detector() -> Detector {
        let mut d = Detector::default();
        d.configure(
            Config {
                consent: true,
                threshold_seconds: 10,
                related_terms: vec!["lecture".into()],
                suspect_terms: vec!["game".into()],
            },
            true,
        )
        .unwrap();
        d
    }
    #[test]
    fn browser_is_unknown_and_related_wins() {
        let d = detector();
        assert_eq!(d.classify(&sample("New tab")), Category::Unknown);
        assert_eq!(d.classify(&sample("game lecture")), Category::Related);
    }
    #[test]
    fn measured_streak_and_no_duplicate_alert() {
        let mut d = detector();
        for n in 0..10 {
            assert!(!d.observe(Ok(sample("game")), n * 1000));
        }
        assert!(d.observe(Ok(sample("game")), 10_000));
        assert_eq!(d.view.incident.as_ref().unwrap().seconds, 10);
        assert!(!d.observe(Ok(sample("game")), 11_000));
        d.respond(1, "claim", 12_000).unwrap();
        assert!(d.respond(1, "claim", 12_000).is_err());
    }
    #[test]
    fn idle_sleep_errors_and_switches_do_not_count() {
        let mut d = detector();
        d.observe(Ok(sample("game")), 0);
        d.observe(Ok(sample("game")), 9000);
        assert_eq!(d.view.held_seconds, 0);
        d.observe(
            Ok(Sample {
                idle: true,
                ..sample("game")
            }),
            10_000,
        );
        assert_eq!(d.view.category, Category::Idle);
        d.observe(Err("denied".into()), 11_000);
        assert!(d.view.current.is_none());
        d.observe(Ok(sample("game")), 12_000);
        assert_eq!(d.view.held_seconds, 0);
    }
    #[test]
    fn correction_is_exact_and_consent_reset_clears_private_data() {
        let mut d = detector();
        for n in 0..=10 {
            d.observe(Ok(sample("game")), n * 1000);
        }
        d.respond(1, "studying", 11_000).unwrap();
        assert_eq!(d.classify(&sample("game")), Category::Related);
        assert_eq!(d.classify(&sample("different game")), Category::Suspect);
        d.reset_session();
        assert!(d.view.current.is_none() && d.view.incident.is_none());
        assert!(!Detector::default().view.consent);
    }
    #[test]
    fn release_rejects_short_threshold() {
        assert!(detector()
            .configure(
                Config {
                    consent: true,
                    threshold_seconds: 10,
                    related_terms: vec![],
                    suspect_terms: vec![]
                },
                false
            )
            .is_err());
    }
    #[test]
    fn never_reads_without_consent_or_when_paused_or_stopped() {
        let mut d = Detector::default();
        assert!(!d.poll(true, false, 0, || panic!("read without consent")));
        d = detector();
        assert!(!d.poll(false, false, 0, || panic!("read without session")));
        assert!(!d.poll(true, true, 0, || panic!("read while paused")));
        d.poll(true, false, 0, || Ok(sample("lecture")));
        assert!(d.view.monitoring);
        d.poll(true, true, 1000, || panic!("read while paused"));
        assert!(d.view.current.is_none());
    }
    #[test]
    fn consent_revocation_always_works_and_clears_pending() {
        let mut d = detector();
        for n in 0..=10 {
            d.observe(Ok(sample("game")), n * 1000);
        }
        d.configure(
            Config {
                consent: false,
                threshold_seconds: 0,
                related_terms: vec![],
                suspect_terms: vec![],
            },
            false,
        )
        .unwrap();
        assert!(
            !d.view.consent
                && !d.view.monitoring
                && d.view.incident.is_none()
                && d.view.current.is_none()
        );
    }
    #[test]
    fn fractional_intervals_accumulate_and_cooldown_prevents_repeat() {
        let mut d = detector();
        for n in 0..=20 {
            d.observe(Ok(sample("game")), n * 500);
        }
        assert_eq!(d.view.incident.as_ref().unwrap().seconds, 10);
        d.respond(1, "break", 10_000).unwrap();
        for n in 11..40 {
            assert!(!d.observe(Ok(sample("game")), n * 1000));
        }
        assert!(d.view.incident.is_none());
    }
}

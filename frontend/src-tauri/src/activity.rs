//! In-memory only. No hooks, screenshots, keystrokes, disk log or network client.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

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
    pub started_at: u64,
    pub seconds: u64,
    pub process: String,
    pub title: String,
    pub claimed: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
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
    pub fn configure(&mut self, config: Config, development: bool) -> Result<(), String> {
        if !config.consent {
            self.reset_session();
            self.view.consent = false;
            return Ok(());
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
        self.view.incident = None;
        self.corrections.clear();
        self.cooldown_until = 0;
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
        let key = sample.key();
        let category = self.classify(&sample);
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
            self.view.incident = Some(Incident {
                id: self.next_id,
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
        if choice == "review" {
            if incident.claimed {
                return Err("이미 전송한 확인이에요.".into());
            }
        } else if choice == "claim" {
            if incident.claimed {
                return Err("이미 전송한 요청이에요. 계획 보기에서 결과를 확인하세요.".into());
            }
            incident.claimed = true;
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
                self.corrections
                    .insert(format!("{}\n{}", incident.process, incident.title));
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

#[cfg(windows)]
pub fn sample() -> Result<Sample, String> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{
            SystemInformation::GetTickCount64,
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        UI::{
            Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
            WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId},
        },
    };
    // Read-only Win32 queries. LASTINPUTINFO exposes a timestamp, never the input itself.
    unsafe {
        let mut input = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut input) == 0 {
            return Err("유휴 상태를 확인하지 못했어요.".into());
        }
        if (GetTickCount64() as u32).wrapping_sub(input.dwTime) >= 60_000 {
            return Ok(Sample {
                idle: true,
                ..Sample::default()
            });
        }
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
            idle: false,
        })
    }
}
#[cfg(not(windows))]
pub fn sample() -> Result<Sample, String> {
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

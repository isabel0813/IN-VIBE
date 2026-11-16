//! Exposure estimation from window geometry and hit tests. Never reads pixels or input contents.
#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}
impl Rect {
    fn area(self) -> i64 {
        i64::from((self.right - self.left).max(0)) * i64::from((self.bottom - self.top).max(0))
    }
    fn intersection(self, other: Self) -> Self {
        Self {
            left: self.left.max(other.left),
            top: self.top.max(other.top),
            right: self.right.min(other.right),
            bottom: self.bottom.min(other.bottom),
        }
    }
    fn contains(self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
    fn subtract(self, cover: Self) -> Vec<Self> {
        let cut = self.intersection(cover);
        if cut.area() == 0 {
            return vec![self];
        }
        [
            Self {
                bottom: cut.top,
                ..self
            },
            Self {
                top: cut.bottom,
                ..self
            },
            Self {
                top: cut.top,
                bottom: cut.bottom,
                right: cut.left,
                ..self
            },
            Self {
                top: cut.top,
                bottom: cut.bottom,
                left: cut.right,
                ..self
            },
        ]
        .into_iter()
        .filter(|r| r.area() > 0)
        .collect()
    }
}
pub fn exposed(rect: Rect, monitors: &[Rect], covers: &[Rect]) -> bool {
    let mut pieces: Vec<_> = monitors
        .iter()
        .map(|m| rect.intersection(*m))
        .filter(|r| r.area() > 0)
        .collect();
    for cover in covers {
        pieces = pieces
            .into_iter()
            .flat_map(|r| r.subtract(*cover))
            .collect();
        if pieces.len() > 4096 {
            return false;
        }
    }
    let visible: i64 = pieces.iter().map(|r| r.area()).sum();
    rect.area() > 0 && visible * 4 >= rect.area()
}
#[cfg(any(windows, test))]
fn hit_test_exposed(
    rect: Rect,
    monitors: &[Rect],
    opaque_covers: &[Rect],
    mut hits_window: impl FnMut(i32, i32) -> bool,
) -> bool {
    if rect.area() == 0 {
        return false;
    }
    let mut visible = 0;
    for row in [1, 3, 5, 7, 9, 11] {
        for column in [1, 3, 5, 7, 9, 11] {
            let x = rect.left + (rect.right - rect.left) * column / 12;
            let y = rect.top + (rect.bottom - rect.top) * row / 12;
            if monitors.iter().any(|m| m.contains(x, y))
                && !opaque_covers.iter().any(|cover| cover.contains(x, y))
                && hits_window(x, y)
            {
                visible += 1;
            }
        }
    }
    visible * 4 >= 36
}
#[derive(Clone, Copy, PartialEq, Debug)]
enum CoverOpacity {
    Invisible,
    Opaque,
    HitTest,
}
fn cover_opacity(
    layered: bool,
    ignores_hit_test: bool,
    color_key: bool,
    alpha: Option<u8>,
) -> CoverOpacity {
    if !layered {
        return CoverOpacity::Opaque;
    }
    match alpha {
        Some(0) => CoverOpacity::Invisible,
        _ if color_key => CoverOpacity::HitTest,
        Some(_) => CoverOpacity::Opaque,
        None if ignores_hit_test => CoverOpacity::Opaque,
        None => CoverOpacity::HitTest,
    }
}
#[cfg(windows)]
pub fn chrome_titles() -> Vec<String> {
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, RECT},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
            Gdi::{EnumDisplayMonitors, HDC, HMONITOR},
        },
        System::Threading::*,
        UI::WindowsAndMessaging::*,
    };
    struct Scan {
        monitors: Vec<Rect>,
        covers: Vec<Rect>,
        titles: Vec<String>,
        opaque_covers: Vec<Rect>,
        uncertain_cover: bool,
    }
    fn rect(r: RECT) -> Rect {
        Rect {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
        }
    }
    unsafe extern "system" fn monitor(_: HMONITOR, _: HDC, r: *mut RECT, data: LPARAM) -> i32 {
        (*(data as *mut Scan)).monitors.push(rect(*r));
        1
    }
    unsafe extern "system" fn window(hwnd: HWND, data: LPARAM) -> i32 {
        let scan = &mut *(data as *mut Scan);
        if IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return 1;
        }
        let mut cloaked = 0u32;
        if DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED as u32, &mut cloaked as *mut _ as _, 4) < 0
            || cloaked != 0
        {
            return 1;
        }
        let mut bounds: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut bounds) == 0 {
            return 1;
        }
        let bounds = rect(bounds);
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        // The pet is our own transparent, always-on-top window.
        if pid == GetCurrentProcessId() && bounds.area() <= 10000 {
            return 1;
        }
        let geometry_exposed = exposed(bounds, &scan.monitors, &scan.covers);
        // A layered bounding rectangle alone does not prove opaque coverage.
        // Keep known opaque covers, then verify actual hits independently of focus.
        let layered_candidate =
            scan.uncertain_cover && exposed(bounds, &scan.monitors, &scan.opaque_covers);
        if geometry_exposed || layered_candidate {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !process.is_null() {
                let mut path = [0u16; 32768];
                let mut size = path.len() as u32;
                let ok = QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut size);
                windows_sys::Win32::Foundation::CloseHandle(process);
                if ok != 0
                    && String::from_utf16_lossy(&path[..size as usize])
                        .rsplit('\\')
                        .next()
                        .is_some_and(|s| s.eq_ignore_ascii_case("chrome.exe"))
                {
                    if geometry_exposed
                        || hit_test_exposed(bounds, &scan.monitors, &scan.opaque_covers, |x, y| {
                            let hit =
                                WindowFromPoint(windows_sys::Win32::Foundation::POINT { x, y });
                            !hit.is_null() && GetAncestor(hit, GA_ROOT) == hwnd
                        })
                    {
                        let mut title = [0u16; 1024];
                        let count = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32)
                            .max(0) as usize;
                        scan.titles.push(String::from_utf16_lossy(&title[..count]));
                    }
                }
            }
        }
        if bounds.area() > 0 {
            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            let mut alpha = 255;
            let mut flags = 0;
            let attributes_read = ex_style & WS_EX_LAYERED != 0
                && GetLayeredWindowAttributes(hwnd, std::ptr::null_mut(), &mut alpha, &mut flags)
                    != 0;
            let uniform_alpha = if attributes_read && flags & LWA_ALPHA != 0 {
                Some(alpha)
            } else {
                None
            };
            match cover_opacity(
                ex_style & WS_EX_LAYERED != 0,
                ex_style & WS_EX_TRANSPARENT != 0 || style & WS_DISABLED != 0,
                attributes_read && flags & LWA_COLORKEY != 0,
                uniform_alpha,
            ) {
                CoverOpacity::Invisible => {}
                CoverOpacity::Opaque => {
                    scan.covers.push(bounds);
                    scan.opaque_covers.push(bounds);
                }
                CoverOpacity::HitTest => {
                    scan.covers.push(bounds);
                    scan.uncertain_cover = true;
                }
            }
        }
        1
    }
    let mut scan = Scan {
        monitors: vec![],
        covers: vec![],
        titles: vec![],
        opaque_covers: vec![],
        uncertain_cover: false,
    };
    unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            Some(monitor),
            &mut scan as *mut _ as LPARAM,
        );
        if EnumWindows(Some(window), &mut scan as *mut _ as LPARAM) == 0 {
            return vec![];
        }
    }
    scan.titles
}
#[cfg(not(windows))]
pub fn chrome_titles() -> Vec<String> {
    vec![]
}
#[cfg(test)]
mod tests {
    use super::*;
    fn r(l: i32, t: i32, r: i32, b: i32) -> Rect {
        Rect {
            left: l,
            top: t,
            right: r,
            bottom: b,
        }
    }
    #[test]
    fn unfocused_partial_window_uses_the_same_quarter_exposure_threshold() {
        let monitor = r(0, 0, 1200, 900);
        let mut points = vec![];
        assert!(hit_test_exposed(monitor, &[monitor], &[], |x, y| {
            points.push((x, y));
            true
        }));
        assert_eq!(points.len(), 36);
        assert!(hit_test_exposed(monitor, &[monitor], &[], |x, _| x < 600));
        let mut index = 0;
        assert!(hit_test_exposed(monitor, &[monitor], &[], |_, _| {
            index += 1;
            index <= 9
        }));
        index = 0;
        assert!(!hit_test_exposed(monitor, &[monitor], &[], |_, _| {
            index += 1;
            index <= 8
        }));
        assert!(!hit_test_exposed(monitor, &[monitor], &[], |_, _| false));
    }
    #[test]
    fn foreground_probes_respect_negative_monitor_coordinates_and_offscreen_bounds() {
        let monitor = r(-1200, 0, 0, 900);
        assert!(hit_test_exposed(monitor, &[monitor], &[], |_, _| true));
        assert!(!hit_test_exposed(
            r(-6000, 0, 0, 900),
            &[monitor],
            &[],
            |_, _| true
        ));
        assert!(!hit_test_exposed(
            r(0, 0, 0, 0),
            &[monitor],
            &[],
            |_, _| panic!("empty window")
        ));
    }
    #[test]
    fn opaque_and_click_through_layered_covers_cannot_be_bypassed() {
        let monitor = r(0, 0, 1200, 900);
        assert!(!hit_test_exposed(
            monitor,
            &[monitor],
            &[monitor],
            |_, _| true
        ));
        assert_eq!(
            cover_opacity(false, true, false, None),
            CoverOpacity::Opaque
        );
        assert_eq!(cover_opacity(true, true, false, None), CoverOpacity::Opaque);
        assert_eq!(
            cover_opacity(true, false, false, Some(255)),
            CoverOpacity::Opaque
        );
        assert_eq!(
            cover_opacity(true, false, false, Some(100)),
            CoverOpacity::Opaque
        );
        assert_eq!(
            cover_opacity(true, false, false, None),
            CoverOpacity::HitTest
        );
        assert_eq!(
            cover_opacity(true, true, false, Some(0)),
            CoverOpacity::Invisible
        );
        assert_eq!(
            cover_opacity(true, true, true, Some(255)),
            CoverOpacity::HitTest
        );
    }
    #[test]
    fn split_dual_negative_and_occlusion() {
        let monitors = [r(-1920, 0, 0, 1080), r(0, 0, 1920, 1080)];
        assert!(exposed(
            r(-1920, 0, 0, 1080),
            &monitors,
            &[r(0, 0, 1920, 1080)]
        ));
        assert!(exposed(
            r(0, 0, 960, 1080),
            &monitors,
            &[r(960, 0, 1920, 1080)]
        ));
        assert!(!exposed(
            r(0, 0, 960, 1080),
            &monitors,
            &[r(0, 0, 960, 1080)]
        ));
        assert!(!exposed(r(2000, 0, 3000, 1080), &monitors, &[]));
        assert!(!exposed(
            r(0, 0, 960, 1080),
            &monitors,
            &[r(0, 0, 480, 1080), r(480, 0, 960, 1080)]
        ));
    }
}

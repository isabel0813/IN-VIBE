//! Geometry-only exposure estimation. Never reads pixels or input contents.
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
        if exposed(bounds, &scan.monitors, &scan.covers) {
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
                    let mut title = [0u16; 1024];
                    let count = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32).max(0)
                        as usize;
                    scan.titles.push(String::from_utf16_lossy(&title[..count]));
                }
            }
        }
        if bounds.area() > 0 {
            scan.covers.push(bounds);
        }
        1
    }
    let mut scan = Scan {
        monitors: vec![],
        covers: vec![],
        titles: vec![],
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

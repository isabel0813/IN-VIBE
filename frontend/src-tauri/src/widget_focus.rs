use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub struct ManualBubbleFocus(AtomicBool);

impl ManualBubbleFocus {
    pub fn reset(&self) {
        self.0.store(false, Ordering::Relaxed);
    }

    pub fn changed(&self, manual_open: bool, focused: bool, still_foreground: bool) -> bool {
        if !manual_open {
            return false;
        }
        if focused {
            self.0.store(true, Ordering::Relaxed);
            return false;
        }
        !still_foreground && self.0.swap(false, Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::ManualBubbleFocus;

    #[test]
    fn waits_for_focus_and_ignores_focus_changes_inside_the_widget() {
        let focus = ManualBubbleFocus::default();
        assert!(!focus.changed(true, false, false)); // opening has not acquired focus
        assert!(!focus.changed(true, true, true));
        assert!(!focus.changed(true, false, true)); // WebView can take focus within the widget
        assert!(focus.changed(true, false, false)); // outside click
        focus.reset(); // reopening must wait for its own focus
        assert!(!focus.changed(true, false, false));
        assert!(!focus.changed(true, true, true));
        assert!(focus.changed(true, false, false));
    }

    #[test]
    fn automatic_prompts_do_not_arm_or_dismiss() {
        let focus = ManualBubbleFocus::default();
        assert!(!focus.changed(false, true, true));
        assert!(!focus.changed(false, false, false));
        assert!(!focus.changed(true, false, false));
    }
}

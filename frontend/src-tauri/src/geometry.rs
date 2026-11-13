use serde::Serialize;

pub const PET: f64 = 80.0;
pub const WIDTH: f64 = 340.0;
pub const HEIGHT: f64 = 440.0;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub open: bool,
    pub pet_x: f64,
    pub pet_y: f64,
    pub width: f64,
    pub height: f64,
}
impl Default for Layout {
    fn default() -> Self {
        Self {
            open: false,
            pet_x: 0.0,
            pet_y: 0.0,
            width: PET,
            height: PET,
        }
    }
}

// Coordinates are physical desktop pixels; UI dimensions are logical pixels.
// Work areas include negative monitor origins and exclude the Windows taskbar.
pub fn place(
    anchor: (f64, f64),
    work: (f64, f64, f64, f64),
    scale: f64,
    open: bool,
) -> ((f64, f64), Layout) {
    let (left, top, right, bottom) = work;
    let size = PET * scale;
    let ax = anchor.0.clamp(left, (right - size).max(left));
    let ay = anchor.1.clamp(top, (bottom - size).max(top));
    if !open {
        return ((ax, ay), Layout::default());
    }
    let width = (WIDTH * scale).min(right - left);
    let height = (HEIGHT * scale).min(bottom - top);
    let x = if ax - left >= width - size {
        ax + size - width
    } else {
        ax
    };
    let y = if ay - top >= height - size {
        ay + size - height
    } else {
        ay
    };
    let x = x.clamp(left, (right - width).max(left));
    let y = y.clamp(top, (bottom - height).max(top));
    (
        (x, y),
        Layout {
            open,
            pet_x: (ax - x) / scale,
            pet_y: (ay - y) / scale,
            width: width / scale,
            height: height / scale,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn corners_and_negative_monitor_origins_preserve_pet_anchor() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            for (x, y) in [
                (-1920.0, 0.0),
                (-200.0, 0.0),
                (-1920.0, 800.0),
                (-200.0, 800.0),
            ] {
                let ((left, top), layout) = place((x, y), (-1920.0, 0.0, 0.0, 1040.0), scale, true);
                assert!(left >= -1920.0 && top >= 0.0);
                assert!(left + layout.width * scale <= 0.0);
                assert!(top + layout.height * scale <= 1040.0);
                assert_eq!(left + layout.pet_x * scale, x);
                assert_eq!(top + layout.pet_y * scale, y.min(1040.0 - PET * scale));
            }
        }
    }
}

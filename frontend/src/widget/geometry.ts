import type { WidgetLayout } from "../desktop/bridge";

export function previewPlacement(
  x: number,
  y: number,
  width: number,
  height: number,
  open: boolean,
) {
  const petX = Math.max(0, Math.min(x, width - 80));
  const petY = Math.max(0, Math.min(y, height - 80));
  const w = open ? Math.min(340, width) : 80;
  const h = open ? Math.min(440, height) : 80;
  const left = Math.max(
    0,
    Math.min(petX >= w - 80 ? petX + 80 - w : petX, width - w),
  );
  const top = Math.max(
    0,
    Math.min(petY >= h - 80 ? petY + 80 - h : petY, height - h),
  );
  const layout: WidgetLayout = {
    open,
    width: w,
    height: h,
    petX: petX - left,
    petY: petY - top,
  };
  return { left, top, layout };
}

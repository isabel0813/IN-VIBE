import type { WidgetLayout } from "../desktop/bridge";

export function bubblePlacement({ height, petY }: WidgetLayout) {
  const below = height - petY - 80;
  const above = petY >= below;
  return {
    above,
    style: {
      left: 8,
      right: 8,
      maxHeight: Math.max(0, (above ? petY : below) - 16),
      ...(above ? { bottom: height - petY + 8 } : { top: petY + 88 }),
    },
  };
}

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

import { useEffect, useRef, type ReactNode } from "react";
import { ultimateArt } from "../widget/character";

export default function UltimateDialog({ children, label = "안뇽이 궁극기", onEscape }: {
  children: ReactNode;
  label?: string;
  onEscape?: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { dialog.current?.focus(); }, []);
  return <div className="ultimate-overlay" ref={dialog} tabIndex={-1} role="alertdialog" aria-modal="true" aria-label={label}
    onKeyDown={event => {
      if (event.key === "Escape" && onEscape) { event.preventDefault(); onEscape(); return; }
      if (event.key !== "Tab") return;
      const buttons = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? [])];
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    }}>
    <div className="ultimate-visual"><img className="ultimate-art" src={ultimateArt} alt="안뇽이 궁극기" /></div>
    <div className="ultimate-card">{children}</div>
  </div>;
}

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { isDesktop } from "../desktop/bridge";

export interface Incident {
  id: number; startedAt: number; seconds: number; process: string; title: string; claimed: boolean;
}
export interface ActivityConfig {
  consent: boolean; thresholdSeconds: number; relatedTerms: string[]; suspectTerms: string[];
}
export interface Activity extends ActivityConfig {
  totals?: { focusSeconds: number; suspicions: number; confessions: number; corrections: number; lastReturnSeconds: number | null };
  revision: number; monitoring: boolean; category: "related" | "suspect" | "unknown" | "idle";
  current: { process: string; title: string; idle: boolean } | null;
  heldSeconds: number; incident: Incident | null; error: string | null;
}
export const emptyActivity: Activity = {
  revision: 0, consent: false, monitoring: false, category: "unknown", current: null,
  heldSeconds: 0, incident: null, thresholdSeconds: 300, relatedTerms: [], suspectTerms: [], error: null,
};
export const activityApi = {
  read: () => invoke<Activity>("activity_read"),
  configure: (config: ActivityConfig) => invoke<Activity>("activity_configure", { config }),
  respond: (id: number, choice: "review" | "claim" | "studying" | "break" | "resolved") => invoke<Activity>("activity_respond", { id, choice }),
};
export function useActivity() {
  const [value, setValue] = useState(emptyActivity);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isDesktop()) return;
    let alive = true;
    let dispose: (() => void) | undefined;
    const accept = (next: Activity) => { if (alive) setValue(old => next.revision >= old.revision ? next : old); };
    void (async () => {
      try {
        const stop = await listen<Activity>("activity-state", event => accept(event.payload));
        if (!alive) { stop(); return; }
        dispose = stop; accept(await activityApi.read());
      } catch (failure) { if (alive) setError(String(failure)); }
    })();
    return () => { alive = false; dispose?.(); };
  }, []);
  return { activity: value, error };
}
export const categoryLabels = { related: "관련 활동", suspect: "이탈 의심", unknown: "미분류", idle: "유휴" };

export type InterventionStage = 1 | 2 | 3;
export const escalation = { firstMs: 60_000, secondMs: 300_000, ultimateMs: 600_000 };
type ObservationTime = { elapsed: number; lastSeen: number | null; until?: number; hold?: number };

// Counts successive visible, playing observations. Hidden time, pauses,
// stalled polling and computer sleep never advance an intervention.
export class InterventionClock {
  private observations = new Map<string, ObservationTime>();
  constructor(private thresholds = escalation) {}
  observe(ids: string[], now: number) {
    const visible = new Set(ids);
    for (const [id, time] of this.observations) {
      if (!visible.has(id)) time.lastSeen = null;
    }
    for (const id of visible) {
      const time = this.observations.get(id) ?? { elapsed: 0, lastSeen: null };
      if (now < (time.until ?? 0)) continue;
      time.until = undefined;
      if (time.lastSeen !== null) {
        const delta = now - time.lastSeen;
        if (delta >= 0 && delta <= 2500) time.elapsed += delta;
      }
      time.lastSeen = now;
      this.observations.set(id, time);
    }
  }
  stage(id: string): 0 | InterventionStage {
    const time = this.observations.get(id);
    if (time?.until !== undefined) return 0;
    const elapsed = (time?.elapsed ?? 0) - (time?.hold ?? 0);
    if (elapsed >= this.thresholds.ultimateMs) return 3;
    if (elapsed >= this.thresholds.secondMs) return 2;
    if (elapsed >= this.thresholds.firstMs) return 1;
    return 0;
  }
  rearm(id: string, mode: "return" | "study", at: number) {
    this.observations.set(id, { elapsed: 0, lastSeen: null,
      until: mode === "study" ? at + 30 * 60_000 : undefined,
      hold: mode === "return" ? 10 * 60_000 : undefined });
  }
  pause() { for (const time of this.observations.values()) time.lastSeen = null; }
  clear() { this.observations.clear(); }
}

export type InterventionStage = 1 | 2 | 3;
export const escalation = { firstMs: 60_000, secondMs: 300_000, ultimateMs: 600_000 };
type ObservationTime = { elapsed: number; lastSeen: number | null; until?: number; hold?: number };

// Counts successive visible, playing observations. Hidden time, pauses,
// stalled polling and computer sleep never advance an intervention.
export class InterventionClock {
  private observations = new Map<string, ObservationTime>();
  private streak = 0;
  private current = new Set<string>();
  private sampledAt: number | null = null;
  constructor(private thresholds = escalation) {}
  observe(ids: string[], now: number, relatedPlaying = false) {
    const visible = new Set(ids);
    const current = new Set<string>();
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
      if (time.elapsed >= (time.hold ?? 0)) current.add(id);
    }
    // Count wall time once, even if more than one suspicious video is playing.
    // Empty samples (ads, navigation, no visibility) break the sample pair,
    // while leaving the verified earlier time available for the next video.
    if (current.size === 0 && relatedPlaying && visible.size === 0) this.streak = 0;
    const delta = this.sampledAt === null ? -1 : now - this.sampledAt;
    if (delta >= 0 && delta <= 2500 && [...current].some(id => this.current.has(id))) this.streak += delta;
    this.current = current;
    this.sampledAt = now;
  }
  stage(id: string): 0 | InterventionStage {
    const time = this.observations.get(id);
    if (!time || !this.current.has(id)) return 0;
    // An answered video gets a fresh set of thresholds, even if another
    // suspicious video has already advanced the shared streak.
    const elapsed = time.hold !== undefined
      ? Math.min(this.streak, time.elapsed - time.hold) : this.streak;
    if (elapsed >= this.thresholds.ultimateMs) return 3;
    if (elapsed >= this.thresholds.secondMs) return 2;
    if (elapsed >= this.thresholds.firstMs) return 1;
    return 0;
  }
  rearm(id: string, mode: "return" | "study", at: number) {
    this.streak = 0;
    this.pause();
    this.observations.set(id, { elapsed: 0, lastSeen: null,
      until: mode === "study" ? at + 30 * 60_000 : undefined,
      hold: mode === "return" ? 10 * 60_000 : 0 });
  }
  pause() {
    for (const time of this.observations.values()) time.lastSeen = null;
    this.current.clear();
    this.sampledAt = null;
  }
  clear() {
    this.pause();
    this.observations.clear();
    this.streak = 0;
  }
}

export type Video = { title: string; video_id: string };
export type Judgment = { action: "ask" | "ignore"; reason: string; category?: string };
export function backgroundVideo(title: string): boolean {
  return /\b(lo[ -]?fi|asmr|study\s*with\s*me|white\s*noise|background\s*music)\b|스터디윗미|백색\s*소음|공부\s*음악|플레이리스트|빗소리/i.test(title);
}
export function shouldAsk(video: Video, result: Judgment): boolean {
  return !backgroundVideo(video.title) && result.category !== "background" && result.action === "ask";
}

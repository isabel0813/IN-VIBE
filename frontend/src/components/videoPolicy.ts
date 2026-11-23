export type Video = { title: string; video_id: string };
export type Judgment = { action: "ask" | "ignore"; reason: string; category?: string };
export function backgroundVideo(title: string): boolean {
  if (/\b(?:official\s+video|music\s+video|m\s*\/\s*v|mv|gameplay|highlights)\b|뮤직\s*비디오|게임\s*플레이|하이라이트/i.test(title)) return false;
  if (/\b(?:lo[ -]?fi|asmr|study\s*with\s*me|white\s*noise|background\s*music)\b|스터디윗미|백색\s*소음|공부(?:용)?\s*음악|빗소리/i.test(title)) return true;
  // A playlist can contain music, music videos, or gameplay. Require a listening cue.
  return /플레이리스트|\bplaylist\b/i.test(title)
    && /음악|노동요|연주|재즈|클래식|\b(?:music|bgm|instrumental)\b/i.test(title);
}
export function shouldAsk(video: Video, result: Judgment): boolean {
  return !backgroundVideo(video.title) && result.category !== "background" && result.action === "ask";
}

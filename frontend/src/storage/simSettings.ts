export const DEFAULT_ANSWER_MAX_TOKENS = 8192;
export const MIN_ANSWER_MAX_TOKENS = 256;
export const MAX_ANSWER_MAX_TOKENS = 65536;

const ANSWER_MAX_TOKENS_KEY = "colony.answer_max_tokens";

export function clampAnswerMaxTokens(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ANSWER_MAX_TOKENS;
  return Math.max(MIN_ANSWER_MAX_TOKENS, Math.min(MAX_ANSWER_MAX_TOKENS, Math.floor(value)));
}

export function getStoredAnswerMaxTokens(): number {
  const raw = localStorage.getItem(ANSWER_MAX_TOKENS_KEY);
  if (!raw) return DEFAULT_ANSWER_MAX_TOKENS;
  return clampAnswerMaxTokens(parseInt(raw, 10));
}

export function saveAnswerMaxTokens(value: number): void {
  localStorage.setItem(ANSWER_MAX_TOKENS_KEY, String(clampAnswerMaxTokens(value)));
}
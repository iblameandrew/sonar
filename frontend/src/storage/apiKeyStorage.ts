const API_KEY_KEY = "colony.qwen.api_key";

/** API key persists in localStorage once saved until explicitly cleared. */
export function getStoredApiKey(): string | null {
  const key = localStorage.getItem(API_KEY_KEY);
  return key?.trim() || null;
}

export function saveApiKey(key: string): void {
  localStorage.setItem(API_KEY_KEY, key.trim());
}

export function clearStoredApiKey(): void {
  localStorage.removeItem(API_KEY_KEY);
}

/** @deprecated Remember is always on; kept for older saved prefs. */
export function isRememberEnabled(): boolean {
  return Boolean(getStoredApiKey());
}

/** @deprecated Remember is always on. */
export function setRememberEnabled(_enabled: boolean): void {
  /* no-op — keys always persist once saved */
}
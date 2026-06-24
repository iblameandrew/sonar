const REMEMBER_KEY = "colony.qwen.remember";
const API_KEY_KEY = "colony.qwen.api_key";

export function isRememberEnabled(): boolean {
  return localStorage.getItem(REMEMBER_KEY) === "1";
}

export function setRememberEnabled(enabled: boolean): void {
  localStorage.setItem(REMEMBER_KEY, enabled ? "1" : "0");
  if (!enabled) localStorage.removeItem(API_KEY_KEY);
}

export function getStoredApiKey(): string | null {
  if (!isRememberEnabled()) return null;
  const key = localStorage.getItem(API_KEY_KEY);
  return key?.trim() || null;
}

export function saveApiKey(key: string): void {
  localStorage.setItem(REMEMBER_KEY, "1");
  localStorage.setItem(API_KEY_KEY, key.trim());
}

export function clearStoredApiKey(): void {
  localStorage.removeItem(API_KEY_KEY);
}
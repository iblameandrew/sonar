export type GenAIBackend = "dashscope" | "openrouter";

const BACKEND_KEY = "colony.genai.backend";
const MODEL_SLUG_KEY = "colony.genai.model_slug";
const DASHSCOPE_KEY = "colony.qwen.api_key";
const OPENROUTER_KEY = "colony.openrouter.api_key";

export const DEFAULT_OPENROUTER_MODEL = "nex-agi/nex-n2-pro";

/** API key persists in localStorage once saved until explicitly cleared. */
export function getStoredBackend(): GenAIBackend {
  const raw = localStorage.getItem(BACKEND_KEY)?.trim().toLowerCase();
  return raw === "openrouter" ? "openrouter" : "dashscope";
}

export function saveBackend(backend: GenAIBackend): void {
  localStorage.setItem(BACKEND_KEY, backend);
}

export function getStoredModelSlug(): string {
  return localStorage.getItem(MODEL_SLUG_KEY)?.trim() || DEFAULT_OPENROUTER_MODEL;
}

export function saveModelSlug(slug: string): void {
  localStorage.setItem(MODEL_SLUG_KEY, slug.trim() || DEFAULT_OPENROUTER_MODEL);
}

export function getStoredApiKey(backend?: GenAIBackend): string | null {
  const active = backend ?? getStoredBackend();
  const key = localStorage.getItem(active === "openrouter" ? OPENROUTER_KEY : DASHSCOPE_KEY);
  return key?.trim() || null;
}

export function saveApiKey(key: string, backend?: GenAIBackend): void {
  const active = backend ?? getStoredBackend();
  const storageKey = active === "openrouter" ? OPENROUTER_KEY : DASHSCOPE_KEY;
  localStorage.setItem(storageKey, key.trim());
}

export function clearStoredApiKey(backend?: GenAIBackend): void {
  const active = backend ?? getStoredBackend();
  localStorage.removeItem(active === "openrouter" ? OPENROUTER_KEY : DASHSCOPE_KEY);
}

/** @deprecated Remember is always on; kept for older saved prefs. */
export function isRememberEnabled(): boolean {
  return Boolean(getStoredApiKey());
}

/** @deprecated Remember is always on. */
export function setRememberEnabled(_enabled: boolean): void {
  /* no-op — keys always persist once saved */
}
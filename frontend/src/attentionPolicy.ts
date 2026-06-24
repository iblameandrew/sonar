export interface AttentionFunction {
  id: string;
  label: string;
  category: string;
  roles: string[];
  kinds: string[];
}

export interface AttentionHeadConfig {
  primary_focus: string[];
  secondary_focus: string[];
  weight_distribution: Record<string, number>;
  description: string;
}

export interface AttentionPolicy {
  heads: Record<string, AttentionHeadConfig>;
}

export interface PolicyPreview {
  function: string;
  label: string;
  weight: number;
  bias: string;
}

const STORAGE_KEY = "colony_attention_policy_v1";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    throw new Error(`${path} failed: HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchCatalogue(): Promise<AttentionFunction[]> {
  const data = await fetchJson<{ functions?: AttentionFunction[] }>("/api/attention/catalogue");
  const functions = data.functions ?? [];
  if (!functions.length) {
    throw new Error("attention catalogue empty");
  }
  return functions;
}

export async function fetchDefaultPolicy(): Promise<AttentionPolicy> {
  const data = await fetchJson<{ policy: AttentionPolicy }>("/api/attention/policy/default");
  return data.policy;
}

export async function normalizePolicy(policy: AttentionPolicy): Promise<{
  policy: AttentionPolicy;
  preview: PolicyPreview[];
}> {
  return fetchJson("/api/attention/policy/normalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(policy),
  });
}

export async function withApiRetry<T>(
  fn: () => Promise<T>,
  attempts = 15,
  delayMs = 500,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw last;
}

export function savePolicyLocal(policy: AttentionPolicy): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(policy));
}

export function loadPolicyLocal(): AttentionPolicy | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AttentionPolicy;
  } catch {
    return null;
  }
}

export function emptyHead(): AttentionHeadConfig {
  return {
    primary_focus: [],
    secondary_focus: [],
    weight_distribution: {},
    description: "",
  };
}
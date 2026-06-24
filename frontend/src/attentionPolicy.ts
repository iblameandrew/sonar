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

export async function fetchCatalogue(): Promise<AttentionFunction[]> {
  const res = await fetch("/api/attention/catalogue");
  const data = await res.json();
  return data.functions ?? [];
}

export async function fetchDefaultPolicy(): Promise<AttentionPolicy> {
  const res = await fetch("/api/attention/policy/default");
  const data = await res.json();
  return data.policy as AttentionPolicy;
}

export async function normalizePolicy(policy: AttentionPolicy): Promise<{
  policy: AttentionPolicy;
  preview: PolicyPreview[];
}> {
  const res = await fetch("/api/attention/policy/normalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(policy),
  });
  return res.json();
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
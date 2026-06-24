import type { Agent } from "./types";

export function formatSystemPrompt(agent: Agent, purpose = ""): string {
  if (agent.system_prompt?.trim()) return agent.system_prompt.trim();
  const lines = [
    `You are ${agent.name} (${agent.role}).`,
    `Verbs: ${agent.verbs.join(", ") || "observe"}`,
    `Nouns: ${agent.nouns.join(", ") || "task"}`,
    `Adjectives: ${agent.adjectives.join(", ") || "neutral"}`,
  ];
  if (purpose) lines.push(`Purpose: ${purpose}`);
  if (agent.current_task_id) lines.push(`Current task: ${agent.current_task_id}`);
  return lines.join("\n");
}
import type { Agent } from "./types";
import { ROLE_SYSTEM_PROMPTS } from "./rolePrompts";

export function formatSystemPrompt(agent: Agent, purpose = ""): string {
  const rolePrompt = ROLE_SYSTEM_PROMPTS[agent.role];
  const lines: string[] = [];

  if (rolePrompt) {
    lines.push(rolePrompt);
    if (agent.name && !rolePrompt.includes(agent.name)) {
      lines.push(`Grid identity: ${agent.name}`);
    }
    if (agent.verbs.length || agent.nouns.length || agent.adjectives.length) {
      lines.push(
        `Traits: verbs=${agent.verbs.join(", ") || "observe"}; ` +
          `nouns=${agent.nouns.join(", ") || "task"}; ` +
          `adjectives=${agent.adjectives.join(", ") || "neutral"}`,
      );
    }
  } else if (agent.system_prompt?.trim()) {
    lines.push(agent.system_prompt.trim());
  } else {
    lines.push(
      `You are ${agent.name} (${agent.role}).`,
      `Verbs: ${agent.verbs.join(", ") || "observe"}`,
      `Nouns: ${agent.nouns.join(", ") || "task"}`,
      `Adjectives: ${agent.adjectives.join(", ") || "neutral"}`,
    );
  }

  if (purpose) lines.push(`Purpose: ${purpose}`);
  if (agent.current_task_id) lines.push(`Current task: ${agent.current_task_id}`);
  return lines.join("\n");
}
import type { Agent, PersonaFiles } from "../services/types";

export const EMPTY_PERSONA: PersonaFiles = {
  identity: "",
  soul: "",
  user: "",
  agents: "",
  tools: "",
};

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "test-id",
    folder_name: "test-folder",
    name: "Test Agent",
    avatar: null,
    description: "",
    model: null,
    temperature: null,
    thinking_enabled: null,
    thinking_budget: null,
    is_default: false,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

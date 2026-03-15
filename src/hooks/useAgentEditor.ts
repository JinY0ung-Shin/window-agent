import { useAgentStore, type PersonaTab } from "../stores/agentStore";
import type { Agent, PersonaFiles } from "../services/types";

interface AgentEditorState {
  isEditorOpen: boolean;
  editingAgentId: string | null;
  editingAgent: Agent | null;
  agents: Agent[];
  personaFiles: PersonaFiles | null;
  personaTab: PersonaTab;
  editorError: string | null;
}

interface AgentEditorActions {
  closeEditor: () => void;
  setPersonaTab: (tab: PersonaTab) => void;
  updatePersonaFile: (fileName: PersonaTab, content: string) => void;
  saveAgent: (updates: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  openEditor: (agentId: string | null) => Promise<void>;
}

export function useAgentEditor(): AgentEditorState & AgentEditorActions {
  const isEditorOpen = useAgentStore((s) => s.isEditorOpen);
  const editingAgentId = useAgentStore((s) => s.editingAgentId);
  const agents = useAgentStore((s) => s.agents);
  const personaFiles = useAgentStore((s) => s.personaFiles);
  const personaTab = useAgentStore((s) => s.personaTab);
  const editorError = useAgentStore((s) => s.editorError);
  const closeEditor = useAgentStore((s) => s.closeEditor);
  const setPersonaTab = useAgentStore((s) => s.setPersonaTab);
  const updatePersonaFile = useAgentStore((s) => s.updatePersonaFile);
  const saveAgent = useAgentStore((s) => s.saveAgent);
  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const openEditor = useAgentStore((s) => s.openEditor);

  const editingAgent = editingAgentId
    ? agents.find((a) => a.id === editingAgentId) ?? null
    : null;

  return {
    isEditorOpen,
    editingAgentId,
    editingAgent,
    agents,
    personaFiles,
    personaTab,
    editorError,
    closeEditor,
    setPersonaTab,
    updatePersonaFile,
    saveAgent,
    deleteAgent,
    openEditor,
  };
}

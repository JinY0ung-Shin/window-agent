import * as cmds from "./tauriCommands";
import { useSettingsStore } from "../stores/settingsStore";
import {
  DEFAULT_CONVERSATION_TITLE,
  TITLE_GENERATION_PROMPT,
} from "../constants";

export async function generateTitle(
  convId: string,
  userMsg: string,
  assistantMsg: string,
  expectedCurrentTitle: string | null,
  loadConversations: () => Promise<void>,
): Promise<void> {
  try {
    const settings = useSettingsStore.getState();
    const resp = await cmds.chatCompletion({
      messages: [
        { role: "system", content: TITLE_GENERATION_PROMPT },
        { role: "user", content: `User: ${userMsg}\nAssistant: ${assistantMsg}` },
      ],
      system_prompt: "",
      model: settings.modelName,
      thinking_enabled: false,
      thinking_budget: null,
    });
    const title = resp.content.trim().replace(/^["']|["']$/g, "").slice(0, 50) || DEFAULT_CONVERSATION_TITLE;
    await cmds.updateConversationTitle(convId, title, expectedCurrentTitle);
    await loadConversations();
  } catch {
    // Silently ignore — title is non-critical
  }
}

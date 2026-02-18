import {
  AgentRole,
  AgentStatus,
  MessageType,
  type BusMessage,
} from "@otterbot/shared";
import { BaseAgent, type AgentOptions } from "./agent.js";
import type { MessageBus } from "../bus/message-bus.js";
import { createAdminTools } from "../tools/tool-factory.js";
import { buildAdminAssistantPrompt } from "./prompts/admin-assistant.js";
import { getConfig } from "../auth/auth.js";

const ADMIN_ASSISTANT_ID = "admin-assistant";

export interface AdminAssistantDependencies {
  bus: MessageBus;
  onStatusChange?: (agentId: string, status: AgentStatus) => void;
  onStream?: (token: string, messageId: string) => void;
  onThinking?: (token: string, messageId: string) => void;
  onThinkingEnd?: (messageId: string) => void;
}

export class AdminAssistant extends BaseAgent {
  private onStream?: (token: string, messageId: string) => void;
  private onThinking?: (token: string, messageId: string) => void;
  private onThinkingEnd?: (messageId: string) => void;

  constructor(deps: AdminAssistantDependencies) {
    // Build system prompt with current date
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const agentName = getConfig("admin_assistant_name") ?? "Admin Assistant";
    let systemPrompt = buildAdminAssistantPrompt(agentName);
    systemPrompt += `\n\n## Current Date\nToday is ${dateStr}. Current time: ${now.toISOString()}.`;

    // Inject user profile context
    const userName = getConfig("user_name");
    if (userName) {
      const userTimezone = getConfig("user_timezone");
      const lines = [`## About Your CEO`, `- Name: ${userName}`];
      if (userTimezone) lines.push(`- Timezone: ${userTimezone}`);
      systemPrompt = lines.join("\n") + "\n\n" + systemPrompt;
    }

    // Read optional 3D character config
    const modelPackId = getConfig("admin_assistant_model_pack_id") ?? null;
    const gearConfigRaw = getConfig("admin_assistant_gear_config");
    const gearConfig = gearConfigRaw ? JSON.parse(gearConfigRaw) : null;

    const options: AgentOptions = {
      id: ADMIN_ASSISTANT_ID,
      role: AgentRole.AdminAssistant,
      parentId: null,
      projectId: null,
      model: getConfig("coo_model") ?? "claude-sonnet-4-5-20250929",
      provider: getConfig("coo_provider") ?? "anthropic",
      systemPrompt,
      modelPackId,
      gearConfig,
      onStatusChange: deps.onStatusChange,
    };

    super(options, deps.bus);
    this.onStream = deps.onStream;
    this.onThinking = deps.onThinking;
    this.onThinkingEnd = deps.onThinkingEnd;
  }

  getTools(): Record<string, unknown> {
    return createAdminTools();
  }

  async handleMessage(message: BusMessage): Promise<void> {
    if (message.type === MessageType.Chat) {
      await this.handleChatMessage(message);
    }
  }

  private async handleChatMessage(message: BusMessage) {
    const { text, thinking } = await this.think(
      message.content,
      (token, messageId) => {
        this.onStream?.(token, messageId);
      },
      (token, messageId) => {
        this.onThinking?.(token, messageId);
      },
      (messageId) => {
        this.onThinkingEnd?.(messageId);
      },
    );

    // Send the response back through the bus
    this.sendMessage(
      null,
      MessageType.Chat,
      text,
      thinking ? { thinking } : undefined,
    );
  }
}

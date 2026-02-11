import {
  AgentRole,
  AgentStatus,
  MessageType,
  type BusMessage,
} from "@smoothbot/shared";
import { BaseAgent, type AgentOptions } from "./agent.js";
import type { MessageBus } from "../bus/message-bus.js";

export interface WorkerDependencies {
  bus: MessageBus;
  projectId: string | null;
  parentId: string;
  registryEntryId: string;
  model: string;
  provider: string;
  systemPrompt: string;
  workspacePath: string | null;
}

export class Worker extends BaseAgent {
  constructor(deps: WorkerDependencies) {
    const options: AgentOptions = {
      role: AgentRole.Worker,
      parentId: deps.parentId,
      projectId: deps.projectId,
      registryEntryId: deps.registryEntryId,
      model: deps.model,
      provider: deps.provider,
      systemPrompt: deps.systemPrompt,
      workspacePath: deps.workspacePath,
    };
    super(options, deps.bus);
  }

  handleMessage(message: BusMessage): void {
    if (message.type === MessageType.Directive) {
      this.handleTask(message);
    }
  }

  private async handleTask(message: BusMessage) {
    const response = await this.think(message.content);

    // Report results back to Team Lead
    if (this.parentId) {
      this.sendMessage(this.parentId, MessageType.Report, response);
    }
  }
}

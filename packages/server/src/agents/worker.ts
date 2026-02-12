import {
  type GearConfig,
  AgentRole,
  AgentStatus,
  MessageType,
  type BusMessage,
} from "@smoothbot/shared";
import { BaseAgent, type AgentOptions } from "./agent.js";
import type { MessageBus } from "../bus/message-bus.js";
import { createTools } from "../tools/tool-factory.js";

export interface WorkerDependencies {
  bus: MessageBus;
  projectId: string | null;
  parentId: string;
  registryEntryId: string;
  modelPackId?: string | null;
  gearConfig?: GearConfig | null;
  model: string;
  provider: string;
  systemPrompt: string;
  workspacePath: string | null;
  toolNames: string[];
  onStatusChange?: (agentId: string, status: AgentStatus) => void;
}

export class Worker extends BaseAgent {
  private toolNames: string[];
  private workspacePath: string | null;

  constructor(deps: WorkerDependencies) {
    const options: AgentOptions = {
      role: AgentRole.Worker,
      parentId: deps.parentId,
      projectId: deps.projectId,
      registryEntryId: deps.registryEntryId,
      modelPackId: deps.modelPackId,
      gearConfig: deps.gearConfig,
      model: deps.model,
      provider: deps.provider,
      systemPrompt: deps.systemPrompt,
      workspacePath: deps.workspacePath,
      onStatusChange: deps.onStatusChange,
    };
    super(options, deps.bus);
    this.toolNames = deps.toolNames;
    this.workspacePath = deps.workspacePath;
  }

  async handleMessage(message: BusMessage): Promise<void> {
    if (message.type === MessageType.Directive) {
      await this.handleTask(message);
    } else if (message.type === MessageType.StatusRequest) {
      this.sendMessage(
        message.fromAgentId,
        MessageType.StatusResponse,
        this.getStatusSummary(),
        undefined,
        undefined,
        message.correlationId,
      );
    }
  }

  override getStatusSummary(): string {
    return `Worker ${this.id} [${this.status}]`;
  }

  protected getTools(): Record<string, unknown> {
    if (!this.workspacePath || !this.projectId || this.toolNames.length === 0) {
      return {};
    }

    return createTools(this.toolNames, {
      workspacePath: this.workspacePath,
      projectId: this.projectId,
      agentId: this.id,
      role: AgentRole.Worker,
    });
  }

  private async handleTask(message: BusMessage) {
    const { text } = await this.think(message.content);

    // Report results back to Team Lead
    if (this.parentId) {
      this.sendMessage(this.parentId, MessageType.Report, text);
    }

    // Worker is a one-shot agent — mark as done after completing the task
    this.setStatus(AgentStatus.Done);
  }
}

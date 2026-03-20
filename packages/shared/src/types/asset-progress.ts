/** Emitted via Socket.IO when asset generation is in progress. */
export interface AssetProgressEvent {
  type: "image" | "model" | "sound";
  promptId: string;
  step: number;
  totalSteps: number;
  percentage: number;
  stage: string;
  toolCallId?: string;
}

/** Emitted via Socket.IO when asset generation completes. */
export interface AssetCompleteEvent {
  type: "image" | "model" | "sound";
  promptId: string;
  toolCallId?: string;
}

/** Emitted via Socket.IO when asset generation fails. */
export interface AssetErrorEvent {
  type: "image" | "model" | "sound";
  promptId: string;
  error: string;
  toolCallId?: string;
}

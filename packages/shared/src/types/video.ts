export type VideoStatus = "draft" | "scripting" | "recording" | "compositing" | "complete" | "failed";
export type VideoAspectRatio = "16:9" | "9:16" | "1:1";
export type VideoTransition = "fade" | "dissolve" | "cut" | "slide-left";

export interface VideoManifest {
  id: string;
  name: string;
  description: string;
  aspectRatio: VideoAspectRatio;
  resolution: "720p" | "1080p";
  duration?: number;
  outputPath?: string;
  scenes: VideoScene[];
  status: VideoStatus;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export type VideoScene = SlideScene | ScreenRecordScene | TitleScene;

export interface SlideScene {
  type: "slide";
  id: string;
  imagePath: string;
  narration?: string;
  narrationAudioPath?: string;
  duration?: number;
  transition?: VideoTransition;
  textOverlay?: string;
}

export interface ScreenRecordScene {
  type: "screen-record";
  id: string;
  url: string;
  narration?: string;
  narrationAudioPath?: string;
  duration?: number;
  transition?: VideoTransition;
  videoClipPath?: string;
}

export interface TitleScene {
  type: "title";
  id: string;
  text: string;
  subtitle?: string;
  backgroundColor?: string;
  duration?: number;
  narration?: string;
  narrationAudioPath?: string;
  transition?: VideoTransition;
}

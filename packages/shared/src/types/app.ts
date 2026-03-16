export type AppFramework = "html" | "react" | "nextjs" | "astro" | "vue" | "custom";
export type AppStatus = "draft" | "building" | "preview" | "testing" | "deployed";

export interface AppManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  framework: AppFramework;
  entryPoint: string;
  buildCommand?: string;
  devCommand?: string;
  outputDir?: string;
  thumbnail?: string;
  tags: string[];
  status: AppStatus;
  projectId: string;
  deployUrl?: string;
  testResults?: AppTestResult[];
  createdAt: string;
  updatedAt: string;
}

export interface AppTestResult {
  id: string;
  timestamp: string;
  viewport: string;
  screenshotPath?: string;
  accessibilityIssues: number;
  performanceScore?: number;
}

export interface AppTemplate {
  id: string;
  framework: AppFramework;
  name: string;
  description: string;
  files: string[];
}

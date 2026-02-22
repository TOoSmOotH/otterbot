export interface CustomToolParameter {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description: string;
}

export interface CustomTool {
  id: string;
  name: string;
  description: string;
  parameters: CustomToolParameter[];
  code: string;
  timeout: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomToolCreate {
  name: string;
  description: string;
  parameters: CustomToolParameter[];
  code: string;
  timeout?: number;
}

export interface CustomToolUpdate {
  name?: string;
  description?: string;
  parameters?: CustomToolParameter[];
  code?: string;
  timeout?: number;
}

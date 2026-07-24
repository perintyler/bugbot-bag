import { z } from "zod";

export interface ToolContext {
  secrets: Record<string, string>;
}

export interface ToolDefinition<T extends z.ZodRawShape = z.ZodRawShape> {
  namespace: string;
  access: "read" | "write";
  name: string;
  description: string;
  schema: T;
  secrets?: string[];
  deferred?: boolean;
  handler: (params: z.infer<z.ZodObject<T>>, context?: ToolContext) => Promise<unknown>;
}

export function defineTool<T extends z.ZodRawShape>(definition: ToolDefinition<T>): ToolDefinition<T> {
  return definition;
}

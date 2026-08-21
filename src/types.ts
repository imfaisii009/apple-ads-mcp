/** Shared tool descriptor (generated/tools.json entries). */
export type GeneratedTool = {
  name: string;
  operationId: string;
  method: string;
  path: string;
  tags: string[];
  description: string;
  deprecated?: boolean;
  inputSchema: Record<string, unknown>;
  pathParams: string[];
  queryParams: string[];
  headerParams: string[];
  hasBody: boolean;
  bodyRequired: boolean;
  contentType?: string;
  accept?: string;
};

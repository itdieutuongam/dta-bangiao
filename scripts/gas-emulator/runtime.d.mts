// Khai báo type cho bộ giả lập Apps Script (chỉ dùng trong test).
export interface GasRuntime {
  context: Record<string, any>;
  spreadsheet: any;
  drive: any;
  cache: any;
  properties: Record<string, string>;
  lockState: { locked: boolean };
  logs: Array<{ level: string; line: string }>;
  faults: { set(target: 'sheets' | 'drive', count?: number): void };
  ui: {
    responses: Array<string | null>;
    alerts: Array<{ title: string; text: string }>;
    prompts: Array<{ title: string; text: string }>;
  } | null;
  readonly lastPdfHtml: string;
  run(name: string, ...args: unknown[]): any;
  doPost(body: string): string;
  doGet(): string;
  sheet(name: string): any;
}

export function createGasRuntime(options: {
  scriptDir: string;
  properties?: Record<string, string>;
  bound?: boolean;
  quiet?: boolean;
  ui?: { responses?: Array<string | null> };
}): GasRuntime;

export function signGasRequest(
  secret: string,
  action: string,
  payload: unknown,
  scope?: string,
  overrides?: { ts?: string; requestId?: string; sig?: string },
): string;

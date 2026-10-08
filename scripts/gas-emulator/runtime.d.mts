// Khai báo type cho bộ giả lập Apps Script (chỉ dùng trong test / chạy thử cục bộ).

/** Email MailApp "đã gửi" (giả lập — không gửi thật). */
export interface EmulatedMail {
  to: string;
  subject: string;
  body: string;
  htmlBody: string;
  name: string;
  at: string;
}

export interface GasRuntime {
  context: Record<string, any>;
  spreadsheet: any;
  drive: any;
  cache: any;
  properties: Record<string, string>;
  lockState: { locked: boolean };
  logs: Array<{ level: string; line: string }>;
  faults: { set(target: 'sheets' | 'drive' | 'mail' | 'flush', count?: number): void };
  ui: {
    responses: Array<string | null>;
    alerts: Array<{ title: string; text: string }>;
    prompts: Array<{ title: string; text: string }>;
  } | null;
  /** Thư đã gửi, mới nhất ở cuối. */
  mail: EmulatedMail[];
  /** Hạn mức gửi còn lại trong ngày (MailApp.getRemainingDailyQuota). */
  mailState: { quota: number };
  triggers: Array<{ getHandlerFunction(): string }>;
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
  mailQuota?: number;
  onMail?: (mail: EmulatedMail) => void;
}): GasRuntime;

export function signGasRequest(
  secret: string,
  action: string,
  payload: unknown,
  scope?: string,
  overrides?: { ts?: string; requestId?: string; sig?: string },
): string;

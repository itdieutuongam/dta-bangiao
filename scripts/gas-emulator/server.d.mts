import type { EmulatedMail, GasRuntime } from './runtime.mjs';

export function startGasEmulator(options: {
  port?: number;
  host?: string;
  secret: string;
  seed?: boolean;
  vpp?: boolean;
  quiet?: boolean;
  redirect?: boolean;
  settings?: Record<string, string>;
  onMail?: (mail: EmulatedMail) => void;
}): Promise<{ runtime: GasRuntime; port: number; url: string; close: () => Promise<void> }>;

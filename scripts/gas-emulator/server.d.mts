import type { GasRuntime } from './runtime.mjs';

export function startGasEmulator(options: {
  port?: number;
  host?: string;
  secret: string;
  seed?: boolean;
  quiet?: boolean;
  redirect?: boolean;
}): Promise<{ runtime: GasRuntime; port: number; url: string; close: () => Promise<void> }>;

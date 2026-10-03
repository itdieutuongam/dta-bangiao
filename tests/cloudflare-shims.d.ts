// Shim tối thiểu cho các type của Cloudflare Workers runtime, để test (chạy trên Node)
// import được code trong worker/. Không ảnh hưởng tới typecheck của Worker thật.
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
type Fetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
interface ExportedHandler<Env = unknown> {
  fetch?: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>;
}

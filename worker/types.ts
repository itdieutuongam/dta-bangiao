/**
 * Bindings & biến môi trường của Worker.
 * - Biến không bí mật: wrangler.jsonc → "vars".
 * - Biến bí mật: `npx wrangler secret put <TÊN>` (production) hoặc .dev.vars (local).
 */
export interface Env {
  ASSETS: Fetcher;
  RL_PUBLIC?: RateLimit;
  RL_WRITE?: RateLimit;
  RL_AUTH?: RateLimit;
  /** Đăng nhập quản trị theo tên đăng nhập (đếm chung mọi IP) — giới hạn cao hơn RL_AUTH. */
  RL_AUTH_ACCOUNT?: RateLimit;
  APP_BASE_URL?: string;
  GAS_WEB_APP_URL?: string;
  GAS_SHARED_SECRET?: string;
  /** Mật khẩu quản trị dùng chung (bản cũ). Bỏ qua khi có ADMIN_USERS. */
  ADMIN_PASSWORD?: string;
  /** Tài khoản quản trị (JSON): [{"username":"…","name":"…","password":"…"}] — xem worker/auth/adminUsers.ts. */
  ADMIN_USERS?: string;
  SESSION_SECRET?: string;
  /** Mã truy cập nội bộ cho trang đề xuất văn phòng phẩm (/de-xuat-vpp). */
  STAFF_ACCESS_CODE?: string;
  /**
   * Khóa niêm phong biên bản đã ký (≥ 32 ký tự ngẫu nhiên, KHÔNG đổi sau khi đã dùng) — xem worker/services/seal.ts.
   * Không đặt: biên bản đã ký chỉ được bảo vệ bằng mã băm thường.
   */
  RECORD_SEAL_SECRET?: string;
}

export interface RequestContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
  params: Record<string, string>;
  clientIp: string;
  requestId: string;
}

export type RouteHandler = (c: RequestContext) => Promise<Response>;

import { staffLoginSchema } from '../../shared/schemas';
import type { StaffSessionInfo } from '../../shared/types';
import { createSessionCookie, readSession } from '../auth/session';
import { enforceRateLimit } from '../services/rateLimit';
import type { RequestContext } from '../types';
import { secretEquals, sleep } from '../utils/crypto';
import { ApiError, ok } from '../utils/http';
import { logEvent } from '../utils/log';
import { assertSameOrigin, parseOrThrow, readJson } from '../utils/request';

/** GET /api/staff/session — trang tạo bàn giao có yêu cầu mã truy cập nội bộ không? */
export async function staffSessionHandler(c: RequestContext): Promise<Response> {
  const required = Boolean(c.env.STAFF_ACCESS_CODE?.trim());
  const authenticated =
    !required || Boolean(await readSession(c, 'staff')) || Boolean(await readSession(c, 'admin'));
  const body: StaffSessionInfo = { required, authenticated };
  return ok(body);
}

/** POST /api/staff/login — nhập mã truy cập nội bộ (STAFF_ACCESS_CODE). */
export async function staffLoginHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_AUTH', 'staff-login');
  assertSameOrigin(c);
  const expected = c.env.STAFF_ACCESS_CODE?.trim();
  if (!expected) {
    const body: StaffSessionInfo = { required: false, authenticated: true };
    return ok(body);
  }
  const { code } = parseOrThrow(staffLoginSchema, await readJson(c.request, 4 * 1024));
  if (!(await secretEquals(code.trim(), expected))) {
    await sleep(400);
    logEvent('warn', c, 'staff.login_failed');
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Mã truy cập không đúng.');
  }
  const session = await createSessionCookie(c, 'staff');
  const body: StaffSessionInfo = { required: true, authenticated: true };
  return ok(body, 200, { 'Set-Cookie': session.cookie });
}

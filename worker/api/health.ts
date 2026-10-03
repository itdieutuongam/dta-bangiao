import { APP_ID } from '../../shared/constants';
import type { HealthData } from '../../shared/types';
import { callGas } from '../services/gas';
import { getCached } from '../services/memoryCache';
import { enforceRateLimit } from '../services/rateLimit';
import type { RequestContext } from '../types';
import { json, ok } from '../utils/http';
import { logError } from '../utils/log';

interface GasHealth {
  database: string;
  drive: string;
}

/** GET /api/health — kiểm tra Worker, Apps Script, Google Sheet, Drive. Không trả về bất kỳ secret nào. */
export async function healthHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_PUBLIC', 'health');
  const env = c.env;
  const configured = {
    appsScript: Boolean(env.GAS_WEB_APP_URL?.trim() && env.GAS_SHARED_SECRET?.trim()),
    session: Boolean(env.SESSION_SECRET?.trim()),
    admin: Boolean(env.ADMIN_PASSWORD?.trim()),
    staffAccessCode: Boolean(env.STAFF_ACCESS_CODE?.trim()),
  };
  const data: HealthData = {
    app: APP_ID,
    cloudflare: 'ok',
    appsScript: 'not_configured',
    database: 'unknown',
    drive: 'unknown',
    configured,
    time: new Date().toISOString(),
  };

  if (configured.appsScript) {
    try {
      const gas = await getCached('health', 15_000, () =>
        callGas<GasHealth>(env, 'health', {}, { scope: 'public', timeoutMs: 20_000 }),
      );
      data.appsScript = 'ok';
      data.database = gas.database === 'ok' ? 'ok' : 'error';
      data.drive = gas.drive === 'ok' ? 'ok' : 'error';
    } catch (err) {
      data.appsScript = 'error';
      logError(c, 'health.gas_failed', err);
    }
  }

  const healthy = data.appsScript === 'ok' && data.database === 'ok' && data.drive === 'ok' && configured.session;
  if (healthy) return ok(data);
  return json(
    {
      success: false,
      data,
      error: { code: 'DEGRADED', message: 'Một số thành phần hệ thống chưa sẵn sàng hoặc chưa cấu hình.' },
    },
    503,
  );
}

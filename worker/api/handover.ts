import { confirmSchema, handoverInputSchema, revisionSchema } from '../../shared/schemas';
import type { CreateHandoverResult, PublicHandover, PublicHandoverResponse, ReceiverInfo } from '../../shared/types';
import type { HandoverStatus } from '../../shared/constants';
import { requireStaff } from '../auth/guards';
import { callGas } from '../services/gas';
import { enforceRateLimit } from '../services/rateLimit';
import { decodeSignatureDataUrl } from '../services/signature';
import { buildConfirmLink, hashToken, issueLinkToken } from '../services/token';
import type { RequestContext } from '../types';
import { ok } from '../utils/http';
import { logError, logEvent } from '../utils/log';
import { assertSameOrigin, parseOrThrow, readJson } from '../utils/request';
import { clientInfo, gasFileResponse, requireToken, type GasFile } from './common';

interface GasCreateResult {
  id: string;
  code: string;
  status: HandoverStatus;
  createdAt: string;
  receiver: ReceiverInfo;
}

interface GasPublicMutationResult {
  id: string;
  handover: PublicHandover;
}

/** POST /api/handover — tạo biên bản + sinh link xác nhận. */
export async function createHandoverHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_WRITE', 'create');
  assertSameOrigin(c);
  await requireStaff(c);
  const input = parseOrThrow(handoverInputSchema, await readJson(c.request, 256 * 1024));
  const link = await issueLinkToken(c.env);
  const result = await callGas<GasCreateResult>(
    c.env,
    'createHandover',
    { ...input, tokenHash: link.hash, tokenNonce: link.nonce, client: await clientInfo(c) },
    { scope: 'public', timeoutMs: 45_000 },
  );
  logEvent('info', c, 'handover.created', { code: result.code, items: input.items.length });
  const body: CreateHandoverResult = { ...result, link: buildConfirmLink(c.env, c.url, link.token) };
  return ok(body, 201);
}

/** GET /api/handover/:token — nội dung biên bản cho người nhận. */
export async function getPublicHandoverHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_PUBLIC', 'view');
  const token = requireToken(c);
  const data = await callGas<PublicHandoverResponse>(
    c.env,
    'getHandoverByToken',
    { tokenHash: await hashToken(token), client: await clientInfo(c) },
    { scope: 'public', retries: 1 },
  );
  return ok(data);
}

/** POST /api/handover/:token/confirm — người nhận ký xác nhận. */
export async function confirmHandoverHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_WRITE', 'confirm');
  assertSameOrigin(c);
  const token = requireToken(c);
  const input = parseOrThrow(confirmSchema, await readJson(c.request, 640 * 1024));
  const signature = decodeSignatureDataUrl(input.signature);
  const result = await callGas<GasPublicMutationResult>(
    c.env,
    'confirmHandover',
    {
      tokenHash: await hashToken(token),
      agreed: true,
      signatureBase64: signature.base64,
      comment: input.comment,
      client: await clientInfo(c),
    },
    { scope: 'public', timeoutMs: 60_000 },
  );
  logEvent('info', c, 'handover.confirmed', { code: result.handover.code, signatureBytes: signature.byteLength });

  // Sinh PDF nền sau khi đã trả kết quả cho người nhận; nếu lỗi, endpoint tải PDF sẽ tự sinh lại.
  c.ctx.waitUntil(
    callGas(c.env, 'generatePdf', { id: result.id }, { scope: 'system', timeoutMs: 120_000 }).catch((err) =>
      logError(c, 'handover.pdf_background_failed', err, { code: result.handover.code }),
    ),
  );
  return ok({ handover: result.handover });
}

/** POST /api/handover/:token/request-revision — người nhận yêu cầu chỉnh sửa. */
export async function requestRevisionHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_WRITE', 'revision');
  assertSameOrigin(c);
  const token = requireToken(c);
  const input = parseOrThrow(revisionSchema, await readJson(c.request, 16 * 1024));
  const result = await callGas<GasPublicMutationResult>(
    c.env,
    'requestRevision',
    { tokenHash: await hashToken(token), reason: input.reason, client: await clientInfo(c) },
    { scope: 'public', timeoutMs: 45_000 },
  );
  logEvent('info', c, 'handover.revision_requested', { code: result.handover.code });
  return ok({ handover: result.handover });
}

/** GET /api/handover/:token/pdf — người nhận tải PDF biên bản đã xác nhận. */
export async function downloadPublicPdfHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_WRITE', 'pdf');
  const token = requireToken(c);
  const file = await callGas<GasFile>(
    c.env,
    'getPdfByToken',
    { tokenHash: await hashToken(token), client: await clientInfo(c) },
    { scope: 'public', timeoutMs: 120_000 },
  );
  return gasFileResponse(file, 'attachment');
}

import { confirmSchema, revisionSchema } from '../../shared/schemas';
import type { OtpRequestResult, PublicHandover, PublicHandoverResponse } from '../../shared/types';
import { callGas } from '../services/gas';
import { enforceRateLimit } from '../services/rateLimit';
import { withSealKey } from '../services/seal';
import { decodeSignatureDataUrl } from '../services/signature';
import { hashToken } from '../services/token';
import type { RequestContext } from '../types';
import { ok } from '../utils/http';
import { logError, logEvent } from '../utils/log';
import { assertSameOrigin, parseOrThrow, readJson } from '../utils/request';
import { clientInfo, gasFileResponse, requireToken, type GasFile } from './common';

/**
 * API công khai của NGƯỜI NHẬN (link /xac-nhan/:token). Tạo phiếu là thao tác của quản trị viên
 * (POST /api/admin/handovers) — không còn API tạo phiếu công khai.
 */

interface GasPublicMutationResult {
  id: string;
  handover: PublicHandover;
}

/** ctx.waitUntil chỉ giữ Worker sống thêm ~30 giây sau khi trả response — tác vụ nền phải kết thúc trước đó. */
export const BACKGROUND_PDF_TIMEOUT_MS = 25_000;

/** GET /api/handover/:token — nội dung biên bản cho người nhận (kèm contentHash của nội dung đang xem). */
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

/**
 * POST /api/handover/:token/otp — gửi mã xác nhận 6 số tới email người nhận (khi CAU_HINH.CONFIRM_OTP yêu cầu).
 * Apps Script giới hạn: gửi lại sau 60 giây, tối đa 3 lần / 15 phút; mã hết hạn sau 10 phút, sai tối đa 5 lần.
 */
export async function requestConfirmOtpHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_WRITE', 'otp');
  assertSameOrigin(c);
  const token = requireToken(c);
  const result = await callGas<OtpRequestResult>(
    c.env,
    'requestConfirmOtp',
    { tokenHash: await hashToken(token), client: await clientInfo(c) },
    { scope: 'public', timeoutMs: 45_000 },
  );
  logEvent('info', c, 'handover.otp_sent', {});
  return ok(result);
}

/**
 * POST /api/handover/:token/confirm — người nhận ký xác nhận.
 * contentHash phải khớp nội dung hiện tại: nếu admin vừa sửa phiếu, Apps Script trả 409 CONFLICT và trang tải lại.
 * otp: mã gửi qua email (Apps Script kiểm tra khi phiếu yêu cầu; sai → 422 OTP_INVALID / OTP_EXPIRED, quá 5 lần → 429 OTP_LOCKED).
 */
export async function confirmHandoverHandler(c: RequestContext): Promise<Response> {
  await enforceRateLimit(c, 'RL_WRITE', 'confirm');
  assertSameOrigin(c);
  const token = requireToken(c);
  const input = parseOrThrow(confirmSchema, await readJson(c.request, 640 * 1024));
  const signature = decodeSignatureDataUrl(input.signature);
  // sealKey: Apps Script niêm phong biên bản ngay lúc ký (record_seal) bằng khóa không lưu ở Google.
  const result = await callGas<GasPublicMutationResult>(
    c.env,
    'confirmHandover',
    await withSealKey(c.env, {
      tokenHash: await hashToken(token),
      agreed: true,
      contentHash: input.contentHash,
      signatureBase64: signature.base64,
      comment: input.comment,
      otp: input.otp,
      client: await clientInfo(c),
    }),
    { scope: 'public', timeoutMs: 60_000 },
  );
  logEvent('info', c, 'handover.confirmed', { code: result.handover.code, signatureBytes: signature.byteLength });

  // Sinh PDF nền sau khi đã trả kết quả. waitUntil chỉ kéo dài ~30 giây sau response → timeout 25 giây;
  // nếu quá thời gian, Apps Script vẫn chạy tiếp và endpoint tải PDF sẽ tự sinh lại nếu còn thiếu.
  const pdfPayload = await withSealKey(c.env, { id: result.id });
  c.ctx.waitUntil(
    callGas(c.env, 'generatePdf', pdfPayload, { scope: 'system', timeoutMs: BACKGROUND_PDF_TIMEOUT_MS }).catch((err) =>
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
    { tokenHash: await hashToken(token), contentHash: input.contentHash, reason: input.reason, client: await clientInfo(c) },
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
    await withSealKey(c.env, { tokenHash: await hashToken(token), client: await clientInfo(c) }),
    { scope: 'public', timeoutMs: 120_000 },
  );
  return gasFileResponse(file, 'attachment', 'pdf');
}

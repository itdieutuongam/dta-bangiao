/**
 * Security.gs — xác thực request từ Cloudflare Worker.
 *
 * Body JSON do Worker gửi:
 *   { v: 1, action, scope, ts, requestId, payload: "<chuỗi JSON>", sig }
 * Chữ ký:
 *   sig = hex(HMAC_SHA256(BACKEND_SHARED_SECRET,
 *              "v1\n" + action + "\n" + scope + "\n" + ts + "\n" + requestId + "\n" + payload))
 *
 * Từ chối khi: sai chữ ký · lệch thời gian > 5 phút · requestId đã dùng (chống replay).
 * Apps Script Web App không đọc được HTTP header nên toàn bộ thông tin xác thực nằm trong body.
 */

function getSharedSecret_() {
  return getProp_(PROP.SHARED_SECRET);
}

function hmacHex_(message, secret) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(message, secret, Utilities.Charset.UTF_8));
}

function sha256Hex_(text) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

/** So sánh thời gian hằng (tránh lộ thông tin qua thời gian phản hồi). */
function timingSafeEqual_(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function verifyRequest_(raw) {
  var envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (e) {
    throw appError_('BAD_REQUEST', 'Body không phải JSON hợp lệ.');
  }
  if (!envelope || envelope.v !== 1) throw appError_('BAD_REQUEST', 'Phiên bản giao thức không hợp lệ.');

  var action = envelope.action;
  var scope = envelope.scope;
  var ts = envelope.ts;
  var requestId = envelope.requestId;
  var payload = envelope.payload;
  var sig = envelope.sig;
  if (typeof action !== 'string' || !/^[A-Za-z]{1,40}$/.test(action)) throw appError_('BAD_REQUEST', 'Thiếu action.');
  if (scope !== 'public' && scope !== 'admin' && scope !== 'system') throw appError_('BAD_REQUEST', 'Scope không hợp lệ.');
  if (typeof ts !== 'string' || !/^\d{10,16}$/.test(ts)) throw appError_('BAD_REQUEST', 'Timestamp không hợp lệ.');
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(requestId)) throw appError_('BAD_REQUEST', 'requestId không hợp lệ.');
  if (typeof payload !== 'string') throw appError_('BAD_REQUEST', 'Payload không hợp lệ.');
  if (typeof sig !== 'string' || !/^[0-9a-fA-F]{64}$/.test(sig)) throw appError_('UNAUTHORIZED', 'Thiếu chữ ký request.');

  var secret = getSharedSecret_();
  if (!secret) throw appError_('NOT_CONFIGURED', 'Chưa cấu hình BACKEND_SHARED_SECRET trong Script Properties.');

  if (!(Math.abs(Date.now() - Number(ts)) <= APP.REQUEST_MAX_SKEW_MS)) {
    throw appError_('UNAUTHORIZED', 'Request đã hết hạn hoặc đồng hồ lệch quá 5 phút.');
  }

  var base = ['v1', action, scope, ts, requestId, payload].join('\n');
  if (!timingSafeEqual_(hmacHex_(base, secret), sig.toLowerCase())) {
    throw appError_('UNAUTHORIZED', 'Chữ ký request không hợp lệ.');
  }

  var cache = CacheService.getScriptCache();
  var replayKey = 'rq:' + requestId;
  if (cache.get(replayKey)) throw appError_('UNAUTHORIZED', 'Request đã được xử lý trước đó (replay).');
  cache.put(replayKey, '1', APP.REPLAY_TTL_SECONDS);

  var data;
  try {
    data = payload ? JSON.parse(payload) : {};
  } catch (e) {
    throw appError_('BAD_REQUEST', 'Payload không phải JSON hợp lệ.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw appError_('BAD_REQUEST', 'Payload phải là object.');
  return { action: action, scope: scope, requestId: requestId, payload: data };
}

/**
 * Giới hạn tần suất đơn giản bằng CacheService (lớp bảo vệ thứ 2 sau Cloudflare Rate Limiting).
 * Trả về false nếu vượt giới hạn.
 */
function rateLimitHit_(bucket, key, limit, windowSeconds) {
  if (!key) return true;
  var cache = CacheService.getScriptCache();
  var cacheKey = 'rl:' + bucket + ':' + String(key).slice(0, 64);
  var current = parseInt(cache.get(cacheKey) || '0', 10) || 0;
  if (current >= limit) return false;
  cache.put(cacheKey, String(current + 1), windowSeconds);
  return true;
}

function enforceRateLimit_(bucket, key, limit, windowSeconds) {
  if (!rateLimitHit_(bucket, key, limit, windowSeconds)) {
    throw appError_('RATE_LIMITED', 'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau ít phút.');
  }
}

/** Đếm số lần tra cứu link sai theo IP (đã hash) — chặn dò token. */
function isLookupBlocked_(ipHash) {
  if (!ipHash) return false;
  var n = parseInt(CacheService.getScriptCache().get('rl:miss:' + ipHash) || '0', 10) || 0;
  return n >= 30;
}

function registerLookupMiss_(ipHash) {
  if (!ipHash) return;
  var cache = CacheService.getScriptCache();
  var key = 'rl:miss:' + ipHash;
  var n = parseInt(cache.get(key) || '0', 10) || 0;
  cache.put(key, String(n + 1), 600);
}

/** Thông tin client do Worker gửi (IP đã hash, user-agent) — làm sạch trước khi lưu. */
function sanitizeClient_(client) {
  client = client || {};
  var ipHash = String(client.ipHash || '');
  return {
    ipHash: /^[0-9a-f]{16,64}$/.test(ipHash) ? ipHash : '',
    userAgent: truncate_(cleanLine_(client.userAgent), 300)
  };
}

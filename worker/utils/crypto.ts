// Web Crypto helpers — chạy được trên Workers runtime và Node (tests).

const encoder = new TextEncoder();

/** Byte array có buffer là ArrayBuffer thường (yêu cầu của Web Crypto / Response body). */
export type Bytes = Uint8Array<ArrayBuffer>;

export function utf8(text: string): Bytes {
  // TextEncoder luôn trả về buffer thường (không phải SharedArrayBuffer).
  return encoder.encode(text) as Bytes;
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (const b of view) out += b.toString(16).padStart(2, '0');
  return out;
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64Decode(base64: string): Bytes {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Bytes {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64Decode(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

export function randomBytes(length: number): Bytes {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', utf8(text)));
}

export async function hmacSha256(key: string | Bytes, data: string): Promise<Bytes> {
  const keyBytes = typeof key === 'string' ? utf8(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, utf8(data)));
}

export async function hmacSha256Hex(key: string | Bytes, data: string): Promise<string> {
  return toHex(await hmacSha256(key, data));
}

/** So sánh thời gian hằng cho 2 chuỗi cùng độ dài (độ dài khác → false). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * So sánh mật khẩu/mã truy cập không lộ độ dài hay vị trí sai:
 * HMAC cả hai với khóa ngẫu nhiên rồi so sánh digest cố định 32 bytes.
 */
export async function secretEquals(input: string, expected: string): Promise<boolean> {
  const key = randomBytes(32);
  const [a, b] = await Promise.all([hmacSha256(key, input), hmacSha256(key, expected)]);
  return timingSafeEqualBytes(a, b);
}

/**
 * JSON chỉ gồm ký tự ASCII (ký tự ngoài ASCII → \uXXXX).
 * Đảm bảo chuỗi được ký HMAC giống hệt nhau ở Worker và Apps Script bất kể charset.
 */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

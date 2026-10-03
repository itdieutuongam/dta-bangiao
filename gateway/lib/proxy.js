// Chuyển nguyên request (giữ tên miền gốc, cookie, IP người dùng) sang Worker dta-bangiao qua Service Binding.
// Worker xử lý cả giao diện (static assets, SPA) lẫn API /api/*.

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

export async function proxyToApp({ request, env }) {
  if (!env.APP) {
    return new Response('Cấu hình thiếu Service Binding "APP" → Worker "dta-bangiao".', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const response = await env.APP.fetch(request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

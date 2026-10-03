// Mọi đường dẫn (/xac-nhan/…, /admin, /api/…) → Worker dta-bangiao.
import { proxyToApp } from '../lib/proxy.js';

export const onRequest = proxyToApp;

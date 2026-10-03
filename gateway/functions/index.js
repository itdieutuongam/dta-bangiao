// Trang gốc "/" → Worker dta-bangiao.
import { proxyToApp } from '../lib/proxy.js';

export const onRequest = proxyToApp;

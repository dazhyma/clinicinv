import type { NextConfig } from 'next';
import { BASE_PATH } from './src/base-path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * Развёртывание по адресу https://dazhyma.tech/clinic (D-51).
   * Значение берётся из src/base-path.ts, чтобы конфигурация сборки и код,
   * который вручную дописывает префикс, не могли разойтись.
   */
  basePath: BASE_PATH,
  // Native modules must stay outside the bundler: better-sqlite3 (.node binding),
  // @node-rs/argon2 (.node binding), sharp (rasterisation of generated barcodes).
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2', 'sharp'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        // §15 / NFR-18: nothing in this system is public or cacheable by shared caches.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          /**
           * §15 / NFR-11, NFR-13: система работает только по HTTPS (за Caddy).
           * Заголовок обязателен, чтобы браузер не отправил cookie сессии по
           * http:// после первого визита. Content-Security-Policy здесь НЕТ:
           * он выдаётся middleware с одноразовым nonce (D-53).
           */
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;

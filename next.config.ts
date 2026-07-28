import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native modules must stay outside the bundler: better-sqlite3 (.node binding),
  // @node-rs/argon2 (.node binding), sharp (used for photo downscaling in a later sprint).
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
        ],
      },
    ];
  },
};

export default nextConfig;

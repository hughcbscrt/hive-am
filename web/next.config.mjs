/** @type {import('next').NextConfig} */
const API = process.env.HIVE_AM_API ?? 'http://127.0.0.1:4400';
export default {
  reactStrictMode: true,
  // Lets a second dev server (tests, previews) run next to yours without sharing build output.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // The section used to be called Objects: old links and bookmarks still arrive.
  async redirects() {
    return [{ source: '/objects', destination: '/resources', permanent: false }, { source: '/objects/:id', destination: '/resources/:id', permanent: false }];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};

import { readFileSync } from 'node:fs';

/** @type {import('next').NextConfig} */
const API = process.env.HIVE_AM_API ?? 'http://127.0.0.1:4400';
// The version shown in the rail, baked in at build time. The published package has no web/package.json, but there the UI is already built.
const VERSION = (() => { try { return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? ''; } catch { return ''; } })();
export default {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_HIVE_AM_VERSION: VERSION },
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

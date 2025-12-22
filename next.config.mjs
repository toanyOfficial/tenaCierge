/** @type {import('next').NextConfig} */
const gitSha =
  process.env.NEXT_PUBLIC_GIT_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GIT_COMMIT_SHA ??
  null;

const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? new Date().toISOString();

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true
  },
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_GIT_SHA: gitSha ?? 'env:missing',
    NEXT_PUBLIC_BUILD_TIME: buildTime
  },
  webpack: (config) => config
};

export default nextConfig;

import { execSync } from 'node:child_process';

/** @type {import('next').NextConfig} */
function resolveGitSha() {
  const envSha =
    process.env.NEXT_PUBLIC_GIT_SHA ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    process.env.COMMIT_REF ??
    process.env.GIT_COMMIT_SHA ??
    null;

  if (envSha) return envSha;

  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch (error) {
    return null;
  }
}

const gitSha = resolveGitSha();

const buildTime =
  process.env.NEXT_PUBLIC_BUILD_TIME ?? process.env.VERCEL_GIT_COMMIT_TIME ?? new Date().toISOString();

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true
  },
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_GIT_SHA: gitSha ?? 'env:missing',
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? gitSha ?? 'env:missing',
    NEXT_PUBLIC_GITHUB_SHA: process.env.GITHUB_SHA ?? gitSha ?? 'env:missing',
    NEXT_PUBLIC_BUILD_TIME: buildTime
  },
  webpack: (config) => config
};

export default nextConfig;

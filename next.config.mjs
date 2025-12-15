/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true
  },
  poweredByHeader: false,
  webpack: (config) => config
};

export default nextConfig;

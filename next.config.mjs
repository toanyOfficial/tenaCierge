/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true
  },
  poweredByHeader: false,
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'web-push': new URL('./vendor/web-push/index.js', import.meta.url).pathname
    };

    return config;
  }
};

export default nextConfig;

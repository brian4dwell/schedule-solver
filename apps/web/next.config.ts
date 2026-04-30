import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    const internalApiBaseUrl = process.env.INTERNAL_API_BASE_URL ?? "http://127.0.0.1:8000";
    const apiProxyTarget = `${internalApiBaseUrl}/:path*`;
    const apiRewrite = {
      source: "/api/:path*",
      destination: apiProxyTarget,
    };
    const rewrites = [apiRewrite];
    return rewrites;
  },
};

export default nextConfig;

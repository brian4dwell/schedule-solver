import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  async headers() {
    const serviceWorkerHeaders = [
      {
        key: "Content-Type",
        value: "application/javascript; charset=utf-8",
      },
      {
        key: "Cache-Control",
        value: "no-cache, no-store, must-revalidate",
      },
      {
        key: "Content-Security-Policy",
        value: "default-src 'self'; script-src 'self'",
      },
    ];
    const serviceWorkerHeaderRule = {
      source: "/sw.js",
      headers: serviceWorkerHeaders,
    };
    const headers = [serviceWorkerHeaderRule];
    return headers;
  },
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

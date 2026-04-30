import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    const apiProxyTarget = "http://127.0.0.1:8000/:path*";
    const apiRewrite = {
      source: "/api/:path*",
      destination: apiProxyTarget,
    };
    const rewrites = [apiRewrite];
    return rewrites;
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.PLAYWRIGHT_TEST === "1" ? ".cache/next-e2e" : ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ] }];
  },
};

export default nextConfig;

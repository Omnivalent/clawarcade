import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["e2b", "@prisma/client", "jszip"],
  poweredByHeader: false,
};

export default nextConfig;

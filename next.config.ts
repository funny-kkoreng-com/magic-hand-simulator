import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // funny.kkoreng.com/magic-hand-simulator 아래에서 서비스 (funny-kkoreng-com 프로젝트가 이 경로를 rewrite)
  basePath: "/magic-hand-simulator",
  // 루트(magic-hand-simulator.vercel.app/, localhost:3000/)로 들어오면 앱으로 보낸다
  async redirects() {
    return [
      {
        source: "/",
        destination: "/magic-hand-simulator",
        basePath: false,
        permanent: false,
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

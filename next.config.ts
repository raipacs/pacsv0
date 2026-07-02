import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  async rewrites() {
    return [
      {
        source: "/ohif-viewer",
        destination: "/ohif-viewer/index.html",
      },
      {
        source: "/ohif-viewer/viewer/:path*",
        destination: "/ohif-viewer/index.html",
      },
    ]
  },
}

export default nextConfig

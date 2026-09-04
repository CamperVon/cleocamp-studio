import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF route (lib/po-pdf.tsx) reads font files from disk at runtime via
  // fs, not a static import — Next's tracer can't see that, so without this
  // the font files never make it into the deployed function and the route
  // 500s in production while working fine locally. Found the hard way: a
  // first attempt fetched them over HTTP instead, which failed differently —
  // Vercel's own deployment-protection blocks a function from fetching its
  // own deployment URL, even server-to-server.
  outputFileTracingIncludes: {
    "/po/[poNumber]/pdf": ["./assets/fonts/*.ttf"],
  },
};

export default nextConfig;

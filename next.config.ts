import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: let phones on the local network (http://192.168.x.x:3000)
  // load Next.js dev resources, otherwise the page never hydrates there.
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;

import type { NextConfig } from "next";

// Allow next/image to load user/group uploads served off the backend's /storage,
// plus Google avatar URLs from OAuth sign-in. Local dev backends (127.0.0.1 /
// localhost:8000) are always allowed, plus whatever NEXT_PUBLIC_API_URL points
// at (a tunnel URL, a deployed api host, etc.).
// `port` is required (use "" for the protocol's default port): omitting it
// makes Next imply the `**` wildcard, allowing any port on that host.
type Pattern = {
  protocol: "http" | "https";
  hostname: string;
  port: string;
  pathname: string;
};

const patterns: Pattern[] = [
  { protocol: "http", hostname: "127.0.0.1", port: "8000", pathname: "/storage/**" },
  { protocol: "http", hostname: "localhost", port: "8000", pathname: "/storage/**" },
  { protocol: "https", hostname: "lh3.googleusercontent.com", port: "", pathname: "/**" },
];

// Also allow the configured API origin, if it's something other than local.
try {
  const api = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000");
  const host = api.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    patterns.push({
      protocol: api.protocol.replace(":", "") as "http" | "https",
      hostname: host,
      // URL.port is "" for a default-port URL, which is exactly what
      // remotePatterns wants. Omitting `port` entirely would imply the `**`
      // wildcard and allow ANY port on that host.
      port: api.port,
      pathname: "/storage/**",
    });
  }
} catch {
  /* invalid URL — the local defaults above still apply */
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: patterns,
    // Serve images directly instead of proxying through Next's optimizer. Our
    // uploads come from a self-hosted backend (a private/loopback IP in dev),
    // which the optimizer refuses to fetch ("resolved to private ip"). Uploads
    // are already appropriately sized, so optimization adds little here.
    unoptimized: true,
  },
};

export default nextConfig;

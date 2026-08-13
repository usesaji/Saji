import type { NextConfig } from "next";

// Allow next/image to load user/group uploads from the Cloudflare R2 public
// domain, plus Google avatar URLs from OAuth sign-in.
//
// `port` is required (use "" for the protocol's default port): omitting it
// makes Next imply the `**` wildcard, allowing any port on that host.
type Pattern = {
  protocol: "http" | "https";
  hostname: string;
  port: string;
  pathname: string;
};

const patterns: Pattern[] = [
  { protocol: "https", hostname: "lh3.googleusercontent.com", port: "", pathname: "/**" },
];

// The R2 public domain (a Connected Domain, or the r2.dev subdomain in dev).
// This is NOT the S3 endpoint — `<account>.r2.cloudflarestorage.com` requires a
// SigV4 signature on every request and will 401 the image optimizer.
try {
  const raw = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";
  const r2 = new URL(raw);
  const protocol = r2.protocol.replace(":", "");

  // `new URL()` accepts ANY scheme — "ttps://…" parses happily — so the
  // constructor is not the validation it looks like. Check the scheme
  // explicitly. Without this the bad value reached `remotePatterns`, where
  // Next's own config schema rejected it and killed the BUILD with
  // "Expected 'http' | 'https', received 'ttps'" — a message that names
  // neither the variable nor the deployment that set it. A dropped leading
  // character while copying a URL into a dashboard is an easy mistake; taking
  // down the build over it is not a proportionate response.
  if (protocol !== "http" && protocol !== "https") {
    console.warn(
      `[next.config] NEXT_PUBLIC_R2_PUBLIC_URL has protocol "${protocol}" ` +
        `(from "${raw}"). Expected http or https — check for a typo. ` +
        `Uploaded images will not render until this is fixed.`,
    );
  } else {
    patterns.push({
      protocol,
      hostname: r2.hostname,
      // URL.port is "" for a default-port URL, which is exactly what
      // remotePatterns wants. Omitting `port` entirely would imply the `**`
      // wildcard and allow ANY port on that host.
      port: r2.port,
      pathname: "/**",
    });
  }
} catch {
  /* unset or invalid — uploads simply won't render until it's configured */
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: patterns,
    // Optimization is ON. It was previously disabled because uploads were
    // served off a self-hosted backend on a private/loopback IP, which the
    // optimizer refuses to fetch ("resolved to private ip"). R2 serves from a
    // public domain, so that constraint is gone and avatars get properly
    // resized instead of shipping full-size originals to every dashboard.
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * What a page may load. Everything comes from this site; nothing is loaded
 * from anywhere else, so text written by a model or by a pull request's
 * author cannot pull in a script, an image that reports who opened the page,
 * or a request to another server, even if it got past the escaping.
 *
 * Scripts and styles allow 'unsafe-inline' because Next.js inlines its own
 * bootstrapping scripts and the theme is set by an inline script before
 * first paint. Removing that needs a per-request nonce, which would make
 * every page dynamic. Development also needs 'unsafe-eval' for fast refresh.
 *
 * form-action is left out on purpose: signing in submits a form whose
 * response redirects to github.com, and browsers apply form-action to that
 * redirect.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  // The app never needs to be shown inside another site's frame.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Review URLs contain ids; do not send them to other sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app uses none of these.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

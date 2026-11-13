import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const TITLE = "Second Look: first-pass review for AI-written pull requests";
const DESCRIPTION =
  "For the engineer who reviews code written with AI tools by people who are not engineers. The AI does the first pass, you confirm or reject each finding, and only confirmed findings reach the author.";

// Absolute base for the social card. Without it the generated image URL
// points at localhost and the card is broken wherever the link is pasted.
const SITE = process.env.APP_URL ?? "https://second-look-review.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

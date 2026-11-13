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

// Runs before the first paint, so the page never flashes the wrong theme.
// The reader's own choice wins; without one, the system setting decides.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The script above sets data-theme before React loads, so the attribute
    // differs from the server's HTML on purpose.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}

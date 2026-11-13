import { ImageResponse } from "next/og";

/** The card shown when a link to the site is shared. Built once at build time. */

export const alt = "Second Look: first-pass review for AI-written pull requests";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0f172a";
const SOFT = "#64748b";

function Row({ marker, text, tint }: { marker: string; text: string; tint: string }) {
  return (
    <div style={{ display: "flex", background: tint, padding: "6px 20px", fontSize: 24, fontFamily: "monospace", color: INK }}>
      <span style={{ width: 36, color: SOFT }}>{marker}</span>
      {text}
    </div>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#f8fafc", padding: 64, color: INK }}>
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>Second Look</div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 52, fontWeight: 700, lineHeight: 1.15, maxWidth: 1000 }}>
          The AI reads the pull request first. You still decide.
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 40, border: "2px solid #e2e8f0", borderRadius: 14, overflow: "hidden", background: "#ffffff" }}>
          <Row marker="-" text="migrationBuilder.RenameColumn(&quot;Phone&quot;, ...)" tint="#fef2f2" />
          <Row marker="+" text="migrationBuilder.DropColumn(&quot;Phone&quot;, &quot;Customers&quot;);" tint="#f0fdf4" />
          <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderTop: "2px solid #e2e8f0", fontSize: 24 }}>
            <span style={{ background: "#fef2f2", color: "#991b1b", border: "2px solid #fecaca", borderRadius: 6, padding: "2px 10px", fontWeight: 700, marginRight: 14 }}>
              CRITICAL
            </span>
            <span style={{ color: SOFT, marginRight: 14 }}>data-loss</span>
            Every existing phone number is deleted.
          </div>
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 26, color: SOFT }}>
          Confirm, reject, or rewrite each finding. Only what you confirm reaches the author.
        </div>
      </div>
    ),
    size,
  );
}

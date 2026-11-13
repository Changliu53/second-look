import type { Metadata } from "next";
import Link from "next/link";
import { REPO_URL, SiteHeader } from "@/components/site-header";
import { LINK, SECTION_LABEL } from "@/components/ui";

export const metadata: Metadata = {
  title: "What Second Look stores and sends",
  description: "Where your code goes during a review, what is kept, and what is not.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className={SECTION_LABEL}>{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

const LIST = "list-disc space-y-1 pl-5";

/**
 * Plain statement of where code goes and what is kept. Each line here is
 * true of the code in this repository; a change to what is stored or sent
 * must change this page too.
 */
export default function DataPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">What Second Look stores and sends</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          A review means sending code to an AI model. This page says what goes where. It
          describes this deployment as the code in{" "}
          <a className={LINK} href={REPO_URL}>
            the repository
          </a>{" "}
          is written; a team that runs its own copy can check every line of it.
        </p>

        <Section title="Sent to the model, for each review">
          <ul className={LIST}>
            <li>The pull request&apos;s diff, without lockfiles, generated files, and binaries.</li>
            <li>The full contents of the changed files, up to a size limit, for context.</li>
            <li>The pull request&apos;s title and description, and the repository&apos;s <code className="font-mono text-xs">.second-look.md</code> from the main branch.</li>
            <li>On a later commit: the earlier findings the reviewer confirmed or rejected, with rejection reasons.</li>
          </ul>
          <p>
            The model is Anthropic&apos;s, called through its API, and Anthropic&apos;s terms for
            API use apply to what is sent. Nothing is sent anywhere else.
          </p>
        </Section>

        <Section title="Kept in the database">
          <ul className={LIST}>
            <li>Repository owner and name, pull request number, title, and author&apos;s GitHub login, and the commits reviewed.</li>
            <li>The first pass&apos;s summary and findings: file, lines, severity, and the model&apos;s explanation and suggested fix. These can quote short pieces of the code.</li>
            <li>Reviewers&apos; decisions, rewrites, rejection reasons, notes to the author, and the GitHub login of whoever made each one, with the time.</li>
            <li>Token counts per review, for cost.</li>
          </ul>
        </Section>

        <Section title="Not kept">
          <ul className={LIST}>
            <li>The diff and the file contents. They are fetched from GitHub each time a review page is opened, and held in memory for a few minutes.</li>
            <li>Code pasted into the playground. It is sent to the model once and not stored; only the token count is.</li>
            <li>GitHub tokens. Signing in puts a signed cookie in your browser with your GitHub login and the name, email and picture link from your GitHub profile. Nothing about you is written to the database until you make a decision, and then only your login.</li>
            <li>IP addresses. The playground&apos;s rate limit keys on a salted hash of the address.</li>
          </ul>
        </Section>

        <Section title="Logs">
          <p>
            Server logs hold event names, ids, counts, and error codes. They never hold code,
            diffs, file contents, model output, or tokens.
          </p>
        </Section>

        <Section title="On GitHub">
          <p>
            Nothing is posted to a pull request until a reviewer publishes. Then one review is
            posted with only the findings the reviewer confirmed, and the check is updated.
            Rejected findings and reasons stay in Second Look.
          </p>
        </Section>

        <p className="mt-10 text-sm text-ink-soft">
          <Link className={LINK} href="/">
            Back to the playground
          </Link>
        </p>
      </main>
    </>
  );
}

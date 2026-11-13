import Link from "next/link";

const LINK = "text-blue-700 underline";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Second Look</h1>
      <p className="mt-4 text-slate-700">
        For the engineer who reviews pull requests written with AI tools by
        people who are not engineers. Second Look does the first pass. You
        confirm, reject, or rewrite each finding, and only what you confirm
        reaches the author.
      </p>
      <ul className="mt-8 space-y-3">
        <li>
          <Link className={LINK} href="/demo">
            See a reviewed pull request
          </Link>
          <span className="text-slate-600"> (read-only, no login)</span>
        </li>
        <li>
          <Link className={LINK} href="/paste">
            Paste mode
          </Link>
          <span className="text-slate-600"> (try it on your own snippet)</span>
        </li>
        <li>
          <Link className={LINK} href="/dashboard">
            Reviewer dashboard
          </Link>
          <span className="text-slate-600">
            {" "}
            (sign in with GitHub, needs write access to a repository where the
            app is installed)
          </span>
        </li>
        <li>
          <a className={LINK} href="https://github.com/Changliu53/second-look">
            Source code and design notes
          </a>
        </li>
      </ul>
    </main>
  );
}

import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Second Look</h1>
      <p className="mt-4 text-slate-700">
        A first-pass reviewer for AI-generated code. The AI suggests findings,
        an engineer confirms or rejects each one, and only confirmed findings
        reach the pull request author.
      </p>
      <ul className="mt-8 space-y-3">
        <li>
          <Link className="text-blue-700 underline" href="/dashboard">
            Reviewer dashboard
          </Link>
          <span className="text-slate-600"> (sign in with GitHub)</span>
        </li>
        <li>
          <Link className="text-blue-700 underline" href="/paste">
            Paste mode
          </Link>
          <span className="text-slate-600"> (try it without GitHub)</span>
        </li>
      </ul>
    </main>
  );
}

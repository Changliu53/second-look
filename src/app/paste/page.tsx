import Link from "next/link";
import { PasteForm } from "./paste-form";

export default function PastePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link className="text-sm text-blue-700 underline" href="/">
        Second Look
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Paste mode</h1>
      <p className="mt-2 text-sm text-slate-700">
        Paste code or a diff that someone else wrote with an AI tool and see
        what the first pass would flag. This page skips the confirm and reject
        step, so treat the output as suggestions. The text is sent to the model
        for this review and is not stored. Requests are rate limited.
      </p>
      <PasteForm />
    </main>
  );
}

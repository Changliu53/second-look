"use client";

import { useState, type FormEvent } from "react";
import { CategoryBadge, SeverityBadge } from "@/components/badges";
import { SummaryCard } from "@/components/summary-card";
import type { PasteSuccess } from "@/paste/handle-paste";

type FormState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "done"; result: PasteSuccess };

async function requestReview(code: string, description: string): Promise<FormState> {
  try {
    const response = await fetch("/api/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, description: description || undefined }),
    });
    const body = await response.json();
    if (!response.ok) {
      return { phase: "error", message: body.error ?? "Request failed." };
    }
    return { phase: "done", result: body as PasteSuccess };
  } catch {
    return { phase: "error", message: "Could not reach the server." };
  }
}

export function PasteForm() {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [state, setState] = useState<FormState>({ phase: "idle" });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setState({ phase: "loading" });
    setState(await requestReview(code, description));
  }

  return (
    <div className="mt-6">
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm font-medium">
          What is this code supposed to do? (optional)
          <input
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-normal"
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          Code or diff
          <textarea
            className="mt-1 block h-64 w-full rounded border border-slate-300 p-2 font-mono text-xs font-normal"
            value={code}
            required
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={state.phase === "loading"}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {state.phase === "loading" ? "Reviewing (up to a minute)..." : "Review"}
        </button>
      </form>

      {state.phase === "error" && (
        <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {state.message}
        </p>
      )}

      {state.phase === "done" && <PasteResult result={state.result} />}
    </div>
  );
}

function PasteResult({ result }: { result: PasteSuccess }) {
  return (
    <div className="mt-6 space-y-4">
      <SummaryCard summary={result.summary} />
      <h2 className="font-semibold">
        {result.findings.length === 0
          ? "No findings"
          : `Findings (${result.findings.length})`}
      </h2>
      <ul className="space-y-3">
        {result.findings.map((finding, index) => (
          <li key={index} className="rounded border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={finding.severity} />
              <CategoryBadge category={finding.category} />
              <span className="font-mono text-xs text-slate-600">
                {finding.file}:{finding.startLine}
                {finding.endLine !== finding.startLine && `-${finding.endLine}`}
              </span>
              <span className="text-xs text-slate-500">
                confidence {Math.round(finding.confidence * 100)}%
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap">{finding.explanation}</p>
            {finding.suggestedFix && (
              <p className="mt-2 whitespace-pre-wrap text-slate-700">
                <span className="font-medium">Suggested fix: </span>
                {finding.suggestedFix}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

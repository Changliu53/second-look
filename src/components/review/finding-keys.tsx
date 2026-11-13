"use client";

import { useEffect, useRef } from "react";
import { ReasonTip } from "@/components/reason-tip";
import { rememberAddFindingTipSeen } from "./add-finding-tip";
import { KBD } from "@/components/ui";

/**
 * Keyboard shortcuts for going through findings, for reviewers who do this
 * many times a day:
 *
 *   j / k   next / previous finding      n   next pending finding
 *   c       confirm                       r   reject      e   edit      u   undo
 *
 * and, while typing in a finding's form: Cmd+Enter (Ctrl+Enter) saves it, and
 * Esc closes the form for a new finding. ? shows the list.
 *
 * It works on the DOM, not on component state: findings are marked with
 * data-finding and their controls with data-action. That lets the same
 * shortcuts drive the dashboard (server-action forms) and the home page
 * sandbox (client state) without either knowing about the other.
 */

function findings(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-finding]")];
}

function activeIndex(cards: HTMLElement[]): number {
  return cards.findIndex((card) => card.dataset.active === "true");
}

function activate(cards: HTMLElement[], index: number): void {
  const target = cards[index];
  if (!target) {
    return;
  }
  for (const card of cards) {
    card.dataset.active = String(card === target);
  }
  target.scrollIntoView({ block: "center", behavior: "smooth" });
}

function press(card: HTMLElement, action: string): void {
  const control = card.querySelector<HTMLElement>(`[data-action="${action}"]`);
  if (!control) {
    return;
  }
  if (control instanceof HTMLDetailsElement) {
    // The control may sit inside a folded card; unfold that first.
    const fold = card.querySelector<HTMLDetailsElement>("details[data-collapsible]");
    if (fold) {
      fold.open = true;
    }
    control.open = true;
    control.querySelector<HTMLElement>("input:not([type=hidden]), textarea")?.focus();
  } else {
    control.click();
  }
}

/** Selects the next pending finding after the current one, wrapping around. */
function goToNextPending(): void {
  const cards = findings();
  const current = activeIndex(cards);
  const order = [...cards.keys()].map((i) => (current + 1 + i) % cards.length);
  const next = order.find((i) => cards[i]?.dataset.status === "pending");
  if (next !== undefined) {
    activate(cards, next);
  }
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

const ACTION_KEYS: Record<string, string> = { c: "confirm", r: "reject", e: "edit", u: "undo" };

/** Keys that work while typing in a finding's form. True if one was handled. */
function handleFormKey(event: KeyboardEvent): boolean {
  if (!(event.target instanceof HTMLElement)) {
    return false;
  }
  const form = event.target.closest<HTMLFormElement>("[data-composer], [data-finding] form");
  if (!form) {
    return false;
  }
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    form.requestSubmit();
    return true;
  }
  if (event.key === "Escape" && form.dataset.composer !== undefined) {
    form.querySelector<HTMLElement>("[data-cancel]")?.click();
    return true;
  }
  return false;
}

const HELP_ID = "keyboard-help";

function handleKey(event: KeyboardEvent): void {
  if (handleFormKey(event)) {
    return;
  }
  if (event.key === "?" && !isTyping(event.target)) {
    const help = document.getElementById(HELP_ID);
    if (help instanceof HTMLDialogElement && !help.open) {
      event.preventDefault();
      help.showModal();
    }
    return;
  }
  if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  const cards = findings();
  if (cards.length === 0) {
    return;
  }
  const current = activeIndex(cards);

  if (event.key === "j") {
    activate(cards, Math.min(current + 1, cards.length - 1));
  } else if (event.key === "k") {
    activate(cards, Math.max(current - 1, 0));
  } else if (event.key === "n") {
    goToNextPending();
  } else if (ACTION_KEYS[event.key] && current !== -1) {
    event.preventDefault();
    press(cards[current]!, ACTION_KEYS[event.key]!);
  }
}

/**
 * A card the reviewer clicks in becomes the one the keys act on. Without
 * this, opening a card with the mouse and then pressing r did nothing,
 * because only j, k and n selected a card.
 */
function handleClick(event: MouseEvent): void {
  if (!(event.target instanceof HTMLElement)) {
    return;
  }
  const card = event.target.closest<HTMLElement>("[data-finding]");
  if (!card) {
    return;
  }
  for (const other of findings()) {
    other.dataset.active = String(other === card);
  }
}

/** If the URL points at a finding (after an action), make it the active one. */
function activateFromHash(): void {
  const id = window.location.hash.replace("#finding-", "");
  const cards = findings();
  const index = cards.findIndex((card) => card.dataset.finding === id);
  if (index !== -1) {
    for (const card of cards) {
      card.dataset.active = String(card === cards[index]);
    }
  }
}

const SHORTCUTS: Array<[string[], string]> = [
  [["j"], "Next finding"],
  [["k"], "Previous finding"],
  [["n"], "Next pending finding"],
  [["c"], "Confirm"],
  [["r"], "Reject"],
  [["e"], "Edit"],
  [["u"], "Undo a decision"],
  [["⌘", "Enter"], "Save the form you are typing in"],
  [["Esc"], "Close a new finding's form, or this list"],
  [["?"], "Show this list"],
];

/** The list of shortcuts, opened with "?" or the button beside the keys. */
function KeyboardHelp() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        className="hidden size-7 place-items-center rounded-md border border-edge text-xs font-semibold text-ink-soft transition hover:border-slate-400 hover:text-ink sm:grid"
      >
        ?
      </button>
      <dialog
        id={HELP_ID}
        ref={dialog}
        // A click on the backdrop lands on the dialog itself: close.
        onClick={(event) => event.target === dialog.current && dialog.current?.close()}
        className="m-auto w-[min(26rem,92vw)] rounded-lg border border-edge bg-surface-raised p-0 text-ink shadow-xl backdrop:bg-slate-900/40"
      >
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="rounded px-2 py-0.5 text-xs text-ink-soft hover:bg-slate-100"
          >
            Close
          </button>
        </div>
        <dl className="divide-y divide-edge px-4 text-sm">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-ink-soft">{label}</dt>
              <dd className="flex shrink-0 gap-1">
                {keys.map((key) => (
                  <kbd key={key} className={KBD}>
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-edge px-4 py-3 text-xs text-ink-soft">
          Click a finding to make it the one the keys act on.
        </p>
      </dialog>
    </>
  );
}

export function FindingKeys({
  pending,
  hints = true,
}: {
  pending: number;
  /** False where the bar has no room for the key legend; the keys still work. */
  hints?: boolean;
}) {
  useEffect(() => {
    activateFromHash();
    window.addEventListener("keydown", handleKey);
    window.addEventListener("click", handleClick);
    // The outline at the top links to findings by their id.
    window.addEventListener("hashchange", activateFromHash);
    // Someone who submits the form for a finding of their own no longer
    // needs the tip that says they can.
    const onSubmit = (event: SubmitEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches("[data-composer]")) {
        rememberAddFindingTipSeen();
      }
    };
    window.addEventListener("submit", onSubmit);
    return () => {
      window.removeEventListener("submit", onSubmit);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("click", handleClick);
      window.removeEventListener("hashchange", activateFromHash);
    };
  }, []);

  return (
    <div className="flex items-center gap-2 sm:gap-4">
      {hints && (
        <p className="hidden items-center gap-1.5 text-xs text-ink-soft xl:flex">
          <kbd className={KBD}>j</kbd>
          <kbd className={KBD}>k</kbd> move
          <kbd className={`${KBD} ml-2`}>c</kbd> confirm
          <kbd className={KBD}>r</kbd> reject
          <kbd className={KBD}>e</kbd> edit
        </p>
      )}
      {/* The same as pressing n, for people using the mouse. */}
      <ReasonTip
        reason={pending === 0 ? "Nothing is pending. Every finding has a decision." : null}
        side="bottom"
        align="end"
      >
        <button
          type="button"
          disabled={pending === 0}
          aria-label="Next pending finding"
          onClick={goToNextPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-raised px-2.5 py-1 text-xs font-medium transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-edge"
        >
          Next<span className="hidden sm:inline"> pending</span>
          <kbd className={`${KBD} hidden sm:inline`}>n</kbd>
        </button>
      </ReasonTip>
      <KeyboardHelp />
    </div>
  );
}

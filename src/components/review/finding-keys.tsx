"use client";

import { useEffect } from "react";
import { KBD } from "@/components/ui";

/**
 * Keyboard shortcuts for going through findings, for reviewers who do this
 * many times a day:
 *
 *   j / k   next / previous finding      n   next pending finding
 *   c       confirm                       r   reject      e   edit      u   undo
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
    control.open = true;
    control.querySelector<HTMLElement>("input:not([type=hidden]), textarea")?.focus();
  } else {
    control.click();
  }
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

const ACTION_KEYS: Record<string, string> = { c: "confirm", r: "reject", e: "edit", u: "undo" };

function handleKey(event: KeyboardEvent): void {
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
    // Next pending finding after the current one, wrapping to the start.
    const order = [...cards.keys()].map((i) => (current + 1 + i) % cards.length);
    const next = order.find((i) => cards[i]?.dataset.status === "pending");
    if (next !== undefined) {
      activate(cards, next);
    }
  } else if (ACTION_KEYS[event.key] && current !== -1) {
    event.preventDefault();
    press(cards[current]!, ACTION_KEYS[event.key]!);
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

export function FindingKeys() {
  useEffect(() => {
    activateFromHash();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <p className="hidden items-center gap-1.5 text-xs text-ink-soft md:flex">
      <kbd className={KBD}>j</kbd>
      <kbd className={KBD}>k</kbd> move
      <kbd className={`${KBD} ml-2`}>n</kbd> next pending
      <kbd className={`${KBD} ml-2`}>c</kbd> confirm
      <kbd className={KBD}>r</kbd> reject
      <kbd className={KBD}>e</kbd> edit
    </p>
  );
}

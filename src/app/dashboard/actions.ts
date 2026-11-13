"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInLogin, signIn, signOut } from "@/auth";
import {
  decideFindingFor,
  editFindingFor,
  publishReviewFor,
  type ActionResult,
} from "@/dashboard/service";
import { dashboardDeps } from "./deps";

/**
 * Server actions for the dashboard forms. Each one: read and validate the
 * form, require a signed-in user, call the service, then go back to the page.
 * All rules live in src/dashboard/service.ts.
 */

const idSchema = z.coerce.number().int().positive();
const resolutionSchema = z
  .enum(["author_fixes", "reviewer_takes_over"])
  .catch("author_fixes");

function reviewPath(reviewId: number): string {
  return `/dashboard/reviews/${reviewId}`;
}

async function requireLogin(): Promise<string> {
  const login = await getSignedInLogin();
  if (!login) {
    redirect("/dashboard");
  }
  return login;
}

/**
 * Returns to the review page. After acting on a finding the URL ends in
 * "#finding-<id>", so the browser scrolls back to where the reviewer was
 * instead of to the top of a long diff.
 */
function finish(reviewId: number, result: ActionResult, findingId?: number): never {
  revalidatePath(reviewPath(reviewId));
  const anchor = findingId === undefined ? "" : `#finding-${findingId}`;
  if (!result.ok) {
    redirect(`${reviewPath(reviewId)}?error=${result.error}${anchor}`);
  }
  redirect(`${reviewPath(reviewId)}${anchor}`);
}

function readIds(formData: FormData): { reviewId: number; findingId: number } {
  return {
    reviewId: idSchema.parse(formData.get("reviewId")),
    findingId: idSchema.parse(formData.get("findingId")),
  };
}

function optionalText(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 500) : null;
}

export async function confirmFindingAction(formData: FormData): Promise<void> {
  const login = await requireLogin();
  const { reviewId, findingId } = readIds(formData);
  finish(reviewId, await decideFindingFor(findingId, { status: "confirmed" }, login, dashboardDeps()), findingId);
}

export async function rejectFindingAction(formData: FormData): Promise<void> {
  const login = await requireLogin();
  const { reviewId, findingId } = readIds(formData);
  const decision = {
    status: "rejected" as const,
    rejectionReason: optionalText(formData.get("reason")),
  };
  finish(reviewId, await decideFindingFor(findingId, decision, login, dashboardDeps()), findingId);
}

export async function resetFindingAction(formData: FormData): Promise<void> {
  const login = await requireLogin();
  const { reviewId, findingId } = readIds(formData);
  finish(reviewId, await decideFindingFor(findingId, { status: "pending" }, login, dashboardDeps()), findingId);
}

export async function editFindingAction(formData: FormData): Promise<void> {
  const login = await requireLogin();
  const { reviewId, findingId } = readIds(formData);
  const edit = {
    explanation: formData.get("explanation"),
    suggestedFix: formData.get("suggestedFix") ?? "",
  };
  finish(reviewId, await editFindingFor(findingId, edit, login, dashboardDeps()), findingId);
}

export async function publishReviewAction(formData: FormData): Promise<void> {
  const login = await requireLogin();
  const reviewId = idSchema.parse(formData.get("reviewId"));
  const note = formData.get("note");
  // A missing or unknown value means the default: the author makes the fixes.
  const resolution = resolutionSchema.parse(formData.get("resolution"));
  finish(
    reviewId,
    await publishReviewFor(
      reviewId,
      typeof note === "string" ? note : null,
      login,
      dashboardDeps(),
      resolution,
    ),
  );
}

export async function signInAction(): Promise<void> {
  await signIn("github", { redirectTo: "/dashboard" });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}

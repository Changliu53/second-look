# Decisions

One entry per real design choice: what, why, and the alternative that was rejected.

## 1. Structured outputs instead of forced tool use
**What:** The model call uses `client.messages.parse()` with `output_config.format` built from the Zod schema (`zodOutputFormat`).
**Why:** The brief asked for "tool use / structured output". On current models (Opus 5.5, Sonnet 5.5, Fable 5.x) forcing a tool with `tool_choice: {type: "tool"}` returns HTTP 400, so the classic "force one tool call" pattern no longer works. Structured outputs constrain the response to the schema on the API side.
**Rejected:** A tool with `tool_choice: auto` plus "always call this tool" in the prompt. It works most of the time, which is worse than a guarantee.

## 2. The engine validates model output again
**What:** `reviewChange` runs `reviewOutputSchema.safeParse` on whatever the model client returns, even though the SDK already validated it.
**Why:** The engine is the trust boundary. It should not depend on one client implementation doing the right thing, and it makes the validation testable with a fake model.
**Rejected:** Trusting `parsed_output` from the SDK and casting.

## 3. Untrusted content goes inside nonce-tagged sections
**What:** Diff, file contents, PR title and description are wrapped in tags like `<diff-3fa9c1...>`. The suffix is 8 random bytes generated per review. The system prompt says only text outside those tags is an instruction.
**Why:** Code under review is written by someone else and can contain "ignore previous instructions". With a fixed tag name, the code could include `</diff>` and then fake instructions. The author cannot guess a per-request nonce, so they cannot close the section.
**Rejected:** Escaping or stripping suspicious phrases. A blocklist is always incomplete, and changing the code would make line numbers and findings wrong.
**Limit:** This makes injection harder, not impossible. The eval has a prompt-injection case to measure it, and a human still confirms every finding.

## 4. Team guidelines are read from the base branch
**What:** `.second-look.md` is fetched at the PR's base ref, not at the head commit.
**Why:** If it were read from the PR head, the author could edit the rules that review their own PR ("do not report security issues").
**Rejected:** Reading from the head so rule changes can be tested in a PR.

## 5. The diff is shown to the model with explicit line numbers
**What:** Each diff line is rendered as `   42 + | code`.
**Why:** Findings must cite new-file line numbers so GitHub can place inline comments. Models are bad at counting lines from `@@ -10,4 +10,5 @@` headers.
**Rejected:** Sending the raw diff and asking for line numbers.

## 6. Own diff parser
**What:** `src/review/diff.ts`, about 200 lines.
**Why:** We need new-file line numbers per line, the set of lines GitHub accepts comments on, and hunk membership. It is small enough to read and test in full.
**Rejected:** The `parse-diff` package. It would work, but the extra bookkeeping would still be ours and the parser is the part most worth understanding.

## 7. The review runs in `after()`, with no queue
**What:** The webhook route verifies the signature, returns 202, and runs the review inside `after()` from `next/server`. `maxDuration` is 300.
**Why:** GitHub expects a webhook response within 10 seconds, and a review takes longer. `after()` keeps the function alive after the response is sent. Per Vercel's docs (checked November 2026), functions with Fluid compute can run up to 300 seconds on Hobby and 800 seconds on Pro, which covers one model call. The Anthropic client times out at 240 seconds so we can record the failure ourselves before the platform kills the function.
**Rejected:** A queue (Inngest, QStash, Vercel Queues). It gives retries, but adds a service, an account, and a second deployment surface to an MVP.
**Cost of this choice:** No automatic retry. If the function dies mid-review, the row stays `running`. After 10 minutes it counts as stale, and the next webhook for that commit (close and reopen the PR) runs it again.

## 8. One review per commit, enforced by a unique index
**What:** Unique index on `(pull_request_id, head_sha)`. `startGithubReview` inserts with `ON CONFLICT DO NOTHING`.
**Why:** GitHub redelivers webhooks. Without this, a redelivery would run and bill a second review and duplicate the findings.
**Rejected:** Checking "does a review exist?" before inserting. Two deliveries arriving together would both see "no".

## 9. No transactions; writes are ordered instead
**What:** The Neon HTTP driver cannot do interactive transactions. `completeReview` inserts findings first and flips the status to `completed` last.
**Why:** A review marked `completed` then always has all its findings. A crash in between leaves it `running`, and the retry path deletes the partial findings.
**Rejected:** The Neon WebSocket driver with a connection pool, which supports transactions but needs connection management in a serverless function.

## 10. The check run stays in progress until a human publishes
**What:** After the AI finishes, the check is still `in_progress` ("Waiting for a reviewer"). On publish it becomes `action_required` if any confirmed finding is critical, otherwise `success`.
**Why:** Read literally, the brief would make the check green as soon as the AI finished, because nothing is confirmed yet. A team that requires this check could then merge before any engineer looked.
**"Unresolved" means:** the author pushes a fix, which starts a new review on the new commit. Checks belong to a commit, so the old `action_required` stays on the old commit.
**Rejected:** Completing with `neutral` after the AI pass. GitHub treats neutral as passing for required checks.

## 11. Code under review is not stored
**What:** The database holds findings, summaries, and token counts. The diff is fetched from GitHub each time the dashboard shows a review. Paste mode stores token usage only.
**Why:** Less sensitive data to protect, and no copy that can go out of sync with GitHub.
**Rejected:** Storing the diff with the review. Faster page loads, but the database would then contain customers' source code.
**Cost:** Finding explanations can quote short pieces of code. The dashboard needs GitHub to be reachable to show the diff (it falls back to a plain list of findings).

## 12. Dashboard access is checked against GitHub on every request
**What:** `canReviewRepository` asks GitHub for the user's permission on the repo and requires `admin` or `write`. A user without access gets "not found".
**Why:** "Sign in with GitHub" only proves identity; anyone has a GitHub account. Asking GitHub each time means removing someone from the repo removes their access here with no sync job.
**Rejected:** An allowlist env var, or caching permissions in our database.
**Cost:** One GitHub API call per repository per page load.

## 13. JWT sessions, no user table
**What:** Auth.js with `session: { strategy: "jwt" }`. The token carries the GitHub login.
**Why:** The login is the only thing we need to know about a user. `decided_by` and `published_by` store it as text.
**Rejected:** Database sessions with the Drizzle adapter (four more tables).

## 14. Publishing claims the review first
**What:** `claimReviewForPublish` is one `UPDATE ... WHERE published_at IS NULL RETURNING`. Only the caller that gets a row back posts to GitHub. If posting fails, the claim is released.
**Why:** Two clicks, or two reviewers, must not post two reviews.
**Rejected:** Check `published_at`, post, then update. Both requests can pass the check.

## 15. Publish requires every finding to be decided
**What:** Publishing is refused while any finding is `pending`.
**Why:** Otherwise undecided findings would be dropped without anyone choosing to drop them.
**Rejected:** Treating pending as rejected at publish time.

## 16. Findings that cannot be placed inline go in the review body
**What:** `placeComment` returns null for a line that is not in the diff. Those findings are listed in the review body. A multi-line range that crosses hunks becomes a single-line comment.
**Why:** GitHub rejects the entire review with HTTP 422 if one comment points outside the diff or spans two hunks.
**Rejected:** Dropping such findings, or moving them to the nearest diff line (which would point at the wrong code).

## 17. The review is posted as COMMENT, not REQUEST_CHANGES
**What:** `event: "COMMENT"`.
**Why:** Blocking the merge is the check run's job (F4). Two blocking mechanisms would disagree after a re-review.
**Rejected:** REQUEST_CHANGES when there is a critical finding.

## 18. Rate limiting in Postgres
**What:** Fixed one-hour window per hashed IP, counted with a single `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`. Plus a daily cap across all callers and an input size cap.
**Why:** The stack is fixed and already has Postgres. One statement is atomic, so concurrent requests cannot both read the old count.
**Rejected:** Upstash Redis (a new service), or an in-memory counter (serverless instances do not share memory).
**Cost:** A fixed window allows up to twice the limit across a window boundary. The goal is to cap spend, not to be exact.

## 19. Size limit counts characters, not tokens
**What:** `MAX_DIFF_CHARS` is compared with the character count of the reviewable diff.
**Why:** It is free, instant, and deterministic. The limit exists to cap cost and stay inside the time budget, so a rough measure is enough.
**Rejected:** Calling the token counting API first, which adds a network round trip to every review.

## 20. The model name is the only model setting
**What:** `ANTHROPIC_MODEL` (default `claude-opus-5-5`). No `thinking`, `effort`, or sampling parameters are sent.
**Why:** Those parameters differ by model, and some return 400 on some models. Sending none keeps the env var free to point at any current model.
**Rejected:** Setting `effort: "high"`. Worth trying against the eval once there is a baseline.
**Not done:** The API's server-side refusal fallback (a beta). If the model declines a review, the review is recorded as failed with `model_refused`.

## 21. The engine does not know about GitHub or Next.js
**What:** `reviewChange(input, model, limits)` takes a diff and a `ReviewModel` interface. GitHub access sits behind a `GitHubClient` interface.
**Why:** The webhook, paste mode, and the eval script run the same code. Tests replace the two interfaces with in-memory fakes and exercise the real logic and a real Postgres (PGlite) without network.
**Rejected:** Mocking the Anthropic SDK and Octokit module by module, which tests the mocks.

## 22. How the eval counts
**What:** A planted bug is found when a finding matches its file, overlaps its lines (within 1), and has an accepted category. A false positive is an unmatched critical or warning. Unmatched nits are reported separately. Two of the ten cases are clean code.
**Why:** Without clean cases, a reviewer that flags everything would score well. The output says "recall" and "precision" because "false positive rate" is used loosely for several different numbers.
**Rejected:** Asking a second model to judge the findings. Harder to reproduce and to explain.

## 23. Only authors with write access get an automatic review
**What:** The webhook handler asks GitHub for the PR author's permission and skips the review unless it is `write` or `admin`.
**Why:** The repository is public. Anyone can open a pull request from a fork, and each review is a paid model call, so an open webhook is a way to spend the owner's money. In the intended setting (a team's own repository) every author has write access, so nothing changes for them.
**Rejected:** Reviewing everything and relying on a spend limit at the model provider. That caps the damage but still lets strangers use up the budget.
**Cost:** Outside contributors get no review and no check run. A maintainer cannot trigger one for them yet.

## 24. Access control and data loss are their own categories
**What:** Two categories were added after the first release: `access-control` (missing tenant filter, missing authorization) and `data-loss` (migrations that destroy or break existing rows). The prompt tells the reviewer to ask, for every migration, what happens to rows that already exist.
**Why:** In a multi-tenant business platform these are the two mistakes that cannot be undone by reverting the commit. A leaked row has been seen; a dropped column is gone. Filed under "security" and "bug" they looked the same as a missing input check. A separate label lets a reviewer scan for them first.
**Rejected:** Leaving them inside `security` and `bug` and relying on severity.
**Cost:** A Postgres enum can only be extended, and new values are appended. The order in `src/db/schema.ts` has to follow the migrations, not the alphabet.

## 25. A public, read-only demo page
**What:** `/demo` shows the reviewer's page for one pull request, named in `DEMO_PULL_REQUEST`, to anyone. It only ever loads a review that has been published.
**Why:** The reviewer's page is the product, and it is behind a login plus write access to a repository. Without a public copy nobody outside can see it.
**Rejected:** A guest login to the real dashboard. It would need its own permission model for one use.
**Cost:** The page also shows the findings the reviewer rejected, which the author never saw. That is fine for a demo pull request in a public repository and wrong for a private one, so the variable must only point at a public repository.

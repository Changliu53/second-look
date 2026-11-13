# Learning notes

Five questions per part of the system, with short answers. "Read line by line" marks the files worth knowing in detail.

## M0: scaffold and database

**Read line by line:** `src/db/schema.ts`, `src/lib/env.ts`

1. **Why is there a unique index on `(pull_request_id, head_sha)`, and why is it partial?**
   One review per commit makes webhook redelivery a no-op. It is partial (`WHERE pull_request_id IS NOT NULL`) because paste-mode reviews have no PR and must not collide with each other.

2. **Why keep `explanation` and `edited_explanation` as separate columns?**
   The model's text is never overwritten. That keeps a record of what the AI said versus what the human published, which is the data needed later to feed rejections and edits back into the prompt.

3. **Why are env vars validated when read instead of at startup?**
   Different entry points need different variables. The eval script needs only the Anthropic key; `next build` needs none. A single "all required" check at import time would break both.

4. **Why Postgres enums for status, severity, and category?**
   The database rejects a value the code does not know. A typo like `"confirmd"` fails at insert instead of creating a row no query ever matches.

5. **What does a migration give you over `drizzle-kit push`?**
   A reviewed SQL file in git per schema change, applied in order. Tests apply the same files to an in-process Postgres, so the schema under test is the production schema.

## M1: review engine, paste mode, eval

**Read line by line:** `src/review/engine.ts`, `src/review/prompt.ts`, `src/review/diff.ts`, `eval/score.ts`

1. **How do you stop code under review from giving the model instructions?**
   Three layers. Untrusted text only ever goes inside tags named with a per-request random nonce, so the code cannot close the tag. The system prompt says text inside those tags is data. The output is constrained to a schema, so the worst a successful injection can do is change which findings appear, and a human still reviews those. It is mitigation, not proof; the eval measures it.

2. **Why not parse the model's text answer?**
   Free text needs a parser that guesses, and guesses fail silently. Structured outputs make the API return JSON matching the schema, and Zod checks it again at the engine boundary. Invalid output is an error, never a partial result.

3. **The model returns a finding for a file that is not in the diff. What happens?**
   `normalizeFindings` drops it. The schema guarantees shape, not truth, so the engine also checks content: known file, line range in order.

4. **How does the eval decide a bug was "found", and what are its limits?**
   Same file, overlapping lines (within 1), accepted category. Limits: ten small cases, model output varies between runs, and matching by location can credit a finding that is on the right line for the wrong reason.

5. **Why is the rate limit a single SQL statement?**
   `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` is atomic. Read-then-write would let two concurrent requests both see count 4 and both pass a limit of 5.

## M2: GitHub App webhook

**Read line by line:** `src/github/webhook.ts`, `src/github/review-pull-request.ts`, `src/db/queries.ts` (`startGithubReview`, `completeReview`)

1. **Why verify the webhook signature, and why on the raw body?**
   The URL is public; anyone can POST a fake event. GitHub signs the exact bytes with a shared secret (HMAC-SHA256). Parsing and re-serializing the JSON can change the bytes, so the check must use the raw text.

2. **GitHub wants a response in 10 seconds but a review takes a minute. What do you do?**
   Respond 202 right away and run the review in `after()`, which keeps the serverless function alive after the response. The limit is the function's max duration (300s on Vercel Hobby).

3. **What happens if the function crashes halfway through a review?**
   There is no queue, so no automatic retry. The row stays `running`; after 10 minutes it is treated as stale and the next webhook for that commit may rerun it, after deleting partial findings. This is a known limit, written down in DECISIONS.md.

4. **Why read `.second-look.md` from the base branch?**
   Reading it from the PR head would let the PR author rewrite the rules that review their own PR.

5. **Why does the code depend on a `GitHubClient` interface instead of Octokit directly?**
   The interface lists the six operations the app uses. Tests pass an in-memory fake and exercise the real orchestration and database code. Octokit specifics (media types, 404 handling) live in one file.

## M3: dashboard and publish

**Read line by line:** `src/dashboard/service.ts`, `src/github/publish.ts`

1. **Signing in with GitHub is authentication. Where is authorization?**
   Every dashboard read and write calls `canReviewRepository`, which asks GitHub for the user's permission on that repo and requires write or admin. Unauthorized users get "not found" so review ids are not revealed.

2. **How do you prevent a double publish?**
   A conditional update claims the review: `UPDATE ... SET published_at = now() WHERE published_at IS NULL RETURNING id`. Only one caller gets a row. If the GitHub call then fails, the claim is released.

3. **Why can GitHub reject a review with 422, and how do you avoid it?**
   Inline comments must point at lines that are in the diff, and a multi-line comment must stay inside one hunk. `placeComment` checks both; findings with no valid position go into the review body.

4. **Server actions are public endpoints. What does each one check?**
   That there is a session, that the ids parse (Zod), and, in the service, that the user has write access to the repo that owns the finding and that the review is not already published or superseded. Hidden form fields are never trusted.

5. **Why must every finding be decided before publishing?**
   The product promise is that a human looked at each one. Publishing with pending findings would drop them without a decision.

## M4: check runs and polish

**Read line by line:** `src/github/check-run.ts`

1. **When is the check green?**
   Only after a human publishes and no confirmed finding is critical. Not when the AI finishes: nothing is confirmed at that point, so the check would pass before anyone looked.

2. **Why not conclude `neutral` while waiting for the reviewer?**
   GitHub counts neutral as passing for required checks. `in_progress` is the state that blocks.

3. **How does a critical finding get "resolved"?**
   The author pushes a fix. That is a new commit, so a new check run and a new review. Check runs belong to a commit, which is why no manual "resolve" button is needed.

4. **What is never written to logs?**
   Tokens, diffs, file contents, and model output. `logEvent` takes ids, counts, and error codes. Errors are reduced to a code or HTTP status by `safeErrorCode` because upstream error messages can echo request bodies.

5. **What would you change first for real production use?**
   A queue with retries for reviews, token-based size limits with chunking for large PRs, feeding rejection reasons back into the prompt, and a larger eval with repeated runs to measure variance.

## Tenancy and migrations (the C# and EF Core eval cases)

**Read line by line:** `eval/cases/ef-*/diff.patch`, the two new category definitions in `src/review/prompt.ts`

1. **Why does "rename a column" as `DropColumn` + `AddColumn` lose data, and what is the fix?**
   Drop deletes the column and every value in it; Add creates a new empty column. Nothing copies the values across. `RenameColumn` changes the name and keeps the data. EF Core scaffolds drop-and-add when it cannot tell a rename from a remove-plus-add, so migrations must be read, not trusted.

2. **A migration adds a required foreign key with `defaultValue: 0`. It passes on a dev database. Why does it fail in production?**
   Existing rows all get 0, and no parent row has id 0, so adding the constraint fails. An empty dev table has no rows to violate it. The safe order is: add the column as nullable, backfill real values, then make it required and add the constraint.

3. **What is a global query filter, and how do the planted bugs get around it?**
   EF Core can attach `Where(TenantId == current)` to every query on an entity. `IgnoreQueryFilters()` turns it off for one query, and raw SQL (`ExecuteSqlRaw`) never had it. Both look harmless in a diff unless you know the filter exists.

4. **Why are these two classes of bug worse than a crash?**
   A crash is visible and reverting the commit fixes it. A cross-tenant read has already shown one company's data to another, and a dropped column needs a restore from backup. Neither is undone by a revert.

5. **The reviewer cited "team guidelines" in its findings. Where do they come from, and why does that matter?**
   From `.second-look.md` on the base branch. The model knows general patterns but not this platform's rules. Writing the invariants down once means every review checks them, and a finding that quotes the rule teaches the author the rule.

## Hardening and the interactive home page

**Read line by line:** `src/github/publish.ts` (`neutralizeForGithub`), `src/db/queries.ts` (`completeReview`), `src/sandbox/model.ts`, `src/components/review/finding-keys.tsx`

1. **Two commits are pushed ten seconds apart. What could go wrong, and how is it prevented?**
   Two reviews run at once. The older one is marked superseded, but when its model call returns it used to set its status back to completed, so an outdated review reappeared as open. Now the final update only applies `WHERE status = 'running'`, and the old commit's check closes as neutral. The test reproduces it by handling the second push from inside the first review's model call.

2. **Prompt injection is usually about input. What is the output-side risk here?**
   The model's text is posted to GitHub, and the code under review shapes that text. A pull request could get the reviewer to write `@org/team` (notifying people) or `![](https://...)` (loading a remote image for everyone who views the comment). The text is neutralized before posting: mentions go in backticks, image syntax is escaped. The human reviewer's own note is not touched.

3. **Why does the dashboard put an error code in the URL instead of the message?**
   The message used to travel in `?error=...` and the page displayed whatever was there, so a crafted link could show any text inside the dashboard. Now only a known code is accepted and mapped to a fixed sentence.

4. **The home page lets visitors confirm and reject findings with no account. How is that not a second implementation of the product?**
   Sandbox findings are kept in React state in the same shape as database rows and passed to the same pure functions the dashboard uses for placing comments, building the GitHub review, and deciding the check result. Only the buttons differ. A test checks the preview contains confirmed findings only.

5. **How did you lower false positives, and how do you know it worked?**
   By writing down what a warning is: it has to go wrong in normal use. Hardening advice is left out or downgraded. On the eval, found stayed 12 of 12 and unplanted warnings went from 6 to 3. The limits: fourteen cases, one run each, and the rule was written after seeing the results. The real measure is how often reviewers reject findings on real pull requests, which the `findings` table already records.

## Publish modes, fix prompts, and follow-up

**Read line by line:** `src/review/fix-prompt.ts`, `src/github/publish.ts` (`buildReviewParts`), `src/github/review-pull-request.ts` (`toEarlierReview`, `toFollowUpEntries`), `src/db/queries.ts` (`getEarlierDecisions`)

1. **Why does the fix prompt exist, and why is it not written by the model?**
   The author cannot turn "line 37 skips the tenant filter" into a code change, but their AI tool can. The prompt is a precise spec: which file, which lines, what is wrong, what to do, and what not to touch. It is built by a template so it is free, predictable, and readable before sending.

2. **What changes when the reviewer takes the pull request over?**
   The author is told they do not need to act, and gets the findings as an explanation instead of a to-do list. The check still blocks while a critical finding stands, and says who is fixing it. The reviewer gets a checkout command and an engineer's version of the prompt: add a failing test per critical finding, one commit per problem.

3. **A reviewer rejects a finding in round one. How is it kept from coming back in round three?**
   Rejections are collected from every earlier published review of the pull request, not only the last. Round two never raised the finding, so it has no record of it; reading only round two would lose it. Second Look found this bug in its own pull request.

4. **How does the tool decide a finding was fixed?**
   It does not match lines. The earlier confirmed findings are given to the model with ids, and the model returns a verdict per id. The engine keeps one verdict per known id, drops ids the model invented, and marks any it skipped as "cannot tell".

5. **The page shows a review of an old commit. Which diff does it show?**
   Not the pull request's current diff, which has moved on. It asks GitHub to compare the base branch with that commit, which is what the pull request looked like then. That needed the base branch stored on the pull request.

## Review experience: steps, folding, approval, and adding findings

**Read line by line:** `src/components/review/finding-view.tsx` (`FindingShell`, `decisionKey`), `src/components/reason-tip.tsx`, `src/app/playground/steps-bar.tsx`, `src/github/publish.ts` (`buildReviewParts`), `src/app/globals.css` (the dark theme block)

1. **A decided finding folds to one line. A reviewer opens it, changes the decision, and it stays open. Why, and what fixed it?**
   The card is a `<details>` element and React kept the same element across the change, so the browser kept it open. Giving it a `key` made from the decision makes React replace the element when the decision changes, and a new `<details>` starts closed. State that lives in the DOM is reset by replacing the node, not by setting a prop.

2. **Why is a disabled button's tooltip on a wrapper and not on the button?**
   A disabled button fires no mouse events, and the browser's own `title` tooltip takes over a second. The wrapper is hovered instead, with CSS only. The same sentence is also written beside the button, because a phone cannot hover.

3. **How does the dark theme work without a `dark:` class on every element?**
   Components name colours by scale step (`bg-slate-900`, `bg-red-50`). The dark theme redefines the scales themselves, mirrored, and `white` too, so each pair that had contrast keeps it. The cost: a newly used step needs a line in the dark block.

4. **Every finding was rejected. What does the author get?**
   A one-line review, "No changes needed", and a passing check with the same title. The first pass's summary is left out because it was written before the reviewer decided and often names the problems they turned down.

5. **People did not know they could write their own finding. What changed?**
   The "+" in the gutter was visible only on hover, which is found only by people who know to hover. It is now faintly visible on every line and fully visible on touch screens, and a tip above the code says so until it is dismissed.

## Running it for a team

**Read line by line:** `src/github/access.ts` (`PermissionCache`), `src/db/schema.ts` (`findingEvents`), `src/review/prioritize.ts`, `src/lib/budget.ts`, `src/github/run-review.ts`, `src/notify/review-ready.ts`, `src/lib/csv.ts`

1. **Why is `finding_events.finding_id` not a foreign key?**
   A finding a reviewer wrote can be deleted, and the record that it existed and was removed has to outlive it. A foreign key would either block the delete or delete the history with it.

2. **The event is written after the change, not in a transaction. What can go wrong?**
   The Neon HTTP driver has no interactive transactions. If the second write fails, the decision stands with no record of it. That order was chosen on purpose: the other order could record a decision that never happened, and failing the reviewer's click over an audit write is worse than a gap.

3. **Access answers are cached for a minute. What is the trade?**
   Fewer calls against the installation's rate limit and no GitHub round trip on every click, against a removed reviewer keeping access for up to a minute. For a review tool that is acceptable. The cache is per server instance; a cold instance asks once more.

4. **A pull request is over the size limit. How are the files to review chosen?**
   By a fixed ranking of path patterns: migrations and SQL, then authentication and tenancy, then endpoints, data access, deployment configuration, other code, and tests and docs last. Fixed patterns are free, the same every time, and explainable in one sentence. The model is told which files it was not shown, and the reviewer is told by name.

5. **The monthly budget is used up. Why does the check end neutral and not failed?**
   Nothing was found wrong with the code; it was not read. A team that requires the check would otherwise be unable to merge anything until the month ends. The dashboard says the review was skipped so a person reads it.

6. **How can a "Run the review again" click and a webhook for the same commit not both run?**
   Both go through `startGithubReview`, which claims the one row for that commit with a conditional write. The second caller sees a running review and stops. The click waits only for that claim, so the page it returns to already shows the review running.

7. **Why does the CSV export put an apostrophe before some values?**
   A cell that starts with `=`, `+`, `-` or `@` is run as a formula by a spreadsheet. Pull request titles and rejection reasons are typed by people, so a value like `=HYPERLINK(...)` is written as text. This is the same bug the sample pull request's CSV export had.

8. **The notification goes to a chat channel. What is kept out of it?**
   Code and the text of findings, because a channel is read by more people than the repository. The author-written title is escaped and cut, so it cannot mention the channel, add a link, or flood it.


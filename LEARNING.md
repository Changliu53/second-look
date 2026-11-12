# Learning notes

Five interview questions per milestone, with short answers to put in your own
words. "Read line by line" marks the files worth knowing in detail.

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

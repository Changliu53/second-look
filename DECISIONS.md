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

## 26. A written bar for "warning"
**What:** The prompt says a warning must go wrong in normal use with the code as written. Hardening advice (missing timeouts, pagination limits, input-length checks, overlapping scheduled runs) is left out or reported as a nit, and nits are capped at two per pull request.
**Why:** The first eval run found every planted bug and also raised six unplanted warnings in thirteen small pull requests. Each was defensible on its own, and together they were the main reason a reviewer would stop reading. After the rule: same twelve of twelve found, three unplanted warnings in fourteen cases.
**Rejected:** Dropping findings below a confidence threshold in code. The model's confidence numbers were high on the noise too, so the threshold would have cut real findings first.
**Risk:** Fourteen cases is a small set and the rule was written after looking at its results, so some of the gain is fitted to these cases. The check is whether reviewers reject fewer findings on real pull requests.

## 27. Built-in examples show saved results
**What:** The home page examples display results that were produced once by the real engine (`npm run examples:build`) and committed as JSON. Only pasted code calls the model.
**Why:** The examples open instantly, cost nothing per visitor, and still work when the model API is slow or down. A test checks that every saved finding lands on a line of its example, so the saved file cannot drift from the example code unnoticed.
**Rejected:** Calling the model on each click (slow, costs money, can fail in front of a visitor), or hand-written fake results (not honest).
**Cost:** The saved results go stale when the prompt changes. They have to be rebuilt, and the page says which model and date produced them.

## 28. The sandbox reuses the real placement and publishing code
**What:** The home page sandbox keeps findings in React state, shaped like database rows, and passes them to the same `buildReviewView`, `buildReviewPayload`, and `checkRunFor` functions the dashboard uses.
**Why:** The preview of what the author gets is then the real output, not an imitation that can drift from it. It works because those functions are pure: no database, no network.
**Rejected:** A separate, simplified preview written for the demo.

## 29. Keyboard shortcuts read the DOM, not component state
**What:** `j`, `k`, `n`, `c`, `r`, `e` find findings by `data-finding` and press controls marked `data-action`.
**Why:** The dashboard uses server-action forms and the sandbox uses client state. One small handler serves both without either knowing about the other, and the dashboard still works with JavaScript off.
**Rejected:** Converting the dashboard to client state so shortcuts could call handlers directly.

## 30. A superseded review cannot complete
**What:** `completeReview` and `failReview` only update a review whose status is still `running`. If a newer commit superseded it while the model was working, the result is discarded and the old commit's check closes as `neutral`.
**Why:** Two pushes a few seconds apart start two reviews. Without the condition, the older one finished later and set its status back to `completed`, so an outdated review showed up as open next to the current one.
**Rejected:** Cancelling the older model call. There is no handle on a call running in another serverless invocation, and the conditional update is one line of SQL.

## 31. Closed pull requests are hidden, not deleted
**What:** A `closed` webhook sets `closed_at` on the pull request. The dashboard lists only reviews of open pull requests. Any later event for the same pull request clears it.
**Why:** Merged and abandoned pull requests otherwise sit in "waiting for your decision" forever. Keeping the rows means a reopened pull request shows its review again without paying for a new one.
**Rejected:** Marking the reviews superseded on close. A reopen of the same commit would then find a superseded review and never run or show one.

## 32. Model text is neutralized before it goes to GitHub
**What:** Finding text and the summary pass through `neutralizeForGithub`: `@name` becomes inline code and `![` is escaped. The reviewer's own note is posted as written.
**Why:** The code under review shapes what the model writes, and GitHub acts on what is posted. A pull request could otherwise get the reviewer to notify users or teams, or to embed an image that loads from someone's server for every reader. A human confirms each finding, but a mention buried in a paragraph is easy to miss.
**Rejected:** Asking the model not to write mentions. That is the same channel the attack uses.

## 33. The diff size limit is 120,000 characters
**What:** `MAX_DIFF_CHARS` defaults to 120,000 (about 30,000 tokens), up from 60,000.
**Why:** The first limit was a guess. A feature pull request in this repository with 30 files and its tests came to 73,000 characters, and Second Look answered "too large, split it" to its own change. A limit that rejects ordinary pull requests trains people to ignore the message.
**Rejected:** Removing the limit. One model call has to finish inside the function's time budget, and cost should have a ceiling.
**Still missing:** Reviewing a large pull request in parts. Above the limit the answer is still "split it".

## 34. Publishing asks who makes the fixes
**What:** The publish form has two choices. *Send back to the author* posts the findings with a fix prompt. *I will fix it myself* tells the author to do nothing and gives the reviewer a checkout command and a prompt for their own agent. The choice is stored on the review.
**Why:** These are the two things a reviewer actually does after reading a pull request from a non-engineer. Sometimes explaining the fix costs more than making it. Without the second mode the reviewer either posted "action required" at someone who could not act, or fixed it silently and left the author wondering.
**Rejected:** A free-text note for the reviewer to say so. The check run and the dashboard could not then tell the two cases apart.

## 35. The fix prompt is a template, not a model call
**What:** `buildFixPrompt` assembles the prompt from the confirmed findings with string code: file, lines, problem, suggested fix, and a fixed set of rules.
**Why:** It is predictable, free, and the reviewer can read exactly what will be sent before publishing. A second model call would add cost, delay, and one more output to check.
**Risk:** The finding text was written by a model about untrusted code and is now pasted into another AI tool. A human confirmed each finding first, the prompt tells the tool to treat findings as descriptions of problems, and the fence around it on GitHub cannot be closed from inside. That lowers the risk; it does not remove it.

## 36. A new review inherits the reviewer's earlier decisions
**What:** When a pull request is reviewed again, the prompt includes the findings the reviewer confirmed in the latest published review and the findings they rejected in any earlier one. The model returns a verdict for each confirmed finding and is told not to raise rejected ones again.
**Why:** Without this, the second review could repeat a finding the reviewer had already turned down, and the reviewer had to compare two commits by hand to see what was fixed. The brief listed "rejection reasons fed back into the prompt" as later work; this is that, limited to one pull request.
**Rejected:** Matching old and new findings in code by file and line. Lines move between commits, and "is this the same problem" is a judgement the model is better placed to make.
**Limit:** The verdicts are the model's reading. A finding the model skips is shown as "cannot tell", never as fixed.

## 37. The diff of an earlier round is rebuilt from the commit
**What:** A review of the newest commit shows the pull request's diff. A review of an older commit shows `base...thatCommit` from GitHub's compare API. The base branch is stored on the pull request for this.
**Why:** GitHub's pull request diff is always the current one. Shown next to an older review, it put findings beside code they were not written about.
**Rejected:** Storing every diff. Decision 11 (code under review is not stored) still holds.

## 38. The diff is cached per commit, in memory
**What:** `getReviewDiff` keeps diffs for five minutes, keyed by repository, pull request, and commit.
**Why:** The review page re-renders after every Confirm or Reject and was asking GitHub for the same diff each time, so every click waited on a network round trip.
**Rejected:** A shared cache such as Redis. A cold serverless instance costs one extra request, which does not justify a new service.

## 39. A reviewer can write a finding, and it starts confirmed
**What:** Clicking a line number in the diff opens a form for the reviewer's own finding. It is stored with `source = human` and `status = confirmed`. It can be edited in place or removed; it is never "rejected".
**Why:** The first pass misses things, and a reviewer who spots one should not have to leave the tool and comment on GitHub separately. A finding the reviewer wrote needs nobody's confirmation, least of all their own, so it does not hold up publishing.
**Rejected:** Creating it as pending and making the reviewer confirm it, for symmetry with AI findings. That is a click with no decision in it.
**Details:** The file must be one the pull request changes, checked against the diff from GitHub. AI findings can be rejected but not deleted, so the decision stays on record; human findings can be deleted because there is nothing to keep a record of.

## 40. Site navigation is in the top bar only
**What:** Every page has the same top bar with the links that go to other pages. The playground's left pane holds only controls that change what the right pane shows.
**Why:** The first layout put the site links inside the playground's side panel, next to the example list. They looked like tabs for the panel and then left the page. Other playgrounds and review tools keep global navigation at the top and use side panels for things local to the page.
**Rejected:** Keeping the links in the panel and restyling them. The problem was where they were, not how they looked.

## 41. Rejecting is one click, and the reason is asked afterwards
**What:** Reject no longer opens a form. The finding is rejected at once and folds to one line, with the common reasons under it as one-click chips. Picking one is optional. A decided finding of any kind folds to one line and opens again on click.
**Why:** Going through a real review, most rejections were obvious and the form made each one three steps. A long review also stayed long: decided findings took as much room as pending ones, so it was hard to see what was left.
**Rejected:** Requiring a reason. It is useful (the next review is told not to raise the finding again either way, and the reason is there for the reviewer's own record), but a required field on the most common action gets filled with noise.
**Details:** In the dashboard each chip is a submit button that carries its reason, so it works without JavaScript like the rest of the page.

## 42. Publish controls are disabled while a finding is pending, and say why
**What:** Every control that leads to publishing (the playground's second tab and its two buttons, the dashboard's top-bar button and the button in the publish form) is disabled while any finding is pending. Hovering one shows the reason: how many findings are pending and that each needs to be confirmed, rejected, or edited first. The text comes from one function, `publishBlockedReason`.
**Why:** The earlier layout let the reviewer reach the publish step and only then told them it would not work. A control that cannot do anything should look that way and explain itself where the pointer is.
**Details:** The tooltip is on a wrapper element, because a disabled button fires no mouse events of its own and the browser's built-in `title` tooltip takes over a second to appear. The server still refuses to publish with a pending finding; the disabled button is for the reviewer, not for safety.

## 43. The playground has a Publish button that publishes nothing
**What:** The playground's second step ends in a "Publish review" button. Pressing it posts nothing and stores nothing. It shows a confirmation, locks the findings as a real publish does, and lists what happens next on a real pull request.
**Why:** Without it the walk-through stopped at a preview, and it was not clear that publishing is a separate, deliberate act by the reviewer. That act is the point of the product.
**Risk:** A visitor could think something was sent. The button's caption, the confirmation, and the result all say "simulated" and that nothing left the browser.

## 44. Someone else tries the product by being added to the sample repository
**What:** To let another person run a real review, they are added as a collaborator with write access to the sample repository. Nothing else is set up. The walkthrough scripts moved into that repository so they can be run from a clone of it; the two scripts here forward to them.
**Why:** The two checks that already exist do the work. A review runs only when the pull request's author has write access, because each review is a paid model call, and the dashboard shows a repository only to people with write access to it. The app is private and installed on two repositories of one account, so a guest installs nothing and none of their own repositories can be reached.
**Rejected:** Making the app public so a guest installs it on a repository of their own. That asks them to grant access to their code in order to look at a tool, and every review they start would still be paid for here.
**Rejected:** A shared demo login. It would make every decision in the audit trail belong to nobody.
**Limit:** A collaborator can push to the sample repository's main branch and can start reviews, each of which is a model call. Removing them from the repository ends both.

## 45. The playground follows a real review step by step
**What:** The playground has four steps in a bar, in the order they happen: the pull request arrives and the first pass runs, the reviewer goes through the findings, publishes, and sees what the author gets. A step opens when the one before it is finished and says why when it cannot be opened. It replaces decision 43's two-step layout.
**Why:** The first version opened on the findings and put publishing in a second tab. Someone who had then used the real dashboard said the two did not match: the real thing has an arriving pull request, a running first pass, a publish form, and a result on GitHub, in that order.
**Details:** Each step uses what the real app uses: the dashboard's progress panel, `checkRunFor` for the check text, the publish form's fields, and `buildReviewParts` for what is posted. For a saved example the first pass is replayed in about three seconds, and the page says it is a replay. The second round is not simulated; the last step links to real pull requests that went through one.
**Rejected:** Making up a second-round result for each example. The examples are saved output of real runs, and an invented follow-up next to them would not be.

## 46. The fix prompt is shown open, in the dashboard and on GitHub
**What:** The fix prompt is expanded by default wherever it appears. In the GitHub review it has its own heading and the `details` element is open.
**Why:** It was folded in both places. A reviewer who had just published looked for it on the pull request and did not find it. Text that is about to be sent, or that the author is meant to act on, should not need a click to be seen.
**Cost:** The review body is longer. The prompt stays in a `details` element so the reader can fold it.

## 47. The page says when the last finding is decided
**What:** The decision that leaves no finding pending shows a short message with a link to publish. "Next pending" is disabled from then on. In the dashboard the server action reports that moment (`allDecided`) and the page reads it from the URL once.
**Why:** After the last decision nothing on the page changed except a number, and the reviewer had to notice that the count had reached zero to know they were done.
**Details:** Changing an earlier decision does not show the message again, because nothing was finished by it.

## 48. The dark theme mirrors the colour scales
**What:** There is a dark theme, chosen by the system setting or by the button in the top bar (remembered in the browser). It is one block of CSS that redefines the colour scales the components already use, mirrored: `slate-900` becomes nearly white, `slate-50` nearly black, and `white` dark.
**Why:** Components name colours by scale step (`bg-slate-900` for a solid button, `bg-red-50` for a tinted panel). Mirroring the scales turns every one of them at once and keeps contrast pairs together: white text on a slate-900 button becomes dark text on a light button. The other way is a `dark:` class beside every colour class in every component, which is hundreds of edits and easy to miss one.
**Limit:** Only the steps in use are redefined. A component that starts using a new step needs a line in the dark block, or that colour stays light. A short script in the page head sets the theme before first paint, so the page does not flash; with scripts off, the page is light.

## 49. Reviewers' decisions are added up on an insights page
**What:** `/dashboard/insights` shows, for the repositories the signed-in user may review: how many first-pass findings were decided, the share confirmed, how many were rewritten before sending, how many findings reviewers added themselves, the same share by severity and by category, the reasons given for rejections, and how many sent findings were fixed by the next push.
**Why:** Every Confirm and Reject is a judgement on the first pass by the person best placed to make it, and it was being stored and never read. A category with a low confirmed share is a place to tighten the prompt or the team rules; findings added by reviewers are what the first pass misses.
**Details:** Only published reviews count, because a decision can change until then. Findings a reviewer wrote are left out of the confirmed share: they are always confirmed and would flatter it. The page reads the database only and calls no model.
**Limit:** The numbers are small on a new installation, and a share of a handful of findings says little. The page shows the counts next to every share for that reason.

## 50. Rejecting every finding is an approval
**What:** When nothing is pending and nothing is confirmed, the publish step becomes "Approve: no changes needed". The review posted to GitHub says so in its first line, carries the reviewer's note if any, and nothing else; the check passes with "No changes needed". The dashboard list and the rounds strip say "approved, no changes".
**Why:** Before, a reviewer who turned down every finding was shown the same publish form, with "who makes the fixes?" gone and a button that said "Publish review" over nothing. It was not clear that this is the good outcome: the change is fine as it is.
**Details:** The first pass's summary is left out of an approval. It is written before the reviewer decides and often names the problems the reviewer turned down, so under "No changes needed" it read as a contradiction. The review is still posted as a comment, not a GitHub approval: an app's approval does not count towards required reviews, and the passing check is what branch protection reads.

## 51. Writing your own finding is pointed out, not only available
**What:** The "+" beside each line number is faintly visible on every line instead of appearing only on hover, and fully visible on touch screens, which have no hover. A tip above the code says the first pass can miss things and how to add a finding; it goes away when dismissed or when the reviewer adds one, and the browser remembers. After the last decision the bottom bar asks whether anything was missed before publishing, and the approve step offers to go back and add one.
**Why:** People using the product went through the AI's findings and did not know they could write their own. A control that appears only on hover is found by people who already know it is there; other review tools get the same complaint about their line-comment buttons.

## 52. Success messages look like success
**What:** Toasts are green with a check icon and a close button, and carry at most one action, styled as a small outlined button. A toast with an action stays twelve seconds instead of six.
**Why:** The first version was a dark box with white text, the same look many products use for errors. The green-and-check convention is what most design systems use for a positive message, and it does not rely on colour alone because of the icon.

## 53. A failed review can be run again from its page
**What:** A review that failed, or has been "running" far longer than any review takes, shows "Run the review again". It reads the pull request from GitHub as it is now and starts the same run a webhook starts. The button waits only until the run has claimed the review, then returns to the page, which shows it running.
**Why:** The only way to retry was to close and reopen the pull request, which notifies everyone watching it and is not something a reviewer should have to do to the author's pull request.
**Rules:** Only failed or stuck reviews, so a finished review is never paid for twice by a stray click. Only for reviewers with write access, the same check as every other action. Not for a closed pull request. The run goes through the same claim as a webhook, so a webhook and a click for the same commit cannot both run.

## 54. Access answers are remembered for a minute
**What:** The dashboard keeps GitHub's answer to "does this login have write access to this repository" for sixty seconds, per server instance. The webhook's check on the pull request's author is not cached; it runs once per push.
**Why:** Every page and every Confirm or Reject asked GitHub. With a few hundred reviewers that is a steady drain on the installation's rate limit (5,000 requests an hour for most installations), and each click waited on a round trip to GitHub.
**Cost:** Someone removed from a repository can keep using its reviews for up to a minute, and someone just added waits up to a minute. Both are acceptable for a review tool; neither would be for a payment system.
**Rejected:** A shared cache such as Redis, so that every instance agrees. A cold instance asking GitHub once more is cheaper than a new service.

## 55. Every change to a finding is recorded
**What:** A `finding_events` table gets a row for every confirm, reject (with its reason), undo, rewrite, added finding, and removed finding, with who did it and when. The review page lists them under "Activity on this review".
**Why:** The finding row holds only where a finding ended up. With several reviewers on one repository, "who rejected this, and had someone confirmed it first?" had no answer, and a removed finding left no trace at all.
**Details:** `finding_id` is deliberately not a foreign key, so the record of a removed finding survives the finding. The event is written after the change, as a second statement, because the Neon HTTP driver has no transactions; if that write fails the change stands without its record, which is better than a reviewer's click failing. The table holds no code and no finding text, only who, what, when, and a rejection reason.
**Migration:** additive (one enum, one table). Existing decisions have no history; the activity list starts from the day this shipped.

## 56. A pull request too large to review whole is reviewed in part
**What:** When the reviewable diff is over the size limit, the first pass takes files in order of risk until the limit is reached, reviews those, and lists the rest at the top of the reviewer's double-check list as not reviewed. The model is told which files were left out and not to guess about them; their names go in a tagged section like any other text the author controls. Only when not even one file fits is the review "too large".
**Why:** Before, a pull request over the limit got no review at all and a message to split it. A non-engineer with an AI tool does not split pull requests, and the reviewer then had nothing to start from. The files most likely to cost money when wrong are a small part of most large pull requests.
**Ranking:** A fixed list of path patterns: migrations and SQL first, then authentication, permissions and tenancy, then controllers, handlers and routes, then data access, then deployment configuration, then other code; tests, fixtures and documentation last. A test of an auth module counts as a test. Fixed patterns rather than a model call, so the choice is free, the same every time, and can be explained in one sentence.
**Limit:** A risky change in a file with an ordinary name can be left out. The reviewer is told by name which files the first pass did not read.


# Writing `.second-look.md`

Second Look reads `.second-look.md` from the root of your repository's main branch and gives it to the first pass as your team's rules. Findings cite the rule they break. It is read from the main branch, not from the pull request, so a pull request cannot change the rules that review it.

## What makes a good rule

- **Specific to your code.** "Queries go through `src/db/queries.ts`" helps; "write clean code" does not.
- **Checkable from a diff.** The first pass sees the changed lines and the changed files. A rule about how a service behaves at runtime is hard for it to check.
- **Says what to report, or what not to.** Rules can also turn noise down: "Do not ask for tests on configuration changes."
- **Short.** A screenful is plenty. The whole file goes into every review.

Rules cannot switch off security, access-control, or data-loss checks, and cannot change the output format.

## Starting points

Copy the one closest to your stack and edit it.

### ASP.NET Core and Entity Framework Core

```markdown
# Review rules

## Tenancy
- Every query on a tenant-owned table is limited to the current tenant. The DbContext applies a global query filter.
- `IgnoreQueryFilters()` is only allowed in `src/Admin/`.
- Raw SQL must include `TenantId` in its WHERE clause and use parameters.

## Access control
- Every controller action has an `[Authorize]` policy. Actions that change data use a `*.Write` policy.

## Migrations
- A migration keeps the data in existing rows. Renames use `RenameColumn`.
- A new required column needs a default or a backfill.
- A migration comes with its designer file and the updated model snapshot.

## General
- Times are stored in UTC.
- No connection strings, keys, or file paths in code.
```

### Next.js and TypeScript

```markdown
# Review rules

- Database access goes through `src/db/`. Flag SQL or ORM calls anywhere else.
- Every server action and route handler checks the session before reading or changing data.
- Input from outside (request bodies, query strings, webhooks) is validated with Zod.
- Never log tokens, request bodies, or user data.
- A component that renders user-supplied HTML is a security finding.
- Do not report formatting or naming preferences.
```

### Python and Django

```markdown
# Review rules

- Every view that reads or changes another user's data checks ownership, not only login.
- Queries use the ORM or parameters. No string formatting into SQL.
- A migration that removes or renames a column says what happens to existing rows.
- Settings come from the environment. No secrets in `settings.py`.
- Celery tasks handle failure: no bare `except`, and a retry limit.
```

## Tuning it over time

The dashboard's insights page shows which kinds of finding reviewers keep rejecting and suggests a line to add for each, with the numbers behind it. Add the ones you agree with, on the main branch, where the team can see the change.

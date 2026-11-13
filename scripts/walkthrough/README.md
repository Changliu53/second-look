# Walkthrough kit

Two scripts that run the whole Second Look flow against a sample repository,
with real pull requests, so you can see every step without writing a buggy
change by hand.

The target is [fieldops-platform-sample](https://github.com/Changliu53/fieldops-platform-sample),
a small ASP.NET Core and EF Core service with tenancy rules. Clone it next to
this repository, install the Second Look GitHub App on it, and sign in to the
`gh` CLI.

```
scripts/walkthrough/open-pr.sh work-order-export
```

opens a pull request the way a non-engineer using an AI tool might: it works
on their machine and breaks platform rules. Then:

1. Watch it appear in the dashboard and the first pass run.
2. Confirm or reject the findings and publish, sending it back to the author.
3. Play the author:
   ```
   scripts/walkthrough/push-fix.sh work-order-export
   ```
   pushes the fixes. A new review starts and says which findings are fixed.
4. Publish again. The check on the pull request turns green.

To try the other publish mode, choose "I will fix it myself" in step 2. The
dashboard then gives you a checkout command and a prompt for a coding agent.

## Scenarios

| Name | What the change does | What is wrong with it |
|---|---|---|
| `work-order-export` | Adds a CSV export of work orders | Turns off the tenant filter, has no authorization policy, writes a file to a fixed path on the server, builds CSV by hand |
| `rename-customer-phone` | Renames a column | Written as drop then add, so existing phone numbers are deleted. No designer file or snapshot change |

Each scenario folder has `change/` (the first commit), `fix/` (the author's
second commit), `title.txt`, and `body.md`. Files are copied over the sample
repository as they are, so adding a scenario is adding a folder.

Set `SAMPLE_REPO_DIR` if the sample repository is somewhere else. Set
`DRY_RUN=1` to commit locally without pushing or opening a pull request.

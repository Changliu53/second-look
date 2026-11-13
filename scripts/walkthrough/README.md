# Walkthrough

The walkthrough kit runs the whole Second Look flow with real pull requests:
open one, review it, publish, push a fix, review again.

It lives in the sample repository,
[fieldops-platform-sample/walkthrough](https://github.com/Changliu53/fieldops-platform-sample/tree/main/walkthrough),
so that anyone with write access to that repository can run it from a clone,
without this repository. Its README lists the steps and the scenarios.

The two scripts here forward to it, for when both repositories are cloned
side by side:

```
scripts/walkthrough/open-pr.sh work-order-export
scripts/walkthrough/push-fix.sh work-order-export
```

Set `SAMPLE_REPO_DIR` if the sample repository is somewhere else.

## Letting someone else try it

Add them to the sample repository as a collaborator with write access. That
is all: they install nothing, and the app is installed on none of their
repositories. A review runs for a pull request only when its author has write
access, and the dashboard shows a repository only to people with write access
to it. The sample repository's README has the steps and
[what access this involves](https://github.com/Changliu53/fieldops-platform-sample#what-access-this-involves).

Each review they start is a model call on your API key. A pull request on the
sample repository has cost a few cents.

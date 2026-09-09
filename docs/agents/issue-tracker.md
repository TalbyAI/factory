# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`
- **Read an issue**: `gh issue view <number> --comments`
- **List issues**: use `gh issue list` with appropriate state and label filters
- **Comment**: `gh issue comment <number> --body "..."`
- **Apply/remove labels**: use `gh issue edit`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`; `gh` does this automatically inside the clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Pull request linking

- Use `Closes #<work issue>` for the issue whose work the pull request delivers.
- Use `Part of #<parent issue>` for a longer-running parent such as a Wayfinder Map.
- Close the parent only when its own completion contract is satisfied, never merely because one child pull request merged.

## Issue closure with repository changes

Before closing an issue, inspect both the working tree (`git status --short`) and the branch delta (`git diff origin/main...HEAD`). If the issue has associated committed or uncommitted repository changes:

- Keep the issue open and propose a pull request from the working branch.
- Include all changes associated with the issue in that pull request, committing uncommitted changes on the working branch first.
- Link the issue with `Closes #<work issue>` (and use `Part of #<parent issue>` when applicable).
- Do not run `gh issue close`; the original issue closes only after the pull request is reviewed, approved, and merged through GitHub.

Directly close an issue only when it has no associated repository changes, or when the user explicitly requests an exception.

## Skill operations

- “Publish to the issue tracker”: create a GitHub issue.
- “Fetch the relevant ticket”: run `gh issue view <number> --comments`.

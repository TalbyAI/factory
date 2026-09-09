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

Directly close an issue only when it has no associated repository changes.

## Prototype issue workflow

A Prototype Artifact committed to this repository is an associated repository change. “Throwaway” describes its production status, not permission to discard it or bypass integration.

For a prototype linked to an issue:

1. Preserve the Artifact and its report on a `prototype/*` branch.
2. Open a pull request containing the prototype, with `Closes #<prototype issue>` and, for a Wayfinder child, `Part of #<map issue>`.
3. Update the prototype issue body with the observed results, evidence links, proposed verdict, and pull request.
4. Keep the issue open while the pull request is reviewed. Let the merge close it through the `Closes` link.
5. After merge and closure, append the decision pointer to the Wayfinder map.

Do not delete the Artifact or manufacture an empty branch delta merely to make direct issue closure permissible. If the Artifact should not enter `main`, preserve it and ask the user to choose a repository-native archive or a different PR destination before closing the issue.

## Skill operations

- “Publish to the issue tracker”: create a GitHub issue.
- “Fetch the relevant ticket”: run `gh issue view <number> --comments`.

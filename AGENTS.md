## Agent skills

### Issue tracker and pull requests

Issues are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.
Before closing an issue, follow the `Issue closure with repository changes` section there.

Treat `main` as protected: make every repository change on a branch and merge it through a pull request.

### Domain docs

This repository uses a single-context layout. See `docs/agents/domain.md`.

### Integration workflow

- `main` is the protected integration branch. Before editing files or creating commits, run `git branch --show-current`; if it returns `main`, first create or switch to a working branch (`feature/*`, `fix/*`, `docs/*`, `prototype/*`, or `chore/*`).
- Changes are integrated into `main` through a Pull Request or an equivalent operation performed on GitHub. Do not update the remote with `git push origin main`, or perform a local merge that is later published directly to `main`.
- Keep all related commits and changes on the working branch. Before opening the Pull Request, verify `git status --short` and `git diff origin/main...HEAD`.
- If local `main` contains commits that are not yet in `origin/main`, first create a branch pointing to the current commit to preserve them. Reset `main` only after confirming that the working tree is clean and that the target is the expected `origin/main` commit; never use this maintenance to discard unpreserved work.

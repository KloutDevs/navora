# Contributing to Navora

Thanks for contributing to Navora.

## Development setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Run quality checks:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   ```

## Branching and pull requests

- Create focused branches for each change.
- Keep pull requests small and reviewable.
- Include tests when behavior changes.
- Update docs when adding features or changing workflows.

## Commit expectations

- Use clear commit messages that explain intent.
- Avoid unrelated changes in the same commit.

## Coding guidelines

- Follow existing monorepo package boundaries.
- Prefer explicit `Result<T, E>` handling over thrown async errors.
- Keep tool pipeline behavior consistent when adding new tools.

## Before opening a PR

- Confirm all tests pass locally.
- Confirm lint and typecheck pass.
- Describe the problem, approach, and verification steps in the PR.

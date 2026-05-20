# AGENTS.md

## Current branch context

The current working branch is:

revise

This branch is based on the current team main at:

ca68130 Merge pull request #16 from static-analysis

Do not assume old branch structure. Inspect the current branch before editing.

## Static analysis setup

Use these static-analysis tools:

- Formatter: Prettier
- Linter: ESLint through the project lint script
- Security analysis: npm audit

GitHub Actions enforces formatting, linting, security analysis, unit tests, and smoke tests.

Every pull request must be reviewed by at least one other team member before merging.
Codex may commit and push branches after required checks pass.
Codex must not merge pull requests.

## Git workflow

After implementing a task:

1. Run npm run static.
2. Run npm test.
3. Run npm run smoke.
4. If static analysis and tests pass, create a commit with a clear message.
5. Push the current feature branch to origin.

Use:

git status
git add .
git commit -m "Clear message here"
git push origin HEAD

Do not push if static-analysis checks fail.
Do not push if npm test or npm run smoke fails.
Do not force push.
Do not rewrite history.
Do not commit node_modules, coverage, playwright reports, or test output.
Codex may commit and push to a feature branch after checks pass.
Codex must not merge pull requests.
Every pull request must be reviewed by at least one other team member before merging.

## Project

This is FocusKit, a Manifest V3 Chrome extension.

## Required checks before saying done

Before coding, add or update tests that prove this feature works. Then implement the feature. Then run npm test and npm run smoke. Do not say done unless both pass.

Run these commands before completing any task:

npm ci
npm run static
npm test
npm run smoke

If any command fails, fix the issue and rerun the failing command.

## Known existing failures

These are known failures on the current main-based revise branch and should be fixed in separate commits:

- `npm test` fails because `storage.js` is missing the required file-level comment checked by `tools.test.js`.
- `npm run smoke` fails because Pomodoro persistence is broken: after reopening Pomodoro, the smoke test expected persisted `24:59` but the popup showed `25:00`.

Do not weaken or delete failing tests.
Do not hide these failures by lowering test expectations.
Fix known failures in separate commits.

## Extension rules

Do not leave placeholder endpoints.
Do not use api.example.com.
Do not put Jest test code inside runtime files.
Do not load test files from popup.html.
Do not add broad permissions unless the feature needs them.
Do not claim the popup works unless npm run smoke passes.

## Runtime acceptance

The popup must open without console errors.
Tools tab must show Pomodoro, Iris, and Eisenhower.
Focus tab must show at least three focus modes.
Settings must save and restore.
Selected focus mode must save and restore.

## Testing expectations

Use Jest for unit tests.
Use Playwright for extension smoke tests.
Mock chrome APIs in unit tests.
Use real Chromium extension loading for smoke tests.

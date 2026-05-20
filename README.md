# Extention-skeleton

## Static analysis and review

This project uses Prettier as the formatter. Run `npm run format` to format
tracked source, test, configuration, and documentation files, or
`npm run format:check` to verify formatting without changing files.

This project uses ESLint through the existing project lint script:
`npm run lint`.

This project uses npm audit for dependency security analysis through
`npm run security`.

GitHub Actions enforces the static-analysis and test rules in
`.github/workflows/ci.yml`. The workflow runs:

```bash
npm ci
npm run format:check
npm run lint
npm run security
npm test
npm run smoke
```

Every pull request must be reviewed by at least one other team member before
merging.

## Flask Docker Server

This is a minimal RESTful Flask API for the Docker/Flask assignment. It is
intentionally separate from the Chrome extension.

Build the Flask API image:

```bash
docker build -t focuskit-flask-server ./flask-server
```

Run the server:

```bash
docker run --rm -p 5000:5000 focuskit-flask-server
```

The API should be visible at:

http://localhost:5000

The health endpoint should be visible at:

http://localhost:5000/api/health

Example REST API requests:

```bash
curl http://localhost:5000/api/health
curl http://localhost:5000/api/tasks
curl -X POST http://localhost:5000/api/tasks -H "Content-Type: application/json" -d "{\"title\":\"Plan focus session\"}"
curl http://localhost:5000/api/tasks/1
curl -X PUT http://localhost:5000/api/tasks/1 -H "Content-Type: application/json" -d "{\"completed\":true}"
curl -X DELETE http://localhost:5000/api/tasks/1
```

## CI/CD Deployment Pipeline

This project uses a hand-built PowerShell deployment script for the sprint
deployment assignment. The local Docker container is the production deployment
environment for this assignment.

The deployment script fetches the latest team `main` branch and fast-forwards
the current branch when possible. During PR testing, run the script from a
branch that already contains the Flask Docker server files. After the PR is
merged, running the script from `main` will pull the latest `main` and deploy
the current production container.

The first deployment test failed because the script pulled `upstream/main`
before the Flask Docker files had been merged. The script now keeps the current
branch, fast-forwards only when safe, and stops with a clear error if
`flask-server` is missing.

Before running the script:

- Docker Desktop must be running.
- Node/npm must be installed.
- The `upstream` remote must point to the team repo.

Run the deployment pipeline:

```bash
powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1
```

The script:

- fetches latest team `main`
- fast-forwards the current branch when possible
- runs static analysis
- runs tests
- builds the Docker image
- deploys the container
- verifies `/api/health`

Production URL:

http://localhost:5000

Health check URL:

http://localhost:5000/api/health

## PR Links Accepted In The Past Week

- PR #20:
  https://github.com/Sp2026-CSS-360-Group-Project/Extention-skeleton/pull/20

PRs must pass static analysis and be reviewed by at least one other teammate
before merging.

This repo will be the base of our chrome extentions

To test and use this you will have to follow these steps.

download node js v24.15.0 LTS for (your pc model) using nvm with npm from https://nodejs.org/en/download
Then I used npm install --save-dev @types/chrome in the terminal to install type definitions for Chrome's extension APIs
After that i used npm test to run the tests

Smoke test note:

- `npm run smoke` intermittently times out or sees the Pomodoro UI stay on `Paused` right after `Start`.
- I reproduced the issue with a Playwright debug script and confirmed the popup renders, the service worker loads, and the Pomodoro flow can lag between the popup and background state updates.
- I also checked runtime messaging, storage sync, and service-worker wake timing while tracing the popup flow.

For testing on google chrome i first went to the three dots dropdown and clicked on manage extentions
then I clicked on developer mode
then used load unpacked to put in my code
after that just test

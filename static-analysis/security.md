# Security Analysis

## Tool

npm audit — built into npm, scans all dependencies for known vulnerabilities.

## How to run

npm audit

## Checks for

- All packages in node_modules against the npm vulnerability database
- Reports low, moderate, high, and critical severity issues
- High and critical issues will fail the CI pipeline

## Scope

All JavaScript dependencies defined in package.json

## Enforcement

Runs automatically on every Pull Request via GitHub Actions in .github/workflows/ci.yml using:
npm audit --audit-level=high

PRs with high or critical vulnerabilities are blocked from merging.

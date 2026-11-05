# GitHub Copilot Instructions

## IMPORTANT: Keep Tasks Focused

Do NOT scan or analyze the entire project before completing a task.

For every request:

1. Understand what the user wants.
2. Find the files directly related to the request.
3. Read only the relevant code.
4. Make the required changes.
5. Check the relevant code for errors.
6. Stop when the task is complete.

## Do NOT Automatically Inspect

Do not automatically inspect:

- node_modules
- every package in package.json
- package-lock.json
- the entire src folder
- unrelated components
- unrelated configuration files
- the entire dependency tree
- the entire project structure

Only inspect these when they are actually relevant to the requested task.

## Dependency Rule

Only investigate a package/dependency if:

- The requested code directly uses it.
- The requested change depends on it.
- An error specifically involves it.
- The user asks about it.

First inspect how the package is used in the project before investigating the package itself.

## Simple Tasks

For simple tasks such as:

- changing colors
- changing text
- fixing spacing
- changing a button
- changing a layout
- editing a component
- fixing a small UI bug

Do NOT perform a full project analysis.

Find the relevant file, make the change, and verify it.

## Do Not Change Unrelated Code

Do not modify files unrelated to the user's request.

Do not refactor unrelated code.

Do not install, remove, upgrade, or downgrade packages unless the task requires it or the user explicitly asks for it.

## Testing

Run only the tests, builds, or checks relevant to the requested change.

Do not run the entire test suite for a small unrelated change.

## Priority

Prioritize:

1. Correctness
2. The user's requested task
3. Minimal file inspection
4. Minimal changes
5. Fast execution

Do not perform unnecessary investigation just to be thorough.
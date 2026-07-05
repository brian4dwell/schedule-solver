Every line of code should do exactly one thing and use intermediate variables as a form of documentation
Don't add fallback unless you ask or are told to
Don't use dictionaries to pass data back and forth if you can easily add a structure with more meaning and compliletime safety, only use dictionaries when the keys are unknown for very unstable
Prefer Zod contracts for data validation and boundary definitions, and use them when appropriate.
Follow the repo coding standards in docs/architecture/coding_standards.md.
For frontend workflow feedback, use the app-wide toast system in apps/web/components/ui/toast-provider.tsx through useToast(), and keep inline messages for form or row-specific context.
Python tooling is managed with uv in this repo. Run Python commands through uv run ....
Do not invoke bare pytest; always use uv run pytest (or uv run python -m pytest) so PATH does not matter.
Don't auto deploy to fly.io unless I specifically ask you to, we are often working on features and don't want them deployed all the time right away.
When starting local dev servers or other long-running debug processes, do not write stdout/stderr log files into the repo root; use the terminal session output or a temp directory outside the repo.

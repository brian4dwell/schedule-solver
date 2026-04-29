Every line of code should do exactly one thing and use intermediate variables as a form of documentation
Don't add fallback unless you ask or are told to
Don't use dictionaries to pass data back and forth if you can easily add a structure with more meaning and compliletime safety, only use dictionaries when the keys are unknown for very unstable
Prefer Zod contracts for data validation and boundary definitions, and use them when appropriate.
Follow the repo coding standards in docs/architecture/coding_standards.md.
Python tooling is managed with uv in this repo. Run Python commands through uv run ....
Do not invoke bare pytest; always use uv run pytest (or uv run python -m pytest) so PATH does not matter.
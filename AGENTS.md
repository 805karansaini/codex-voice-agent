# Repository Guidelines

## Project Structure & Module Organization

This repo is a local voice app with a Python backend and a React frontend. Backend code lives in `backend/app`, with FastAPI routes, settings, history storage, Gemini integration, and Codex orchestration split into focused modules. Backend tests live in `tests/`. Frontend code lives in `frontend/src`, with hooks in `hooks`, UI in `components`, helpers in `utils`, and styles in `styles.css`. Frontend unit tests live in `frontend/tests`. Product notes and architecture references are in `PRODUCT_REVIEW.md`, `PRODUCT_PROGRESS.md`, and `docs/`.

## Build, Test, and Development Commands

- `uv sync`: install Python dependencies from `pyproject.toml` and `uv.lock`.
- `uv run ./run.py`: start the backend on the local API port.
- `uv run pytest`: run the backend test suite.
- `uv run ruff check backend tests`: lint Python files.
- `uv run pyright`: type-check backend code and tests.
- `cd frontend && npm install`: install JavaScript dependencies.
- `cd frontend && npm run dev`: start the Vite development server.
- `cd frontend && npm run build`: type-check and build the frontend.
- `cd frontend && npm run lint`: run ESLint.
- `cd frontend && npm run format:check`: verify Prettier formatting.

## Coding Style & Naming Conventions

Python targets 3.11, uses Ruff with a 100-character line length, and treats `backend` as first-party imports. Prefer clear module-level functions and typed Pydantic models for API-shaped data. Frontend code uses TypeScript, React function components, hooks named `useSomething`, and component files in `PascalCase.tsx`. Keep utility files small and named for the behavior they own, such as `history.ts` or `artifacts.ts`.

## Testing Guidelines

Add or update tests when changing behavior. Backend tests use `pytest` and follow `tests/test_*.py`. Frontend tests use Node's built-in test runner style and live in `frontend/tests/*.test.ts`. For UI changes, also run `npm run build` and check the page in a browser.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries such as `Persist Codex thread mappings` or `Finalize voice turns when muting`. Keep commits focused and include matching test or docs updates. Pull requests should explain the user-visible change, list verification commands, mention configuration changes, and include screenshots or recordings for visible frontend changes.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local setup. Never commit API keys, Codex tokens, local databases, logs, or generated data from `backend/data`. Keep Google GenAI SDK updates intentional because the Live API surface changes quickly.

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .codex_runner import run_codex
from .gemini_agent import ask_gemini
from .history import HistoryStore
from .settings import get_settings


settings = get_settings()
history = HistoryStore(settings.history_path)

app = FastAPI(title="Codex Voice Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173", "http://0.0.0.0:5173"],
    allow_origin_regex=r"http://(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):5173",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


class CodexRequest(BaseModel):
    task: str
    workdir: str | None = None


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "gemini_model": settings.gemini_model,
        "has_google_api_key": bool(settings.google_api_key),
        "codex_default_workdir": settings.codex_default_workdir,
    }


@app.get("/api/history")
async def list_history() -> list[dict[str, object]]:
    return history.list()


@app.post("/api/chat")
async def chat(req: ChatRequest) -> dict[str, object]:
    text = req.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message is required")
    history.append("user", text)
    try:
        result = await ask_gemini(text, settings)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    history.append("assistant", result["reply"], {"tool_calls": result["tool_calls"]})
    return result


@app.post("/api/codex")
async def codex(req: CodexRequest) -> dict[str, object]:
    task = req.task.strip()
    if not task:
        raise HTTPException(status_code=400, detail="Task is required")
    workdir = req.workdir or settings.codex_default_workdir
    history.append("user", task, {"direct_codex": True, "workdir": workdir})
    try:
        result = await run_codex(task, workdir, settings)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    history.append("assistant", result.final_response, {"direct_codex": True, "workdir": result.workdir})
    return {"reply": result.final_response, "workdir": result.workdir}

#!/usr/bin/env python3

import os

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "backend.app.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8765")),
        reload=False,
        log_level=os.getenv("LOG_LEVEL", "info"),
    )

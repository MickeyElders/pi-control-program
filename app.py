"""Application entrypoint.

The FastAPI app is implemented in backend.api_service.
This shim keeps `uvicorn app:app` compatible with existing service scripts.
"""

from backend.api_service import app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)

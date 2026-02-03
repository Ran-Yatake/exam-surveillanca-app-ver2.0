from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.routers.meetings import router as meetings_router
from app.routers.profile import router as profile_router
from app.routers.root import router as root_router
from app.routers.scheduled_meetings import router as scheduled_meetings_router
from app.routers.users import router as users_router


load_dotenv()

app = FastAPI(title="Exam Surveillance API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    init_db()


app.include_router(root_router)
app.include_router(profile_router)
app.include_router(scheduled_meetings_router)
app.include_router(users_router)
app.include_router(meetings_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


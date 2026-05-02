from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.centers import router as centers_router
from app.routers.health import router as health_router
from app.routers.providers import router as providers_router
from app.routers.provider_availability import router as provider_availability_router
from app.routers.rooms import router as rooms_router
from app.routers.schedules import router as schedules_router

app = FastAPI(title="Schedule Solver API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(centers_router)
app.include_router(rooms_router)
app.include_router(providers_router)
app.include_router(provider_availability_router)
app.include_router(schedules_router)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.centers import router as centers_router
from app.routers.fairness import router as fairness_router
from app.routers.health import router as health_router
from app.routers.preferences import router as preferences_router
from app.routers.provider_portal import admin_router as provider_portal_admin_router
from app.routers.provider_portal import provider_router as provider_portal_router
from app.routers.providers import router as providers_router
from app.routers.provider_availability import router as provider_availability_router
from app.routers.reports import router as reports_router
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
app.include_router(fairness_router)
app.include_router(centers_router)
app.include_router(rooms_router)
app.include_router(preferences_router)
app.include_router(provider_portal_admin_router)
app.include_router(provider_portal_router)
app.include_router(providers_router)
app.include_router(provider_availability_router)
app.include_router(reports_router)
app.include_router(schedules_router)

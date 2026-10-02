from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.routers.centers import create_center
from app.routers.centers import read_center
from app.routers.centers import update_center
from app.schemas.center import CenterCreate
from app.schemas.center import CenterRead
from app.schemas.center import CenterUpdate
from conftest import SchedulingDatabase


@pytest.mark.parametrize("color", ["#12abEF", "#000000", "#ffffff", None])
def test_center_color_contracts_accept_hex_colors_and_unset(color: str | None) -> None:
    created = CenterCreate(name="Center A", color=color)
    updated = CenterUpdate(color=color)

    assert created.color == color
    assert updated.color == color


@pytest.mark.parametrize("color", ["red", "#abc", "123456", "#12345g", "#1234567", "#123456\n"])
def test_center_color_contracts_reject_invalid_colors(color: str) -> None:
    with pytest.raises(ValidationError):
        CenterCreate(name="Center A", color=color)

    with pytest.raises(ValidationError):
        CenterUpdate(color=color)


def test_center_color_persists_and_can_be_cleared(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database
    request = CenterCreate(name="Colored center", color="#12abcd")
    center = create_center(request, database.session, database.organization.id)
    database.session.expire_all()
    saved = read_center(center.id, database.session, database.organization.id)
    response = CenterRead.model_validate(saved)

    assert response.color == "#12abcd"

    update_center(center.id, CenterUpdate(name="Renamed center"), database.session, database.organization.id)
    assert center.color == "#12abcd"

    update_center(center.id, CenterUpdate(color="#654321"), database.session, database.organization.id)
    database.session.expire_all()
    assert center.color == "#654321"

    update_center(center.id, CenterUpdate(color=None), database.session, database.organization.id)
    database.session.expire_all()
    assert center.color is None


def test_unconfigured_centers_have_no_color(scheduling_database: SchedulingDatabase) -> None:
    response = CenterRead.model_validate(scheduling_database.center)

    assert response.color is None


def test_center_color_update_respects_organization_boundary(scheduling_database: SchedulingDatabase) -> None:
    database = scheduling_database

    with pytest.raises(HTTPException) as error:
        update_center(database.center.id, CenterUpdate(color="#123456"), database.session, uuid4())

    assert error.value.status_code == 404
    assert database.center.color is None

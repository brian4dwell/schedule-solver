"""Preview or apply an explicit draft selection before the wall-clock migration.

uv run python -m app.cleanup_obsolete_drafts selection.json [--apply]
"""

from pathlib import Path
import argparse

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.services.scheduling.draft_cleanup import DraftCleanupSelection
from app.services.scheduling.draft_cleanup import apply_draft_cleanup
from app.services.scheduling.draft_cleanup import preview_draft_cleanup


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("selection", type=Path)
    parser.add_argument("--apply", action="store_true")
    arguments = parser.parse_args()
    selection_json = arguments.selection.read_text(encoding="utf-8")
    selection = DraftCleanupSelection.model_validate_json(selection_json)
    settings = get_settings()
    engine = create_engine(settings.database_url)

    with Session(engine, autoflush=False) as session:
        with session.begin():
            if arguments.apply:
                result = apply_draft_cleanup(selection, session)
            else:
                result = preview_draft_cleanup(selection, session)

            print(result.model_dump_json(indent=2))

    engine.dispose()


if __name__ == "__main__":
    main()

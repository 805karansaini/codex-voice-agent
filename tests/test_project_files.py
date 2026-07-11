from pathlib import Path

from backend.app.routes.workspace import file_browser_path, is_file_browser_hidden


def test_file_browser_path_stays_within_project(tmp_path: Path) -> None:
    note = tmp_path / "notes" / "revision.md"
    note.parent.mkdir()
    note.write_text("# Revision", encoding="utf-8")

    assert file_browser_path(tmp_path, "notes/revision.md") == note


def test_file_browser_path_rejects_parent_escape(tmp_path: Path) -> None:
    try:
        file_browser_path(tmp_path, "../secret.txt")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 400
    else:
        raise AssertionError("Expected a path escape to be rejected")


def test_file_browser_hides_environment_and_cache_files() -> None:
    assert is_file_browser_hidden(Path(".env"))
    assert is_file_browser_hidden(Path(".env.local"))
    assert is_file_browser_hidden(Path(".pytest_cache/lastfailed"))
    assert not is_file_browser_hidden(Path("notes/revision.md"))

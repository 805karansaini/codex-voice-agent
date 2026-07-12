from pathlib import Path

from backend.app.routes.workspace import (
    _list_project_files,
    _read_project_file,
    file_browser_path,
    is_file_browser_hidden,
)


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
    assert is_file_browser_hidden(Path(".ENV.LOCAL"))
    assert is_file_browser_hidden(Path(".GIT/config"))
    assert is_file_browser_hidden(Path("NODE_MODULES/package.json"))
    assert is_file_browser_hidden(Path(".DS_STORE"))
    assert is_file_browser_hidden(Path(".pytest_cache/lastfailed"))
    assert not is_file_browser_hidden(Path("notes/revision.md"))


def test_project_file_listing_omits_hidden_and_ignored_paths(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("SECRET=value", encoding="utf-8")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_text("private", encoding="utf-8")
    (tmp_path / "notes.md").write_text("visible", encoding="utf-8")

    result = _list_project_files(tmp_path, "")

    assert result["entries"] == [{"path": "notes.md", "is_directory": False}]


def test_direct_file_reads_reject_hidden_and_ignored_paths(tmp_path: Path) -> None:
    (tmp_path / ".env.local").write_text("SECRET=value", encoding="utf-8")
    (tmp_path / ".ENV.BACKUP").write_text("SECRET=value", encoding="utf-8")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "package.json").write_text("{}", encoding="utf-8")

    for hidden_path in (".env.local", ".ENV.BACKUP", "node_modules/package.json"):
        try:
            _read_project_file(tmp_path, hidden_path)
        except Exception as exc:
            assert getattr(exc, "status_code", None) == 404
        else:
            raise AssertionError(f"Expected {hidden_path} to be rejected")


def test_direct_folder_listing_rejects_ignored_path(tmp_path: Path) -> None:
    (tmp_path / ".git").mkdir()

    try:
        _list_project_files(tmp_path, ".git")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 404
    else:
        raise AssertionError("Expected the ignored folder to be rejected")

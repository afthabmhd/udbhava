"""Build the exact static-file allow-list into public/ for server.py."""

from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
ROOT_FILES = (
    "index.html", "events.html", "about.html", "registration.html", "404.html",
    "styles.css", "events.css", "about.css", "typography.css", "registration.css",
    "favicon.ico", "favicon.png",
)
SOURCE_ONLY_ASSETS = {
    "a.png",
    "bike-stunt-ramp-crowd.png",
    "bike-stunt-rider.png",
    "line-following-robot-cutout.png",
    "paattoholic-artist.png",
    "robot-soccer-ball.png",
    "robot-soccer-unit.png",
    "tesla-coil-platform.png",
}


def _copy_source_tree(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for path in source.iterdir():
        if path.name.startswith(".") or path.name == "data" or path.suffix.lower() == ".map":
            continue
        if source == ROOT / "src" / "assets" and path.name in SOURCE_ONLY_ASSETS:
            continue
        # Serve the optimized derivatives from src/assets/events, not the large source uploads.
        if source == ROOT / "src" and path.is_dir() and path.name == "Cards":
            continue
        target = destination / path.name
        if path.is_dir():
            _copy_source_tree(path, target)
        elif path.suffix.lower() in {".js", ".mjs", ".css", ".png", ".webp", ".jpg", ".jpeg", ".svg", ".woff", ".woff2"}:
            shutil.copy2(path, target)


def build() -> Path:
    if PUBLIC.name != "public" or PUBLIC.is_symlink() or PUBLIC.parent.resolve() != ROOT.resolve():
        raise RuntimeError("Invalid build destination")
    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    PUBLIC.mkdir(parents=True)
    for filename in ROOT_FILES:
        source = ROOT / filename
        if not source.is_file():
            raise FileNotFoundError(f"Required public source file is missing: {filename}")
        shutil.copy2(source, PUBLIC / filename)
    _copy_source_tree(ROOT / "src", PUBLIC / "src")
    if any(path.suffix.lower() in {".csv", ".map"} for path in PUBLIC.rglob("*")):
        raise RuntimeError("The public build contains a blocked file type")
    return PUBLIC


if __name__ == "__main__":
    print(f"Built static site in {build()}")

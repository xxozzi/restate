#!/usr/bin/env python3
"""Read-only audit of (R)estate's documentation, evidence, and lean directory layout."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import unquote

IGNORED = {
    ".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", ".next", "dist", "build", "coverage", ".scratch", "runs",
}
ROOT_DIRS = {"sources", "tools", "src", "tests", "runs", ".scratch"}
ROOT_FILES = {
    "PROJECT_GUIDE.md", ".gitignore", "package.json", "package-lock.json", "pnpm-lock.yaml",
    "yarn.lock", "bun.lock", "bun.lockb", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json",
    "vite.config.ts", "vite.config.js", "next.config.ts", "next.config.js", "next.config.mjs",
    "next-env.d.ts", "eslint.config.js", "eslint.config.mjs", "eslint.config.ts",
    "postcss.config.js", "postcss.config.mjs", "tailwind.config.ts", "tailwind.config.js",
    "pyproject.toml", "requirements.txt", "uv.lock", "poetry.lock", ".python-version",
    ".node-version", ".nvmrc", ".npmrc", ".env.example", ".env", ".env.local",
    "Dockerfile", ".dockerignore", "compose.yaml", "Makefile", "LICENSE", "index.html",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    root = parser.parse_args().root.resolve()
    errors, warnings = [], []
    if not root.is_dir():
        parser.error(f"Workspace directory does not exist: {root}")
    try:
        catalog = json.loads((root / "sources/catalog.json").read_text())
        if not isinstance(catalog, dict) or catalog.get("version") != 1:
            raise ValueError("expected an object with version 1")
        sources = catalog.get("sources")
        exceptions = catalog.get("markdown_exceptions", [])
        if not isinstance(sources, list) or not isinstance(exceptions, list):
            raise ValueError("sources and markdown_exceptions must be lists")
        if any(not isinstance(item, str) for item in exceptions):
            raise ValueError("markdown_exceptions must contain repository-relative paths")
    except (OSError, ValueError) as exc:
        errors.append(f"Cannot read source catalog: {exc}")
        sources, exceptions = [], []
    registered, by_id, by_hash = {}, {}, {}
    for item in sources:
        if not isinstance(item, dict) or not all(isinstance(item.get(k), str) for k in ("id", "path", "sha256")):
            errors.append(f"Invalid source entry: {item!r}")
            continue
        name, path = item["path"], root / item["path"]
        if Path(name).is_absolute() or ".." in Path(name).parts or not name.startswith("sources/"):
            errors.append(f"Source path must be relative and inside sources/: {name}")
            continue
        if item["id"] in by_id or name in registered:
            errors.append(f"Duplicate source ID or path: {item['id']} / {name}")
        registered[name], by_id[item["id"]] = item, item
        if not path.is_file():
            errors.append(f"Missing source file: {name}")
            continue
        try:
            with path.open("rb") as stream:
                digest = hashlib.sha256()
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            actual = digest.hexdigest()
            if actual != item["sha256"]:
                errors.append(f"Source checksum mismatch: {name}")
            by_hash.setdefault(actual, []).append(item)
        except OSError as exc:
            errors.append(f"Cannot read source {name}: {exc}")
    for group in by_hash.values():
        if len(group) > 1:
            ids = {item["id"] for item in group}
            roots = [item for item in group if item.get("intentional_duplicate_of") not in ids - {item["id"]}]
            if len(roots) != 1:
                warnings.append("Duplicate source content: " + ", ".join(item["path"] for item in group))
    for item in registered.values():
        target = item.get("intentional_duplicate_of")
        if target and (target == item["id"] or target not in by_id or by_id[target]["sha256"] != item["sha256"]):
            errors.append(f"Invalid intentional_duplicate_of reference: {item['path']}")
    allowed_md = {"PROJECT_GUIDE.md", *exceptions, *registered}
    for current, directories, files in os.walk(root, followlinks=False):
        directories[:] = [name for name in directories if name not in IGNORED]
        files = [name for name in files if name != ".DS_Store"]
        here = Path(current)
        if here != root and not directories and not files:
            warnings.append(f"Empty directory: {here.relative_to(root)}")
        for filename in files:
            path = here / filename
            name = path.relative_to(root).as_posix()
            if path.suffix.lower() in {".md", ".markdown", ".mdx"} and name not in allowed_md:
                errors.append(f"Unapproved authored Markdown: {name}")
            if name.startswith("sources/") and name != "sources/catalog.json" and name not in registered:
                errors.append(f"Uncataloged source file: {name}")
    for path in root.iterdir():
        if path.name in IGNORED or path.name == ".DS_Store":
            continue
        allowed = ROOT_DIRS if path.is_dir() else ROOT_FILES | set(exceptions)
        if path.name not in allowed:
            warnings.append(f"Unplanned root entry: {path.name}")
    try:
        guide = (root / "PROJECT_GUIDE.md").read_text()
        links = re.findall(r"\[[^\]]*\]\((<[^>]+>|[^)\n]+)\)", guide)
        links += re.findall(r"^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)", guide, re.MULTILINE)
        for link in links:
            link = link[1:-1] if link.startswith("<") else re.split(r"\s+[\"']", link, maxsplit=1)[0]
            if link.startswith("#") or re.match(r"^[a-zA-Z][\w+.-]*:", link):
                continue
            link = re.sub(r":\d+(?::\d+)?$", "", unquote(link.split("#", 1)[0].split("?", 1)[0]))
            if link and not (root / link).exists():
                errors.append(f"Broken local guide link: {link}")
    except OSError as exc:
        errors.append(f"Cannot read PROJECT_GUIDE.md: {exc}")
    for label, messages in (("ERROR", errors), ("WARNING", warnings)):
        for message in messages:
            print(f"{label}: {message}")
    print(f"Workspace audit: {len(errors)} error(s), {len(warnings)} warning(s); {len(registered)} cataloged source(s).")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Retrieve the public organizer starter, preserving upstream names and bytes.

Uses only public Google Drive download endpoints. Outputs provenance JSON to
stdout; does not alter the project's source catalog or overwrite changed files.
"""

from __future__ import annotations

import argparse
import ast
import concurrent.futures
import hashlib
import html
import json
import mimetypes
from pathlib import Path
import re
import sys
import urllib.request
from datetime import datetime, timezone

FOLDER_ID = "1XJxcpU2DcCzmd6nqNFIIMb03BJBe65ag"


def read_url(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
        if "accounts.google.com" in response.url:
            raise RuntimeError("Source requires authentication; stopping.")
        return body


def list_folder(folder_id: str, relative: Path):
    url = f"https://drive.google.com/drive/folders/{folder_id}"
    page = read_url(url).decode("utf-8")
    match = re.search(r"window\['_DRIVE_ivd'\]\s*=\s*('(?:\\.|[^'])*')", page)
    if not match:
        raise RuntimeError(f"Public folder listing unavailable: {url}")
    listing = json.loads(ast.literal_eval(match[1]))
    records = listing[0] or []
    # Drive's normal public folder page truncates at 50 entries. Its public
    # embedded listing includes the remaining supplied text files.
    if len(records) >= 50:
        embedded = read_url(
            f"https://drive.google.com/embeddedfolderview?id={folder_id}"
        ).decode("utf-8")
        known_ids = {record[0] for record in records}
        for entry in re.finditer(
            r'class="flip-entry" id="entry-([^\"]+)"(.*?)(?=class="flip-entry"|\Z)',
            embedded,
            re.DOTALL,
        ):
            identity, content = entry.groups()
            title = re.search(r'class="flip-entry-title">([^<]+)</div>', content)
            if identity not in known_ids and title:
                name = html.unescape(title[1])
                mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
                if "/drive/folders/" in content or "/folderview?" in content:
                    mime = "application/vnd.google-apps.folder"
                records.append([identity, None, name, mime])
                known_ids.add(identity)
    print(f"Listed {relative}: {len(records)} entries", file=sys.stderr)
    files = []
    for record in records:
        identity, name, mime = record[0], record[2], record[3]
        if name in (".", "..") or "/" in name or "\\" in name:
            raise RuntimeError(f"Unsafe upstream filename: {name!r}")
        path = relative / name
        if mime == "application/vnd.google-apps.folder":
            files.extend(list_folder(identity, path))
        else:
            files.append((identity, path, mime))
    return files


def download(record, destination: Path):
    identity, relative, mime = record
    source_url = f"https://drive.google.com/file/d/{identity}/view"
    download_url = f"https://drive.google.com/uc?export=download&id={identity}"
    body = read_url(download_url)
    if body.lstrip().lower().startswith((b"<!doctype html", b"<html")) and mime != "text/html":
        raise RuntimeError(f"Unexpected HTML instead of file: {source_url}")
    path = destination / relative
    if path.exists() and path.read_bytes() != body:
        raise RuntimeError(f"Refusing to overwrite changed source: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    print(f"Retrieved {relative} ({len(body)} bytes)", file=sys.stderr)
    return {
        "id": "starter-" + re.sub(r"[^a-z0-9]+", "-", str(relative).lower()).strip("-"),
        "path": str(path),
        "title": relative.name,
        "kind": "organizer-original",
        "source_url": source_url,
        "download_url": download_url,
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "upstream_mime_type": mime,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, default=Path("sources/starter"))
    args = parser.parse_args()
    files = list_folder(FOLDER_ID, Path())
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        entries = list(pool.map(lambda record: download(record, args.destination), files))
    # Completeness is checked against the supplied manifest, not a folder count.
    manifest = args.destination / "corpus/corpus_manifest.csv"
    if manifest.exists():
        import csv
        with manifest.open(newline="", encoding="utf-8-sig") as source:
            missing = [row["text_file"] for row in csv.DictReader(source)
                       if row["text_file"] and not
                       (args.destination / "corpus" / row["text_file"]).is_file()]
        if missing:
            raise RuntimeError(f"Incomplete supplied corpus: {missing}")
    print(json.dumps({"package_url": f"https://drive.google.com/drive/folders/{FOLDER_ID}",
                      "files": sorted(entries, key=lambda item: item["path"])}, indent=2))


if __name__ == "__main__":
    main()

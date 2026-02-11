from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from pathlib import Path
from datetime import datetime
import mimetypes
from fastapi import UploadFile, File, Form
from fastapi.responses import FileResponse
import shutil

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

def safe_path(user_path: str) -> Path:
    resolved = (UPLOAD_DIR / user_path).resolve()
    if not str(resolved).startswith(str(UPLOAD_DIR.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    return resolved

def format_size(size_bytes: int) -> str:
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size_bytes < 1024:
            if unit == "B":
                return f"{size_bytes} {unit}"
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024

def get_file_info(filepath: Path) -> dict:
    stat = filepath.stat()

    if filepath.is_dir():
        file_type = "folder"
        mime_type = "folder"
    else:
        mime_type, _ = mimetypes.guess_type(filepath.name)
        mime_type = mime_type or "application/octet-stream"

        if mime_type.startswith("image/"):
            file_type = "image"
        elif mime_type.startswith("video/"):
            file_type = "video"
        elif mime_type.startswith("audio/"):
            file_type = "audio"
        elif mime_type == "application/pdf":
            file_type = "pdf"
        elif filepath.suffix.lower() in [".py", ".js", ".html", ".css", ".json", ".md"]:
            file_type = "code"
        else:
            file_type = "file"

    if filepath.is_dir():
        size = 0
        for f in filepath.rglob("*"):   
            if f.is_file():             
                size += f.stat().st_size
    else:
        size = stat.st_size

    modified_dt = datetime.fromtimestamp(stat.st_mtime)

    return {
        "name": filepath.name,
        "path": str(filepath.relative_to(UPLOAD_DIR)),
        "is_dir": filepath.is_dir(),
        "size": size,
        "size_display": format_size(size),
        "file_type": file_type,
        "mime_type": mime_type,
        "modified": modified_dt.isoformat(),
        "modified_display": modified_dt.strftime("%b %d, %Y %I:%M %p"),
    }
@app.get("/api/files")
async def list_files(path: str = ""):
    target = safe_path(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Directory not found")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Not a directory")
    items = []
    for item in target.iterdir():
        if item.name.startswith("."):
            continue
        items.append(get_file_info(item))

    def sort_key(item):
        is_file = not item["is_dir"]
        name = item["name"].lower()
        return (is_file, name)

    items.sort(key=sort_key)

    breadcrumb = []
    if path:
        parts = Path(path).parts
        for i, part in enumerate(parts):
            full_path = str(Path(*parts[:i + 1]))
            breadcrumb.append({"name": part, "path": full_path})

    total_size = 0
    for f in UPLOAD_DIR.rglob("*"):
        if f.is_file():
            total_size += f.stat().st_size

    total_files = 0
    total_folders = 0
    for item in items:
        if item["is_dir"]:
            total_folders += 1
        else:
            total_files += 1

    return {
        "items": items,
        "current_path": path,
        "breadcrumb": breadcrumb,
        "total_files": total_files,
        "total_folders": total_folders,
        "storage_used": format_size(total_size),
        "storage_used_bytes": total_size,
    }
@app.post("/api/upload")
async def upload_files(
    files: list[UploadFile] = File(...),
    path: str = Form("")
):
    target_dir = safe_path(path)
    target_dir.mkdir(parents=True, exist_ok=True)

    uploaded = []

    for file in files:
        filename = file.filename.replace("/", "_").replace("\\", "_")
        filepath = target_dir / filename

        if filepath.exists():
            stem = filepath.stem
            suffix = filepath.suffix
            counter = 1
            while filepath.exists():
                filepath = target_dir / f"{stem} ({counter}){suffix}"
                counter += 1

        content = await file.read()
        with open(filepath, "wb") as f:
            f.write(content)

        uploaded.append(get_file_info(filepath))

    return {
        "uploaded": uploaded,
        "count": len(uploaded)
    }
@app.post("/api/folder")
async def create_folder(data: dict):
    name = data.get("name", "").strip()
    parent = data.get("path", "")

    if not name:
        raise HTTPException(status_code=400, detail="Folder name is required")

    name = name.replace("/", "_").replace("\\", "_")

    target = safe_path(parent + "/" + name)

    if target.exists():
        raise HTTPException(status_code=409, detail="Folder already exists")

    target.mkdir(parents=True, exist_ok=True)

    return {
        "message": f"Folder '{name}' created",
        "folder": get_file_info(target)
    }
@app.get("/api/download/{path:path}")
async def download_file(path: str):
    filepath = safe_path(path)

    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if filepath.is_dir():
        zip_path = UPLOAD_DIR / f".tmp_{filepath.name}"
        shutil.make_archive(str(zip_path), "zip", filepath)
        return FileResponse(
            f"{zip_path}.zip",
            filename=f"{filepath.name}.zip",
            media_type="application/zip"
        )

    return FileResponse(filepath, filename=filepath.name)
@app.get("/api/preview/{path:path}")
async def preview_file(path: str):
    filepath = safe_path(path)

    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")

    mime_type, _ = mimetypes.guess_type(filepath.name)
    mime_type = mime_type or "application/octet-stream"

    text_extensions = [
        ".txt", ".py", ".js", ".html", ".css", ".json", ".md",
        ".yml", ".yaml", ".sh", ".bat", ".tsx", ".jsx", ".ts",
        ".vue", ".sql", ".xml", ".csv", ".log", ".ini", ".env"
    ]

    if filepath.suffix.lower() in text_extensions:
        content = filepath.read_text(encoding="utf-8", errors="replace")
        return {"type": "text", "content": content}

    return FileResponse(filepath, media_type=mime_type)
@app.delete("/api/files/{path:path}")
async def delete_file(path: str):
    filepath = safe_path(path)

    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Not found")

    if filepath.is_dir():
        shutil.rmtree(filepath)
    else:
        filepath.unlink()

    return {"message": f"'{filepath.name}' deleted"}


@app.put("/api/rename")
async def rename_file(data: dict):
    old_path = data.get("old_path", "")
    new_name = data.get("new_name", "").strip()

    if not new_name:
        raise HTTPException(status_code=400, detail="New name is required")

    new_name = new_name.replace("/", "_").replace("\\", "_")
    source = safe_path(old_path)

    if not source.exists():
        raise HTTPException(status_code=404, detail="Not found")

    destination = source.parent / new_name

    if destination.exists():
        raise HTTPException(status_code=409, detail="Name already exists")

    source.rename(destination)

    return {"message": f"Renamed to '{new_name}'", "file": get_file_info(destination)}


@app.post("/api/move")
async def move_file(data: dict):
    source_path = data.get("source", "")
    dest_path = data.get("destination", "")

    source = safe_path(source_path)
    dest_dir = safe_path(dest_path)

    if not source.exists():
        raise HTTPException(status_code=404, detail="Source not found")

    if not dest_dir.is_dir():
        raise HTTPException(status_code=400, detail="Destination must be a folder")

    destination = dest_dir / source.name

    if destination.exists():
        raise HTTPException(status_code=409, detail="Item already exists in destination")

    shutil.move(str(source), str(destination))

    return {"message": f"Moved '{source.name}'"}


@app.get("/api/search")
async def search_files(q: str = "", path: str = ""):
    if not q:
        return {"results": []}

    search_root = safe_path(path)
    results = []
    query = q.lower()

    for item in search_root.rglob("*"):
        if not item.name.startswith(".") and query in item.name.lower():
            results.append(get_file_info(item))
            if len(results) >= 50:
                break

    return {"results": results, "query": q}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
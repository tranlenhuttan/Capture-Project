from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, FileResponse
from fastapi import UploadFile, File, Form
from pathlib import Path
from datetime import datetime
import mimetypes
import shutil

from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db, init_db
from models import FileItem, Collection, CollectionItem

# ═══════════════════════════════════════
#   APP SETUP
# ═══════════════════════════════════════

app = FastAPI(title="Capture Project")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

UPLOAD_DIR = Path("uploads").resolve()
UPLOAD_DIR.mkdir(exist_ok=True)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.on_event("startup")
def startup():
    init_db()
    print("✅ Database initialized")


# ═══════════════════════════════════════
#   HELPERS
# ═══════════════════════════════════════

def safe_path(user_path: str) -> Path:
    cleaned  = user_path.strip("/").strip()
    if not cleaned:
        return UPLOAD_DIR.resolve()
    resolved = (UPLOAD_DIR / cleaned).resolve()
    if not str(resolved).startswith(str(UPLOAD_DIR.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    return resolved


def detect_file_type(filepath: Path) -> tuple[str, str]:
    if filepath.is_dir():
        return "folder", "folder"

    mime_type, _ = mimetypes.guess_type(filepath.name)
    mime_type = mime_type or "application/octet-stream"

    if mime_type.startswith("image/"):
        return "image", mime_type
    elif mime_type.startswith("video/"):
        return "video", mime_type
    elif mime_type.startswith("audio/"):
        return "audio", mime_type
    elif mime_type == "application/pdf":
        return "pdf", mime_type
    elif filepath.suffix.lower() in [
        ".py", ".js", ".html", ".css", ".json", ".md",
        ".ts", ".tsx", ".jsx", ".vue", ".sql", ".xml",
        ".yml", ".yaml", ".sh", ".bat", ".csv", ".log",
        ".ini", ".env", ".txt",
    ]:
        return "code", mime_type

    return "file", mime_type


def sync_file_to_db(filepath: Path, db: Session) -> FileItem:
    """Upsert 1 file/folder từ disk vào database."""
    rel_path    = str(filepath.relative_to(UPLOAD_DIR)).replace("\\", "/")
    parent      = filepath.parent
    parent_path = (
        "" if parent == UPLOAD_DIR
        else str(parent.relative_to(UPLOAD_DIR)).replace("\\", "/")
    )
    if parent_path == ".":
        parent_path = ""

    file_type, mime_type = detect_file_type(filepath)
    stat = filepath.stat()
    size = 0 if filepath.is_dir() else stat.st_size

    item = db.query(FileItem).filter(FileItem.path == rel_path).first()
    if item:
        item.name        = filepath.name
        item.parent_path = parent_path
        item.size        = size
        item.file_type   = file_type
        item.mime_type   = mime_type
        item.updated_at  = datetime.fromtimestamp(stat.st_mtime)
    else:
        item = FileItem(
            name        = filepath.name,
            path        = rel_path,
            parent_path = parent_path,
            is_dir      = filepath.is_dir(),
            size        = size,
            file_type   = file_type,
            mime_type   = mime_type,
            created_at  = datetime.fromtimestamp(stat.st_ctime),
            updated_at  = datetime.fromtimestamp(stat.st_mtime),
        )
        db.add(item)

    db.commit()
    db.refresh(item)
    return item


def sync_directory_to_db(dir_path: Path, db: Session):
    if not dir_path.exists() or not dir_path.is_dir():
        return

    rel_parent = (
        "" if dir_path == UPLOAD_DIR
        else str(dir_path.relative_to(UPLOAD_DIR)).replace("\\", "/")
    )
    if rel_parent == ".":
        rel_parent = ""

    disk_paths = set()
    for item in dir_path.iterdir():
        if item.name.startswith("."):
            continue
        disk_paths.add(str(item.relative_to(UPLOAD_DIR)).replace("\\", "/"))
        sync_file_to_db(item, db)

    # Xóa records không còn trên disk
    db_items = db.query(FileItem).filter(FileItem.parent_path == rel_parent).all()
    for db_item in db_items:
        if db_item.path not in disk_paths:
            db.delete(db_item)

    db.commit()


# ═══════════════════════════════════════
#   ROUTES — Pages
# ═══════════════════════════════════════

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# ═══════════════════════════════════════
#   API — List Files
# ═══════════════════════════════════════

@app.get("/api/files")
async def list_files(path: str = "", db: Session = Depends(get_db)):
    target = safe_path(path)

    if not target.exists():
        raise HTTPException(status_code=404, detail="Directory not found")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Not a directory")

    sync_directory_to_db(target, db)

    rel_parent = path.strip("/") if path else ""
    items = (
        db.query(FileItem)
        .filter(FileItem.parent_path == rel_parent)
        .order_by(FileItem.is_dir.desc(), FileItem.name)
        .all()
    )

    breadcrumb = []
    if path:
        parts = Path(path).parts
        for i, part in enumerate(parts):
            breadcrumb.append({
                "name": part,
                "path": str(Path(*parts[: i + 1])),
            })

    total_size = (
        db.query(func.sum(FileItem.size))
        .filter(FileItem.is_dir == False)
        .scalar() or 0
    )

    return {
        "items":         [item.to_dict() for item in items],
        "current_path":  path,
        "breadcrumb":    breadcrumb,
        "total_files":   sum(1 for x in items if not x.is_dir),
        "total_folders": sum(1 for x in items if x.is_dir),
        "storage": {
            "used":  total_size,
            "total": 15 * 1024 * 1024 * 1024,
        },
    }


# ═══════════════════════════════════════
#   API — Upload
# ═══════════════════════════════════════

@app.post("/api/upload")
async def upload_files(
    files: list[UploadFile] = File(...),
    path:  str = Form(""),
    db:    Session = Depends(get_db),
):
    target_dir = safe_path(path)
    target_dir.mkdir(parents=True, exist_ok=True)

    uploaded = []
    for file in files:
        filename = file.filename.replace("/", "_").replace("\\", "_")
        filepath = target_dir / filename

        if filepath.exists():
            stem, suffix = filepath.stem, filepath.suffix
            counter = 1
            while filepath.exists():
                filepath = target_dir / f"{stem} ({counter}){suffix}"
                counter += 1

        content = await file.read()
        filepath.write_bytes(content)
        item = sync_file_to_db(filepath, db)
        uploaded.append(item.to_dict())

    return {"uploaded": uploaded, "count": len(uploaded)}


# ═══════════════════════════════════════
#   API — Create Folder
# ═══════════════════════════════════════

@app.post("/api/folder")
async def create_folder(data: dict, db: Session = Depends(get_db)):
    name   = data.get("name", "").strip()
    parent = data.get("path", "").strip()

    if not name:
        raise HTTPException(status_code=400, detail="Folder name is required")

    name      = name.replace("/", "_").replace("\\", "_")
    full_path = f"{parent.strip('/')}/{name}" if parent else name
    target    = safe_path(full_path)

    if target.exists():
        raise HTTPException(status_code=409, detail="Folder already exists")

    target.mkdir(parents=True, exist_ok=True)
    item = sync_file_to_db(target, db)
    return {"message": f"Folder '{name}' created", "folder": item.to_dict()}


# ═══════════════════════════════════════
#   API — Download
# ═══════════════════════════════════════

@app.get("/api/download/{path:path}")
async def download_file(path: str):
    filepath = safe_path(path)
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if filepath.is_dir():
        zip_base = UPLOAD_DIR / f".tmp_{filepath.name}"
        shutil.make_archive(str(zip_base), "zip", filepath)
        return FileResponse(
            f"{zip_base}.zip",
            filename=f"{filepath.name}.zip",
            media_type="application/zip",
        )

    return FileResponse(filepath, filename=filepath.name)


# ═══════════════════════════════════════
#   API — Preview
# ═══════════════════════════════════════

@app.get("/api/preview/{path:path}")
async def preview_file(path: str):
    filepath = safe_path(path)
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")

    mime_type, _ = mimetypes.guess_type(filepath.name)
    mime_type = mime_type or "application/octet-stream"

    text_exts = {
        ".txt", ".py", ".js", ".html", ".css", ".json", ".md",
        ".yml", ".yaml", ".sh", ".bat", ".tsx", ".jsx", ".ts",
        ".vue", ".sql", ".xml", ".csv", ".log", ".ini", ".env",
    }
    if filepath.suffix.lower() in text_exts:
        content = filepath.read_text(encoding="utf-8", errors="replace")
        return {"type": "text", "content": content}

    return FileResponse(filepath, media_type=mime_type)


# ═══════════════════════════════════════
#   API — Delete
# ═══════════════════════════════════════

@app.delete("/api/delete")
async def delete_file(data: dict, db: Session = Depends(get_db)):
    file_path = data.get("path", "").strip("/")
    if not file_path:
        raise HTTPException(status_code=400, detail="Path is required")

    filepath = safe_path(file_path)
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Not found")

    if filepath.is_dir():
        shutil.rmtree(filepath)
    else:
        filepath.unlink()

    item = db.query(FileItem).filter(FileItem.path == file_path).first()
    if item:
        if item.is_dir:
            db.query(FileItem).filter(
                FileItem.path.startswith(file_path + "/")
            ).delete(synchronize_session=False)
        db.delete(item)
        db.commit()

    return {"message": f"'{filepath.name}' deleted"}


# ═══════════════════════════════════════
#   API — Rename
# ═══════════════════════════════════════

@app.put("/api/rename")
async def rename_file(data: dict, db: Session = Depends(get_db)):
    old_path = (data.get("old_path") or data.get("path", "")).strip("/")
    new_name = data.get("new_name", "").strip()

    if not new_name:
        raise HTTPException(status_code=400, detail="New name is required")

    new_name    = new_name.replace("/", "_").replace("\\", "_")
    source      = safe_path(old_path)

    if not source.exists():
        raise HTTPException(status_code=404, detail="Not found")

    destination = source.parent / new_name
    if destination.exists():
        raise HTTPException(status_code=409, detail="Name already exists")

    source.rename(destination)

    item = db.query(FileItem).filter(FileItem.path == old_path).first()
    if item:
        new_rel = str(destination.relative_to(UPLOAD_DIR)).replace("\\", "/")

        if item.is_dir:
            children = db.query(FileItem).filter(
                FileItem.path.startswith(old_path + "/")
            ).all()
            for child in children:
                child.path        = child.path.replace(old_path, new_rel, 1)
                child.parent_path = str(
                    (UPLOAD_DIR / child.path).parent.relative_to(UPLOAD_DIR)
                ).replace("\\", "/")
                if child.parent_path == ".":
                    child.parent_path = ""

        item.name       = new_name
        item.path       = new_rel
        item.file_type, item.mime_type = detect_file_type(destination)
        item.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(item)
        return {"message": f"Renamed to '{new_name}'", "file": item.to_dict()}

    item = sync_file_to_db(destination, db)
    return {"message": f"Renamed to '{new_name}'", "file": item.to_dict()}


# ═══════════════════════════════════════
#   API — Starred
# ═══════════════════════════════════════

@app.post("/api/star")
async def toggle_star(data: dict, db: Session = Depends(get_db)):
    file_path = data.get("path", "").strip("/")
    if not file_path:
        raise HTTPException(status_code=400, detail="Path is required")

    item = db.query(FileItem).filter(FileItem.path == file_path).first()
    if not item:
        filepath = safe_path(file_path)
        if not filepath.exists():
            raise HTTPException(status_code=404, detail="Not found")
        item = sync_file_to_db(filepath, db)

    item.is_starred = not item.is_starred
    db.commit()
    action = "Starred" if item.is_starred else "Unstarred"
    return {"message": f"{action} '{item.name}'", "is_starred": item.is_starred}


@app.get("/api/starred")
async def list_starred(db: Session = Depends(get_db)):
    items = (
        db.query(FileItem)
        .filter(FileItem.is_starred == True)
        .order_by(FileItem.name)
        .all()
    )
    return {"items": [item.to_dict() for item in items]}


# ═══════════════════════════════════════
#   API — Search
# ═══════════════════════════════════════

@app.get("/api/search")
async def search_files(q: str = "", path: str = "", db: Session = Depends(get_db)):
    if not q:
        return {"results": []}

    results = (
        db.query(FileItem)
        .filter(FileItem.name.ilike(f"%{q}%"))
        .order_by(FileItem.is_dir.desc(), FileItem.name)
        .limit(50)
        .all()
    )
    return {"results": [item.to_dict() for item in results], "query": q}


# ═══════════════════════════════════════
#   API — All Images (for slideshow picker, no limit)
# ═══════════════════════════════════════

@app.get("/api/images")
async def list_all_images(db: Session = Depends(get_db)):
    """Trả về tất cả ảnh trong DB, không giới hạn số lượng."""
    items = (
        db.query(FileItem)
        .filter(FileItem.file_type == "image")
        .filter(~FileItem.path.startswith("music/"))
        .order_by(FileItem.parent_path, FileItem.name)
        .all()
    )
    return {"items": [item.to_dict() for item in items]}


# ═══════════════════════════════════════
#   API — Full Sync (utility)
# ═══════════════════════════════════════

@app.post("/api/sync")
async def full_sync(db: Session = Depends(get_db)):
    count = 0
    for item in UPLOAD_DIR.rglob("*"):
        if item.name.startswith("."):
            continue
        sync_file_to_db(item, db)
        count += 1
    return {"message": f"Synced {count} items"}


# ═══════════════════════════════════════
#   API — Collections
# ═══════════════════════════════════════

@app.get("/api/collections")
async def list_collections(db: Session = Depends(get_db)):
    cols = db.query(Collection).order_by(Collection.created_at.desc()).all()
    return {"collections": [c.to_dict() for c in cols]}


@app.get("/api/collections/{col_id}")
async def get_collection(col_id: int, db: Session = Depends(get_db)):
    col = db.query(Collection).filter(Collection.id == col_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found")
    data = col.to_dict()
    data["items"] = [i.to_dict() for i in col.items]
    return data


@app.post("/api/collections")
async def create_collection(data: dict, db: Session = Depends(get_db)):
    """Create empty collection (folder) — no images required at creation."""
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")

    col = Collection(
        name=name,
        transition_speed=float(data.get("transition_speed", 1.0)),
        display_time=int(data.get("display_time", 5)),
        music_id=data.get("music_id", None),
    )
    db.add(col)
    db.commit()
    db.refresh(col)
    result = col.to_dict()
    result["items"] = []
    return result


@app.put("/api/collections/{col_id}")
async def update_collection(col_id: int, data: dict, db: Session = Depends(get_db)):
    col = db.query(Collection).filter(Collection.id == col_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Not found")

    if "name" in data:
        col.name = data["name"].strip()
    if "transition_speed" in data:
        col.transition_speed = max(0.1, min(4.0, float(data["transition_speed"])))
    if "display_time" in data:
        col.display_time = max(1, min(60, int(data["display_time"])))
    if "music_id" in data:
        col.music_id = data["music_id"]  # None, 1, or 2

    col.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(col)
    result = col.to_dict()
    result["items"] = [i.to_dict() for i in col.items]
    return result


@app.delete("/api/collections/{col_id}")
async def delete_collection(col_id: int, db: Session = Depends(get_db)):
    col = db.query(Collection).filter(Collection.id == col_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(col)
    db.commit()
    return {"message": "Collection deleted"}


@app.post("/api/collections/{col_id}/add-image")
async def add_image_to_collection(col_id: int, data: dict, db: Session = Depends(get_db)):
    """Add a single image (by file_path) to a collection."""
    col = db.query(Collection).filter(Collection.id == col_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Not found")

    file_path = data.get("file_path", "").strip("/")
    if not file_path:
        raise HTTPException(status_code=400, detail="file_path required")

    # Check not already in collection
    exists = db.query(CollectionItem).filter(
        CollectionItem.collection_id == col_id,
        CollectionItem.file_path == file_path,
    ).first()
    if exists:
        return {"message": "Already in collection", "collection": col.to_dict()}

    # Determine order = max + 1
    from sqlalchemy import func as sqlfunc
    max_order = db.query(sqlfunc.max(CollectionItem.order)).filter(
        CollectionItem.collection_id == col_id
    ).scalar() or -1

    file_name = file_path.split("/")[-1]
    db.add(CollectionItem(
        collection_id=col_id,
        file_path=file_path,
        file_name=file_name,
        order=max_order + 1,
    ))

    # Update cover_path if first image
    if not col.cover_path:
        col.cover_path = file_path

    col.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(col)
    return {"message": f"Added to '{col.name}'", "collection": col.to_dict()}


@app.delete("/api/collections/{col_id}/remove-image")
async def remove_image_from_collection(col_id: int, data: dict, db: Session = Depends(get_db)):
    col = db.query(Collection).filter(Collection.id == col_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Not found")

    file_path = data.get("file_path", "").strip("/")
    item = db.query(CollectionItem).filter(
        CollectionItem.collection_id == col_id,
        CollectionItem.file_path == file_path,
    ).first()
    if item:
        db.delete(item)
        # Update cover if removed item was cover
        if col.cover_path == file_path:
            remaining = db.query(CollectionItem).filter(
                CollectionItem.collection_id == col_id
            ).order_by(CollectionItem.order).first()
            col.cover_path = remaining.file_path if remaining else None
        col.updated_at = datetime.utcnow()
        db.commit()

    return {"message": "Removed"}


# ═══════════════════════════════════════
#   RUN
# ═══════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
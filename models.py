from sqlalchemy import Column, Integer, String, Boolean, BigInteger, DateTime
from sqlalchemy.sql import func
from datetime import datetime

from database import Base


class FileItem(Base):
    __tablename__ = "file_items"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    name          = Column(String(700), nullable=False)
    path          = Column(String(700), nullable=False, unique=True)
    parent_path   = Column(String(700), nullable=False, default="")
    is_dir        = Column(Boolean, nullable=False, default=False)
    size          = Column(BigInteger, nullable=False, default=0)
    file_type     = Column(String(50), nullable=False, default="file")
    mime_type     = Column(String(200), nullable=False, default="application/octet-stream")
    is_starred    = Column(Boolean, nullable=False, default=False)
    created_at    = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at    = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id":         self.id,
            "name":       self.name,
            "path":       self.path,
            "parent_path":self.parent_path,
            "type":       "folder" if self.is_dir else "file",
            "is_dir":     self.is_dir,
            "size":       self.size,
            "file_type":  self.file_type,
            "mime_type":  self.mime_type,
            "is_starred": self.is_starred,
            "modified":   self.updated_at.isoformat() if self.updated_at else None,
            "created":    self.created_at.isoformat() if self.created_at else None,
        }
from sqlalchemy import Column, Integer, Float, String, Boolean, BigInteger, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
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


class Collection(Base):
    __tablename__ = "collections"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    name              = Column(String(255), nullable=False)
    cover_path        = Column(String(700), nullable=True)
    music_id          = Column(Integer, nullable=True, default=None)  # 1 or 2, preset tracks
    transition_speed  = Column(Float,   nullable=False, default=1.0)  # seconds, max 4.0
    display_time      = Column(Integer, nullable=False, default=5)    # seconds per slide, max 60
    created_at        = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at        = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    items = relationship(
        "CollectionItem",
        back_populates="collection",
        cascade="all, delete-orphan",
        order_by="CollectionItem.order",
    )

    def to_dict(self) -> dict:
        return {
            "id":               self.id,
            "name":             self.name,
            "cover_path":       self.cover_path,
            "music_id":         self.music_id,
            "transition_speed": self.transition_speed,
            "display_time":     self.display_time,
            "item_count":       len(self.items),
            "created_at":       self.created_at.isoformat() if self.created_at else None,
            "updated_at":       self.updated_at.isoformat() if self.updated_at else None,
        }


class CollectionItem(Base):
    __tablename__ = "collection_items"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    collection_id = Column(Integer, ForeignKey("collections.id", ondelete="CASCADE"), nullable=False)
    file_path     = Column(String(700), nullable=False)
    file_name     = Column(String(700), nullable=False)
    order         = Column(Integer, nullable=False, default=0)
    created_at    = Column(DateTime, nullable=False, default=datetime.utcnow)

    collection = relationship("Collection", back_populates="items")

    def to_dict(self) -> dict:
        return {
            "id":        self.id,
            "file_path": self.file_path,
            "file_name": self.file_name,
            "order":     self.order,
        }
"""002 - Update collections: add transition_speed, display_time, music_id; remove speed, music_path"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "002"
down_revision = "001_add_collections"  # standalone — không chain với 001
branch_labels = None
depends_on    = None


def _col_exists(table, col):
    bind = op.get_bind()
    insp = inspect(bind)
    cols = [c["name"] for c in insp.get_columns(table)]
    return col in cols


def upgrade():
    # Thêm cột mới nếu chưa có
    if not _col_exists("collections", "transition_speed"):
        op.add_column("collections",
            sa.Column("transition_speed", sa.Float(), nullable=False, server_default="1.0"))

    if not _col_exists("collections", "display_time"):
        op.add_column("collections",
            sa.Column("display_time", sa.Integer(), nullable=False, server_default="5"))

    if not _col_exists("collections", "music_id"):
        op.add_column("collections",
            sa.Column("music_id", sa.Integer(), nullable=True))

    # Xóa cột cũ nếu còn tồn tại
    if _col_exists("collections", "speed"):
        op.drop_column("collections", "speed")

    if _col_exists("collections", "music_path"):
        op.drop_column("collections", "music_path")


def downgrade():
    if not _col_exists("collections", "speed"):
        op.add_column("collections",
            sa.Column("speed", sa.Integer(), nullable=False, server_default="3"))

    if not _col_exists("collections", "music_path"):
        op.add_column("collections",
            sa.Column("music_path", sa.String(700), nullable=True))

    if _col_exists("collections", "transition_speed"):
        op.drop_column("collections", "transition_speed")

    if _col_exists("collections", "display_time"):
        op.drop_column("collections", "display_time")

    if _col_exists("collections", "music_id"):
        op.drop_column("collections", "music_id")
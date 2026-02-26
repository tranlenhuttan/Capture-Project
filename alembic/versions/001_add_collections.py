"""add collections and collection_items tables

Revision ID: 001_add_collections
Revises: 
Create Date: 2026-02-26
"""

from alembic import op
import sqlalchemy as sa

revision = '001_add_collections'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # ── collections ──────────────────────────────────────
    op.create_table(
        'collections',
        sa.Column('id',         sa.Integer(),     nullable=False, autoincrement=True),
        sa.Column('name',       sa.String(255),   nullable=False),
        sa.Column('cover_path', sa.String(700),   nullable=True),
        sa.Column('music_path', sa.String(700),   nullable=True),
        sa.Column('speed',      sa.Integer(),     nullable=False, server_default='3'),
        sa.Column('created_at', sa.DateTime(),    nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(),    nullable=False, server_default=sa.func.now(),
                  onupdate=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci',
    )

    # ── collection_items ──────────────────────────────────
    op.create_table(
        'collection_items',
        sa.Column('id',            sa.Integer(),  nullable=False, autoincrement=True),
        sa.Column('collection_id', sa.Integer(),  nullable=False),
        sa.Column('file_path',     sa.String(700), nullable=False),
        sa.Column('file_name',     sa.String(700), nullable=False),
        sa.Column('order',         sa.Integer(),  nullable=False, server_default='0'),
        sa.Column('created_at',    sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['collection_id'], ['collections.id'],
            ondelete='CASCADE',
            name='fk_collection_items_collection_id',
        ),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci',
    )

    # Indexes
    op.create_index('ix_collection_items_collection_id',
                    'collection_items', ['collection_id'])
    op.create_index('ix_collection_items_order',
                    'collection_items', ['collection_id', 'order'])


def downgrade():
    op.drop_index('ix_collection_items_order',         table_name='collection_items')
    op.drop_index('ix_collection_items_collection_id', table_name='collection_items')
    op.drop_table('collection_items')
    op.drop_table('collections')
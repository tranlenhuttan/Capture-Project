from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker


MYSQL_USER     = "root"
MYSQL_PASSWORD = "Ngusaonoi0121$$"
MYSQL_HOST     = "localhost"
MYSQL_PORT     = 3306
MYSQL_DB       = "capture_pj"

DATABASE_URL = (
    f"mysql+pymysql://{MYSQL_USER}:{MYSQL_PASSWORD}"
    f"@{MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DB}"
    f"?charset=utf8mb4"
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,       
    pool_recycle=3600,        
    echo=False,              
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Dependency injection cho FastAPI."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from models import FileItem  
    Base.metadata.create_all(bind=engine)
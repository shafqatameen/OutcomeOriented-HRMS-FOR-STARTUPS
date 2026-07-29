from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# To use PostgreSQL, change the URL to: postgresql://user:password@localhost/dbname
# Keeping sqlite path relative to the backend root (which is where we run uvicorn)
SQLALCHEMY_DATABASE_URL = "sqlite:///./pointsystem.db"

# SQLite requires connect_args={"check_same_thread": False} 
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

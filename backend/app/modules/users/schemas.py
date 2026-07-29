from pydantic import BaseModel

class UserBase(BaseModel):
    name: str
    role: str

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    total_points: int

    class Config:
        from_attributes = True

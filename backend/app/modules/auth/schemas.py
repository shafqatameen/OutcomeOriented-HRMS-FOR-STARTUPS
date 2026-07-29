from pydantic import BaseModel


class LoginRequest(BaseModel):
    name: str
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    role: str

    class Config:
        from_attributes = True


class LoginOption(BaseModel):
    """Minimal, pre-auth-safe user info for populating the login form -
    no role or points, unlike UserOut / the full /users list."""
    id: int
    name: str

    class Config:
        from_attributes = True

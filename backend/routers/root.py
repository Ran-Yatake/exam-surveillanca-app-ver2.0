from fastapi import APIRouter

router = APIRouter(tags=["root"])


@router.get("/")
def read_root():
    return {"message": "Exam Surveillance API is running"}

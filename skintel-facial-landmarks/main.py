from fastapi import FastAPI, File, UploadFile, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import dlib
import cv2
import numpy as np
from PIL import Image
import io
from typing import List, Dict, Optional
import logging
import requests
from urllib.parse import urlparse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# response models
class LandmarkPoint(BaseModel):
    x: int
    y: int
    index: int

class ImageInfo(BaseModel):
    filename: str
    width: int
    height: int
    format: Optional[str] = None

class LandmarksResponse(BaseModel):
    status: str
    landmarks: List[LandmarkPoint]
    total_landmarks: int
    image_info: ImageInfo

class HealthResponse(BaseModel):
    status: str
    service: str
    version: str

class ErrorResponse(BaseModel):
    status: str
    error: str
    message: str

class ImageUrlRequest(BaseModel):
    image_url: str


app = FastAPI(
    title="Skintel Facial Landmarks API",
    description="microservice for facial landmarks detection for Skintel ",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # todo: config for prod later
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

detector = dlib.get_frontal_face_detector()
predictor = None

@app.on_event("startup")
async def startup_event():
    """init Dlib predictor on startup"""
    global predictor
    try:
        predictor_path = "shape_predictor_68_face_landmarks.dat"
        predictor = dlib.shape_predictor(predictor_path)
        logger.info("Dlib predictor loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load Dlib predictor: {e}")
        raise

def extract_landmarks(image_array: np.ndarray) -> List[Dict[str, int]]:
    """extract all 68 facial landmarks from img"""
    gray = cv2.cvtColor(image_array, cv2.COLOR_RGB2GRAY)
    faces = detector(gray)
    
    if len(faces) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No face detected in the image"
        )
    
    face = faces[0]
    landmarks = predictor(gray, face)
    
    landmark_points = []
    for i in range(68):
        x = landmarks.part(i).x
        y = landmarks.part(i).y
        landmark_points.append({"x": int(x), "y": int(y), "index": i})
    
    return landmark_points


@app.get("/", response_model=Dict[str, str])
async def get_api_info():
    """Get API info"""
    return {
        "service": "Skintel Facial Landmarks API",
        "version": "1.0.0",
        "description": "microservice for facial landmarks detection for Skintel ",
        "endpoints": {
            "health": "GET /health",
            "landmarks": "POST /api/v1/landmarks",
            "docs": "GET /docs"
        }
    }

@app.get("/health", response_model=HealthResponse)
async def get_health():
    """health check endpoint"""
    return HealthResponse(
        status="healthy",
        service="facial-landmarks-api",
        version="1.0.0"
    )

@app.post("/api/v1/landmarks", response_model=LandmarksResponse)
async def create_landmarks_detection(request: ImageUrlRequest):
    """
    detect 68 facial landmarks from image URL
    
    - **image_url**: URL to image file (JPEG, PNG, etc.)
    
    this will return facial landmarks with x, y coordinates and index for each point.
    """
    try:
        # Validate URL
        parsed_url = urlparse(request.image_url)
        if not parsed_url.scheme or not parsed_url.netloc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid image URL provided"
            )
        
        # Download image from URL
        try:
            response = requests.get(request.image_url, timeout=10)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to download image from URL: {str(e)}"
            )
        
        # Check if response contains image data
        content_type = response.headers.get('content-type', '')
        if not content_type.startswith('image/'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="URL does not point to an image file"
            )
        
        # Process image
        image = Image.open(io.BytesIO(response.content))
        
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        image_array = np.array(image)
        
        landmarks = extract_landmarks(image_array)
        
        # Extract filename from URL
        filename = parsed_url.path.split('/')[-1] or "image_from_url"
        
        return LandmarksResponse(
            status="success",
            landmarks=[LandmarkPoint(**point) for point in landmarks],
            total_landmarks=len(landmarks),
            image_info=ImageInfo(
                filename=filename,
                width=image.width,
                height=image.height,
                format=image.format
            )
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing image from URL: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )

@app.get("/api/v1/landmarks/info")
async def get_landmarks_info():
    """get info of facial landmarks"""
    return {
        "total_points": 68,
        "point_groups": {
            "jaw_line": "Points 0-16",
            "right_eyebrow": "Points 17-21",
            "left_eyebrow": "Points 22-26",
            "nose_bridge": "Points 27-30",
            "nose_tip": "Points 31-35",
            "right_eye": "Points 36-41",
            "left_eye": "Points 42-47",
            "outer_lip": "Points 48-59",
            "inner_lip": "Points 60-67"
        },
        "coordinate_system": "Top-left origin (0,0), x increases right, y increases down"
    }

# legacy endpoint for backward compatibility. dint use this.
@app.post("/detect-landmarks/", response_model=LandmarksResponse)
async def detect_landmarks_legacy(file: UploadFile = File(...)):
    """this is legacy endpoint. use /api/v1/landmarks instead, this is deprecated"""
    return await create_landmarks_detection(file)

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            status="error",
            error=f"HTTP {exc.status_code}",
            message=exc.detail
        ).dict()
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

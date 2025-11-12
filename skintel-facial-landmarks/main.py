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
import base64

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
    annotated_image: Optional[str] = None

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
    include_annotation: bool = True

class IssuePoint(BaseModel):
    x: int
    y: int

class SkinIssue(BaseModel):
    type: str
    region: str
    severity: str
    visible_in: List[str]
    explanation: str
    recommendations: List[str]
    dlib_68_facial_landmarks: List[IssuePoint]

class IssueAnnotationRequest(BaseModel):
    image_data: str
    issues: List[SkinIssue]

class IssueAnnotationFromUrlRequest(BaseModel):
    image_url: str
    issues: List[SkinIssue]

class IssueAnnotationResponse(BaseModel):
    status: str
    annotated_image: str
    total_issues: int
    image_info: ImageInfo

class ImageResizeRequest(BaseModel):
    image_url: str
    max_dimension: int = 768
    quality: int = 85

class ImageResizeResponse(BaseModel):
    status: str
    resized_image_url: str
    original_size: Dict[str, int]
    resized_size: Dict[str, int]

app = FastAPI(
    title="Skintel Facial Landmarks API",
    description="microservice for facial landmarks detection for Skintel ",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

def annotate_image_with_landmarks(image_array: np.ndarray, landmarks: List[Dict[str, int]]) -> str:
    """draw facial landmarks on image and return as base64 string"""
    annotated = image_array.copy()
    
    colors = {
        'jaw': (255, 0, 0),
        'right_eyebrow': (0, 255, 0),
        'left_eyebrow': (0, 255, 0),
        'nose': (0, 0, 255),
        'right_eye': (255, 255, 0),
        'left_eye': (255, 255, 0),
        'outer_lip': (255, 0, 255),
        'inner_lip': (128, 0, 255)
    }
    
    annotated_bgr = cv2.cvtColor(annotated, cv2.COLOR_RGB2BGR)
    
    feature_ranges = {
        'jaw': (0, 17),
        'right_eyebrow': (17, 22),
        'left_eyebrow': (22, 27),
        'nose': (27, 36),
        'right_eye': (36, 42),
        'left_eye': (42, 48),
        'outer_lip': (48, 60),
        'inner_lip': (60, 68)
    }
    
    for feature, (start, end) in feature_ranges.items():
        color = colors[feature]
        points = [(landmarks[i]['x'], landmarks[i]['y']) for i in range(start, end)]
        
        for i in range(len(points) - 1):
            cv2.line(annotated_bgr, points[i], points[i + 1], color, 2)
        
        if feature in ['right_eye', 'left_eye', 'outer_lip', 'inner_lip']:
            cv2.line(annotated_bgr, points[-1], points[0], color, 2)
    
    for point in landmarks:
        cv2.circle(annotated_bgr, (point['x'], point['y']), 3, (0, 255, 0), -1)
    
    annotated_rgb = cv2.cvtColor(annotated_bgr, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(annotated_rgb)
    
    img_buffer = io.BytesIO()
    pil_image.save(img_buffer, format='PNG')
    img_buffer.seek(0)
    
    img_base64 = base64.b64encode(img_buffer.read()).decode('utf-8')
    return f"data:image/png;base64,{img_base64}"

def annotate_image_with_issues(image_array: np.ndarray, issues: List[SkinIssue]) -> str:
    """draw skin issues on image with colored regions and legend"""
    annotated = image_array.copy()
    annotated_bgr = cv2.cvtColor(annotated, cv2.COLOR_RGB2BGR)
    
    severity_colors = {
        'mild': (0, 255, 255),
        'moderate': (0, 165, 255),
        'severe': (0, 0, 255),
        'critical': (128, 0, 128)
    }
    
    legend_items = []
    
    for idx, issue in enumerate(issues, start=1):
        color = severity_colors.get(issue.severity.lower(), (255, 255, 255))
        points = np.array([[pt.x, pt.y] for pt in issue.dlib_68_facial_landmarks], dtype=np.int32)
        
        if len(points) == 0:
            continue
        
        overlay = annotated_bgr.copy()
        cv2.fillPoly(overlay, [points], color)
        cv2.addWeighted(overlay, 0.15, annotated_bgr, 0.85, 0, annotated_bgr)
        cv2.polylines(annotated_bgr, [points], isClosed=True, color=color, thickness=3)
        
        centroid_x = int(np.mean(points[:, 0]))
        centroid_y = int(np.mean(points[:, 1]))
        
        marker_size = 30
        cv2.circle(annotated_bgr, (centroid_x, centroid_y), marker_size // 2, color, -1)
        cv2.circle(annotated_bgr, (centroid_x, centroid_y), marker_size // 2, (255, 255, 255), 2)
        
        font = cv2.FONT_HERSHEY_SIMPLEX
        number_text = str(idx)
        (text_width, text_height), _ = cv2.getTextSize(number_text, font, 0.7, 2)
        text_x = centroid_x - text_width // 2
        text_y = centroid_y + text_height // 2
        
        cv2.putText(annotated_bgr, number_text, (text_x, text_y), font, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
        
        issue_label = issue.type.replace('_', ' ').title()
        legend_items.append({
            'number': idx,
            'label': issue_label,
            'severity': issue.severity,
            'color': color
        })
    
    # draw legend
    if legend_items:
        legend_padding = 15
        legend_x = legend_padding
        legend_y = annotated_bgr.shape[0] - legend_padding
        line_height = 28
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.45
        thickness = 1
        
        max_text_width = 0
        for item in legend_items:
            text = f"{item['number']}. {item['label']} ({item['severity']})"
            (text_width, _), _ = cv2.getTextSize(text, font, font_scale, thickness)
            max_text_width = max(max_text_width, text_width)
        
        legend_width = max_text_width + 50
        legend_height = len(legend_items) * line_height + 25
        
        legend_bg_x1 = legend_x - 8
        legend_bg_y1 = legend_y - legend_height
        legend_bg_x2 = legend_x + legend_width
        legend_bg_y2 = legend_y + 8
        
        overlay = annotated_bgr.copy()
        cv2.rectangle(overlay, (legend_bg_x1, legend_bg_y1), (legend_bg_x2, legend_bg_y2), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.7, annotated_bgr, 0.3, 0, annotated_bgr)
        cv2.rectangle(annotated_bgr, (legend_bg_x1, legend_bg_y1), (legend_bg_x2, legend_bg_y2), (255, 255, 255), 2)
        
        title_y = legend_bg_y1 + 20
        cv2.putText(annotated_bgr, "Detected Issues:", (legend_x, title_y), font, font_scale + 0.05, (255, 255, 255), thickness + 1, cv2.LINE_AA)
        
        current_y = title_y + 12
        for item in legend_items:
            current_y += line_height
            
            circle_x = legend_x + 10
            circle_y = current_y - 8
            cv2.circle(annotated_bgr, (circle_x, circle_y), 10, item['color'], -1)
            cv2.circle(annotated_bgr, (circle_x, circle_y), 10, (255, 255, 255), 1)
            
            num_text = str(item['number'])
            (num_width, num_height), _ = cv2.getTextSize(num_text, font, 0.4, 1)
            cv2.putText(annotated_bgr, num_text, (circle_x - num_width // 2, circle_y + num_height // 2), font, 0.4, (255, 255, 255), 1, cv2.LINE_AA)
            
            text = f"{item['label']} ({item['severity']})"
            cv2.putText(annotated_bgr, text, (legend_x + 30, current_y), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
    
    annotated_rgb = cv2.cvtColor(annotated_bgr, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(annotated_rgb)
    
    img_buffer = io.BytesIO()
    pil_image.save(img_buffer, format='PNG')
    img_buffer.seek(0)
    
    img_base64 = base64.b64encode(img_buffer.read()).decode('utf-8')
    return f"data:image/png;base64,{img_base64}"

def resize_image_for_analysis(image_array: np.ndarray, max_dimension: int = 768) -> np.ndarray:
    """resize image to reduce token consumption for openai"""
    height, width = image_array.shape[:2]
    
    if max(height, width) <= max_dimension:
        return image_array
    
    if height > width:
        new_height = max_dimension
        new_width = int(width * (max_dimension / height))
    else:
        new_width = max_dimension
        new_height = int(height * (max_dimension / width))
    
    from cv2 import resize, INTER_AREA
    resized = resize(image_array, (new_width, new_height), interpolation=INTER_AREA)
    return resized

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
            "annotate_issues": "POST /api/v1/annotate-issues",
            "annotate_issues_from_url": "POST /api/v1/annotate-issues-from-url",
            "resize_image": "POST /api/v1/resize-image",
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
    """detect 68 facial landmarks from image URL and return annotated image"""
    try:
        parsed_url = urlparse(request.image_url)
        if not parsed_url.scheme or not parsed_url.netloc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid image URL provided"
            )
        
        try:
            response = requests.get(request.image_url, timeout=10)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to download image from URL: {str(e)}"
            )
        
        content_type = response.headers.get('content-type', '')
        if not content_type.startswith('image/'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="URL does not point to an image file"
            )
        
        image = Image.open(io.BytesIO(response.content))
        
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        image_array = np.array(image)
        landmarks = extract_landmarks(image_array)
        filename = parsed_url.path.split('/')[-1] or "image_from_url"
        
        annotated_image_data = None
        if request.include_annotation:
            annotated_image_data = annotate_image_with_landmarks(image_array, landmarks)
        
        return LandmarksResponse(
            status="success",
            landmarks=[LandmarkPoint(**point) for point in landmarks],
            total_landmarks=len(landmarks),
            image_info=ImageInfo(
                filename=filename,
                width=image.width,
                height=image.height,
                format=image.format
            ),
            annotated_image=annotated_image_data
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing image from URL: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )

@app.post("/api/v1/annotate-issues", response_model=IssueAnnotationResponse)
async def annotate_skin_issues(request: IssueAnnotationRequest):
    """annotate skin issues on base64 image"""
    try:
        image_data = request.image_data
        
        if image_data.startswith('data:image'):
            image_data = image_data.split(',', 1)[1]
        
        try:
            image_bytes = base64.b64decode(image_data)
            image = Image.open(io.BytesIO(image_bytes))
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid image data: {str(e)}"
            )
        
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        image_array = np.array(image)
        
        if not request.issues:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No issues provided for annotation"
            )
        
        annotated_image_data = annotate_image_with_issues(image_array, request.issues)
        
        return IssueAnnotationResponse(
            status="success",
            annotated_image=annotated_image_data,
            total_issues=len(request.issues),
            image_info=ImageInfo(
                filename="annotated_issues.png",
                width=image.width,
                height=image.height,
                format=image.format
            )
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error annotating issues: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )

@app.post("/api/v1/annotate-issues-from-url", response_model=IssueAnnotationResponse)
async def annotate_skin_issues_from_url(request: IssueAnnotationFromUrlRequest):
    """annotate skin issues on image from URL"""
    try:
        parsed_url = urlparse(request.image_url)
        if not parsed_url.scheme or not parsed_url.netloc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid image URL provided"
            )
        
        try:
            response = requests.get(request.image_url, timeout=10)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to download image from URL: {str(e)}"
            )
        
        content_type = response.headers.get('content-type', '')
        if not content_type.startswith('image/'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="URL does not point to an image file"
            )
        
        image = Image.open(io.BytesIO(response.content))
        
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        image_array = np.array(image)
        
        if not request.issues:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No issues provided for annotation"
            )
        
        annotated_image_data = annotate_image_with_issues(image_array, request.issues)
        filename = parsed_url.path.split('/')[-1] or "image_from_url"
        
        return IssueAnnotationResponse(
            status="success",
            annotated_image=annotated_image_data,
            total_issues=len(request.issues),
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
        logger.error(f"Error annotating issues from URL: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )

@app.post("/api/v1/resize-image", response_model=ImageResizeResponse)
async def resize_image_for_openai(request: ImageResizeRequest):
    """resize image to reduce openai token consumption"""
    try:
        parsed_url = urlparse(request.image_url)
        if not parsed_url.scheme or not parsed_url.netloc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid image URL provided"
            )
        
        try:
            response = requests.get(request.image_url, timeout=10)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to download image from URL: {str(e)}"
            )
        
        content_type = response.headers.get('content-type', '')
        if not content_type.startswith('image/'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="URL does not point to an image file"
            )
        
        image = Image.open(io.BytesIO(response.content))
        original_size = {"width": image.width, "height": image.height}
        
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        image_array = np.array(image)
        resized_array = resize_image_for_analysis(image_array, request.max_dimension)
        
        resized_image = Image.fromarray(resized_array)
        resized_size = {"width": resized_image.width, "height": resized_image.height}
        
        img_buffer = io.BytesIO()
        resized_image.save(img_buffer, format='JPEG', quality=request.quality, optimize=True)
        img_buffer.seek(0)
        
        img_base64 = base64.b64encode(img_buffer.read()).decode('utf-8')
        resized_url = f"data:image/jpeg;base64,{img_base64}"
        
        return ImageResizeResponse(
            status="success",
            resized_image_url=resized_url,
            original_size=original_size,
            resized_size=resized_size
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error resizing image: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )

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

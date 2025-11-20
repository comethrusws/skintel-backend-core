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

class IssuePoint(BaseModel):
    x: int
    y: int

class SkinIssue(BaseModel):
    type: str
    region: str
    severity: str
    visible_in: List[str]
    explanation: Optional[str] = None
    recommendations: Optional[List[str]] = None
    dlib_68_facial_landmarks: List[IssuePoint]

class IssueAnnotationResponse(BaseModel):
    status: str
    annotated_image: str  # Base64 encoded annotated image
    total_issues: int
    image_info: ImageInfo


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


def annotate_image_with_issues(image_array: np.ndarray, issues: List[SkinIssue]) -> str:
    """
    Draw skin issues on the image with numbered polygon regions and a legend
    
    Args:
        image_array: Original image as numpy array
        issues: List of skin issues with landmarks
    
    Returns:
        Base64 encoded PNG image with data URI prefix
    """
    # Create a copy to avoid modifying original
    annotated = image_array.copy()
    
    # Convert RGB to BGR for cv2
    annotated_bgr = cv2.cvtColor(annotated, cv2.COLOR_RGB2BGR)
    
    # Severity color mapping (BGR format)
    severity_colors = {
        'mild': (0, 255, 255),      # Yellow
        'moderate': (0, 165, 255),  # Orange
        'severe': (0, 0, 255),      # Red
        'critical': (128, 0, 128)   # Purple
    }
    
    # Store legend items
    legend_items = []
    
    # Helper to draw dotted polylines
    def draw_dotted_poly(img, pts, color, thickness=2, dash_len=5):
        for i in range(len(pts)):
            p1 = pts[i]
            p2 = pts[(i + 1) % len(pts)]
            
            dist = np.linalg.norm(p2 - p1)
            if dist == 0: continue
            
            dashes = int(dist / dash_len)
            if dashes == 0: continue
            
            dx = (p2[0] - p1[0]) / dashes
            dy = (p2[1] - p1[1]) / dashes
            
            for j in range(0, dashes, 2):
                start = (int(p1[0] + dx * j), int(p1[1] + dy * j))
                end = (int(p1[0] + dx * (j + 1)), int(p1[1] + dy * (j + 1)))
                cv2.line(img, start, end, color, thickness)

    # Process each issue
    for idx, issue in enumerate(issues, start=1):
        # Get color based on severity
        color = severity_colors.get(issue.severity.lower(), (255, 255, 255))
        
        # Extract points from landmarks
        points = np.array([[pt.x, pt.y] for pt in issue.dlib_68_facial_landmarks], dtype=np.int32)
        
        if len(points) == 0:
            continue
            
        # Expand region if it's an eye region
        if 'eye' in issue.region.lower():
            centroid = np.mean(points, axis=0)
            scale = 1.4  # 40% larger for eye regions
            points = (points - centroid) * scale + centroid
            points = points.astype(np.int32)
        
        # Draw dotted polygon outline (thinner border)
        draw_dotted_poly(annotated_bgr, points, color, thickness=2, dash_len=8)
        
        # Calculate centroid for number marker placement
        centroid_x = int(np.mean(points[:, 0]))
        centroid_y = int(np.mean(points[:, 1]))
        
        # Draw number marker at centroid
        marker_size = 30
        
        # Draw circle for number
        cv2.circle(annotated_bgr, (centroid_x, centroid_y), 
                   marker_size // 2, color, -1)
        cv2.circle(annotated_bgr, (centroid_x, centroid_y), 
                   marker_size // 2, (255, 255, 255), 2)
        
        # Draw number
        font = cv2.FONT_HERSHEY_SIMPLEX
        number_text = str(idx)
        (text_width, text_height), _ = cv2.getTextSize(number_text, font, 0.7, 2)
        text_x = centroid_x - text_width // 2
        text_y = centroid_y + text_height // 2
        
        cv2.putText(
            annotated_bgr,
            number_text,
            (text_x, text_y),
            font,
            0.7,
            (255, 255, 255),
            2,
            cv2.LINE_AA
        )
        
        # Add to legend
        issue_label = issue.type.replace('_', ' ').title()
        legend_items.append({
            'number': idx,
            'label': issue_label,
            'severity': issue.severity,
            'color': color
        })
    
    # Draw legend in bottom-left corner
    if legend_items:
        legend_padding = 15
        legend_x = legend_padding
        legend_y = annotated_bgr.shape[0] - legend_padding
        line_height = 28
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.45
        thickness = 1
        
        # Calculate legend dimensions
        max_text_width = 0
        for item in legend_items:
            text = f"{item['number']}. {item['label']} ({item['severity']})"
            (text_width, _), _ = cv2.getTextSize(text, font, font_scale, thickness)
            max_text_width = max(max_text_width, text_width)
        
        legend_width = max_text_width + 50
        legend_height = len(legend_items) * line_height + 25
        
        # Draw semi-transparent background for legend
        legend_bg_x1 = legend_x - 8
        legend_bg_y1 = legend_y - legend_height
        legend_bg_x2 = legend_x + legend_width
        legend_bg_y2 = legend_y + 8
        
        overlay = annotated_bgr.copy()
        cv2.rectangle(overlay, (legend_bg_x1, legend_bg_y1), (legend_bg_x2, legend_bg_y2), 
                      (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.7, annotated_bgr, 0.3, 0, annotated_bgr)
        
        # Draw border
        cv2.rectangle(annotated_bgr, (legend_bg_x1, legend_bg_y1), (legend_bg_x2, legend_bg_y2), 
                      (255, 255, 255), 2)
        
        # Draw legend title
        title_y = legend_bg_y1 + 20
        cv2.putText(
            annotated_bgr,
            "Detected Issues:",
            (legend_x, title_y),
            font,
            font_scale + 0.05,
            (255, 255, 255),
            thickness + 1,
            cv2.LINE_AA
        )
        
        # Draw each legend item
        current_y = title_y + 12
        for item in legend_items:
            current_y += line_height
            
            # Draw colored circle
            circle_x = legend_x + 10
            circle_y = current_y - 8
            cv2.circle(annotated_bgr, (circle_x, circle_y), 10, item['color'], -1)
            cv2.circle(annotated_bgr, (circle_x, circle_y), 10, (255, 255, 255), 1)
            
            # Draw number
            num_text = str(item['number'])
            (num_width, num_height), _ = cv2.getTextSize(num_text, font, 0.4, 1)
            cv2.putText(
                annotated_bgr,
                num_text,
                (circle_x - num_width // 2, circle_y + num_height // 2),
                font,
                0.4,
                (255, 255, 255),
                1,
                cv2.LINE_AA
            )
            
            # Draw text
            text = f"{item['label']} ({item['severity']})"
            cv2.putText(
                annotated_bgr,
                text,
                (legend_x + 30, current_y),
                font,
                font_scale,
                (255, 255, 255),
                thickness,
                cv2.LINE_AA
            )
    
    # Convert back to RGB
    annotated_rgb = cv2.cvtColor(annotated_bgr, cv2.COLOR_BGR2RGB)
    
    # Convert to PIL Image
    pil_image = Image.fromarray(annotated_rgb)
    
    # Save to bytes buffer
    img_buffer = io.BytesIO()
    pil_image.save(img_buffer, format='PNG')
    img_buffer.seek(0)
    
    # Encode to base64 with data URI prefix
    img_base64 = base64.b64encode(img_buffer.read()).decode('utf-8')
    return f"data:image/png;base64,{img_base64}"


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


class AnnotationRequest(BaseModel):
    image_url: str
    issues: List[SkinIssue]

@app.post("/api/v1/annotate-issues-from-url", response_model=IssueAnnotationResponse)
async def annotate_skin_issues_from_url(request: AnnotationRequest):
    """
    Annotate skin issues on an image from URL
    
    - **request**: JSON body containing image_url and list of issues
    
    Returns an annotated image with colored regions highlighting each issue.
    """
    image_url = request.image_url
    issues = request.issues
    try:
        # Validate URL
        parsed_url = urlparse(image_url)
        if not parsed_url.scheme or not parsed_url.netloc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid image URL provided"
            )
        
        # Download image
        response = requests.get(image_url, stream=True)
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to download image from URL. Status code: {response.status_code}"
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
        
        # Validate that we have issues to annotate
        if not issues:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No issues provided for annotation"
            )
        
        # Create annotated image
        annotated_image_data = annotate_image_with_issues(image_array, issues)
        
        # Extract filename from URL
        filename = parsed_url.path.split('/')[-1] or "image_from_url"
        
        return IssueAnnotationResponse(
            status="success",
            annotated_image=annotated_image_data,
            total_issues=len(issues),
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

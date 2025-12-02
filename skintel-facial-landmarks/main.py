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
import mediapipe as mp

mp_face_mesh = mp.solutions.face_mesh
face_mesh = None

# MediaPipe Face Mesh Landmark Indices
LANDMARK_INDICES = {
    'lips': [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
    'left_eye': [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
    'right_eye': [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    'left_eyebrow': [276, 283, 282, 295, 285, 300, 293, 334, 296, 336],
    'right_eyebrow': [46, 53, 52, 65, 55, 70, 63, 105, 66, 107],
    'nose': [1, 2, 98, 327, 195, 5, 4, 275, 440, 220, 45, 274, 237, 44, 19], # Simplified nose
    'face_oval': [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
    'forehead': [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109] # Fallback to face oval or specific forehead points if needed
}

def get_region_landmarks(region_name: str) -> List[int]:
    region_name = region_name.lower()
    if 'lip' in region_name or 'mouth' in region_name:
        return LANDMARK_INDICES['lips']
    elif 'left_eye' in region_name: # Specific eye
        return LANDMARK_INDICES['left_eye']
    elif 'right_eye' in region_name:
        return LANDMARK_INDICES['right_eye']
    elif 'eye' in region_name: # General eye - tricky, maybe return both or handle logic elsewhere. For now default to both if generic 'eye' but usually issues are specific.
        # If generic 'eye' is passed, we might need to check which eye the issue coordinates are closer to, 
        # but the current logic re-detects. 
        # Let's assume the issue region string is specific enough or we default to face oval if unknown.
        return LANDMARK_INDICES['left_eye'] + LANDMARK_INDICES['right_eye'] 
    elif 'eyebrow' in region_name:
        return LANDMARK_INDICES['left_eyebrow'] + LANDMARK_INDICES['right_eyebrow']
    elif 'nose' in region_name:
        return LANDMARK_INDICES['nose']
    elif 'forehead' in region_name:
         # Approximate forehead using top of face oval and some brow points
         return [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377] 
    elif 'cheek' in region_name:
        # Cheeks are hard to define with just lines, maybe just use face oval or specific cheek contours
        return LANDMARK_INDICES['face_oval']
    else:
        return LANDMARK_INDICES['face_oval']

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
    annotated_image: str
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
    global predictor, face_mesh
    try:
        predictor_path = "shape_predictor_68_face_landmarks.dat"
        predictor = dlib.shape_predictor(predictor_path)
        logger.info("Dlib predictor loaded successfully")
        
        face_mesh = mp_face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5
        )
        logger.info("MediaPipe Face Mesh loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load predictors: {e}")
        raise

def extract_landmarks(image_array: np.ndarray) -> List[Dict[str, int]]:
    """extract all 68 facial landmarks from img"""
    height, width = image_array.shape[:2]
    max_width = 800
    scale = 1.0
    
    processing_image = image_array
    if width > max_width:
        scale = max_width / width
        new_height = int(height * scale)
        processing_image = cv2.resize(image_array, (max_width, new_height))
    
    gray = cv2.cvtColor(processing_image, cv2.COLOR_RGB2GRAY)
    faces = detector(gray)
    
    if len(faces) == 0:
        if scale != 1.0:
            gray = cv2.cvtColor(image_array, cv2.COLOR_RGB2GRAY)
            faces = detector(gray)
            scale = 1.0
            
        if len(faces) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No face detected in the image"
            )
    
    face = faces[0]
    if scale == 1.0 and processing_image.shape != image_array.shape:
         processing_image = image_array
         
    landmarks = predictor(gray, face)
    
    landmark_points = []
    for i in range(68):
        x = landmarks.part(i).x
        y = landmarks.part(i).y
        
        if scale != 1.0:
            x = int(x / scale)
            y = int(y / scale)
            
        landmark_points.append({"x": int(x), "y": int(y), "index": i})
    
    return landmark_points


def annotate_image_with_issues(image_array: np.ndarray, issues: List[SkinIssue]) -> str:
    """
    Draw skin issues on the image using MediaPipe Face Mesh for smoother contours.
    
    Args:
        image_array: Original image as numpy array (RGB)
        issues: List of skin issues
    
    Returns:
        Base64 encoded PNG image with data URI prefix
    """
    # MediaPipe expects RGB
    results = face_mesh.process(image_array)
    
    annotated = image_array.copy()
    # Convert to BGR for OpenCV drawing
    annotated_bgr = cv2.cvtColor(annotated, cv2.COLOR_RGB2BGR)
    
    if not results.multi_face_landmarks:
        logger.warning("No face detected by MediaPipe for annotation")
        # Fallback or return original? Let's return original with a warning or try to use the passed landmarks (which are dlib based and bad, but better than nothing)
        # For now, let's just return the image with legend but no drawings if no face found, or maybe just the dlib points if we really wanted to support fallback.
        # But the user specifically hates the dlib points.
        pass
    else:
        face_landmarks = results.multi_face_landmarks[0]
        h, w, _ = annotated_bgr.shape
        
        severity_colors = {
            'mild': (0, 255, 255),     # Yellow
            'moderate': (0, 165, 255), # Orange
            'severe': (0, 0, 255),     # Red
            'critical': (128, 0, 128)  # Purple
        }
        
        for idx, issue in enumerate(issues, start=1):
            color = severity_colors.get(issue.severity.lower(), (255, 255, 255))
            
            # Determine which landmarks to use based on region
            indices = get_region_landmarks(issue.region)
            
            # If we have specific dlib landmarks in the issue, we might want to find the closest MediaPipe region
            # But for now, we rely on the region name mapping.
            
            # Extract points
            points = []
            for index in indices:
                lm = face_landmarks.landmark[index]
                x, y = int(lm.x * w), int(lm.y * h)
                points.append([x, y])
            
            points = np.array(points, dtype=np.int32)
            
            if len(points) > 0:
                # Draw smooth closed contour
                # cv2.polylines(annotated_bgr, [points], isClosed=True, color=color, thickness=2, lineType=cv2.LINE_AA)
                
                # To make it look even better/smoother, we can use a convex hull or just the points if they are ordered.
                # MediaPipe points for eyes/lips are ordered. For others they might not be.
                # Let's try convex hull for regions that might be unordered or scattered
                if 'eye' in issue.region.lower() or 'lip' in issue.region.lower():
                     cv2.polylines(annotated_bgr, [points], isClosed=True, color=color, thickness=2, lineType=cv2.LINE_AA)
                else:
                    hull = cv2.convexHull(points)
                    cv2.polylines(annotated_bgr, [hull], isClosed=True, color=color, thickness=2, lineType=cv2.LINE_AA)

    # Draw Legend (reuse existing logic mostly)
    legend_items = []
    severity_colors = {
        'mild': (0, 255, 255),
        'moderate': (0, 165, 255),
        'severe': (0, 0, 255),
        'critical': (128, 0, 128)
    }
    
    for idx, issue in enumerate(issues, start=1):
        color = severity_colors.get(issue.severity.lower(), (255, 255, 255))
        issue_label = issue.type.replace('_', ' ').title()
        legend_items.append({
            'number': idx,
            'label': issue_label,
            'severity': issue.severity,
            'color': color
        })
    
    if legend_items:
        legend_padding = 15
        legend_x = legend_padding
        legend_y = annotated_bgr.shape[0] - legend_padding
        line_height = 28
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.35
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
        cv2.rectangle(overlay, (legend_bg_x1, legend_bg_y1), (legend_bg_x2, legend_bg_y2), 
                      (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.7, annotated_bgr, 0.3, 0, annotated_bgr)
        
        cv2.rectangle(annotated_bgr, (legend_bg_x1, legend_bg_y1), (legend_bg_x2, legend_bg_y2), 
                      (255, 255, 255), 2)
        
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
        
        current_y = title_y + 12
        for item in legend_items:
            current_y += line_height
            
            circle_x = legend_x + 10
            circle_y = current_y - 8
            cv2.circle(annotated_bgr, (circle_x, circle_y), 10, item['color'], -1)
            cv2.circle(annotated_bgr, (circle_x, circle_y), 10, (255, 255, 255), 1)
            
            num_text = str(item['number'])
            (num_width, num_height), _ = cv2.getTextSize(num_text, font, 0.3, 1)
            cv2.putText(
                annotated_bgr,
                num_text,
                (circle_x - num_width // 2, circle_y + num_height // 2),
                font,
                0.3,
                (255, 255, 255),
                1,
                cv2.LINE_AA
            )
            
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
    
    annotated_rgb = cv2.cvtColor(annotated_bgr, cv2.COLOR_BGR2RGB)
    
    pil_image = Image.fromarray(annotated_rgb)
    
    img_buffer = io.BytesIO()
    pil_image.save(img_buffer, format='PNG')
    img_buffer.seek(0)
    
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
        parsed_url = urlparse(image_url)
        if not parsed_url.scheme or not parsed_url.netloc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid image URL provided"
            )
        
        response = requests.get(image_url, stream=True)
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to download image from URL. Status code: {response.status_code}"
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
        
        if not issues:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No issues provided for annotation"
            )
            
        max_annotation_width = 1024
        height, width = image_array.shape[:2]
        
        if width > max_annotation_width:
            scale = max_annotation_width / width
            new_height = int(height * scale)
            image_array = cv2.resize(image_array, (max_annotation_width, new_height))
            
            for issue in issues:
                for point in issue.dlib_68_facial_landmarks:
                    point.x = int(point.x * scale)
                    point.y = int(point.y * scale)
        
        annotated_image_data = annotate_image_with_issues(image_array, issues)
        
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

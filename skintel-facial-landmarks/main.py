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
from scipy.interpolate import splprep, splev

mp_face_mesh = mp.solutions.face_mesh
face_mesh = None

LANDMARK_INDICES = {
    'lips': [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
    'left_eye': [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 359, 255, 339, 254, 253, 252, 256, 341],
    'right_eye': [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 130, 25, 110, 24, 23, 22, 26, 112],
    'left_eyebrow': [276, 283, 282, 295, 285, 300, 293, 334, 296, 336],
    'right_eyebrow': [46, 53, 52, 65, 55, 70, 63, 105, 66, 107],
    'nose': [1, 2, 98, 327, 195, 5, 4, 275, 440, 220, 45, 274, 237, 44, 19],
    'face_oval': [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
    'forehead': [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 67, 109, 10],
    'left_under_eye': [111, 117, 118, 119, 120, 121, 128, 245, 193, 122, 196, 3, 51, 45],
    'right_under_eye': [340, 346, 347, 348, 349, 350, 357, 465, 417, 351, 419, 248, 281, 275],
    'left_tear_trough': [111, 117, 118, 119, 120, 121, 128, 245],
    'right_tear_trough': [340, 346, 347, 348, 349, 350, 357, 465],
    'left_cheek': [266, 426, 436, 416, 376, 352, 280, 330],
    'right_cheek': [36, 206, 216, 192, 147, 123, 50, 101],
    't_zone': [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 19, 94, 2]
}

def get_region_landmarks(region_name: str, is_dark_circle: bool = False) -> List[int]:
    region_name = region_name.lower()
    
    if is_dark_circle and 'eye' in region_name:
        if 'left' in region_name:
            return LANDMARK_INDICES['left_under_eye']
        elif 'right' in region_name:
            return LANDMARK_INDICES['right_under_eye']
        else:
            return LANDMARK_INDICES['left_under_eye'] + LANDMARK_INDICES['right_under_eye']
    
    if 'under' in region_name and 'eye' in region_name:
        if 'left' in region_name:
            return LANDMARK_INDICES['left_under_eye']
        elif 'right' in region_name:
            return LANDMARK_INDICES['right_under_eye']
        else:
            return LANDMARK_INDICES['left_under_eye'] + LANDMARK_INDICES['right_under_eye']
    elif 'lip' in region_name or 'mouth' in region_name:
        return LANDMARK_INDICES['lips']
    elif 'left_eye' in region_name:
        return LANDMARK_INDICES['left_eye']
    elif 'right_eye' in region_name:
        return LANDMARK_INDICES['right_eye']
    elif 'eye' in region_name:
        return LANDMARK_INDICES['left_eye'] + LANDMARK_INDICES['right_eye']
    elif 'eyebrow' in region_name:
        return LANDMARK_INDICES['left_eyebrow'] + LANDMARK_INDICES['right_eyebrow']
    elif 'nose' in region_name:
        return LANDMARK_INDICES['nose']
    elif 'forehead' in region_name:
        return LANDMARK_INDICES['forehead']
    elif 't_zone' in region_name or 't-zone' in region_name:
        return LANDMARK_INDICES['t_zone']
    elif 'cheek' in region_name:
        if 'left' in region_name:
            return LANDMARK_INDICES['left_cheek']
        elif 'right' in region_name:
            return LANDMARK_INDICES['right_cheek']
        else:
            return LANDMARK_INDICES['left_cheek'] + LANDMARK_INDICES['right_cheek']
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
    issues: List[SkinIssue]
    image_info: ImageInfo


app = FastAPI(
    title="Skintel Facial Landmarks API",
    description="microservice for facial landmarks detection for Skintel",
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


def get_smooth_curve(points: np.ndarray, num_points: int = 100) -> np.ndarray:
    if len(points) < 3:
        return points
        
    points = np.vstack((points, points[0]))
    
    try:
        tck, u = splprep(points.T, u=None, s=0.0, per=1)
        u_new = np.linspace(u.min(), u.max(), num_points)
        x_new, y_new = splev(u_new, tck, der=0)
        
        smooth_points = np.column_stack((x_new, y_new)).astype(np.int32)
        return smooth_points
    except Exception as e:
        logger.warning(f"Spline interpolation failed: {e}")
        return points[:-1]

def fill_region_with_dots(polygon: np.ndarray, num_dots: int, seed: int = 42) -> np.ndarray:
    """
    Generate random points inside a polygon using rejection sampling.
    """
    if len(polygon) < 3:
        return polygon

    x, y, w, h = cv2.boundingRect(polygon)
    dots = []
    
    rng = np.random.RandomState(seed)
    
    attempts = 0
    max_attempts = num_dots * 20  # Prevent infinite loop
    
    while len(dots) < num_dots and attempts < max_attempts:
        rand_x = rng.randint(x, x + w)
        rand_y = rng.randint(y, y + h)
        
        # Check if point is inside polygon (measureDist=False)
        # Returns +1 if inside, -1 if outside, 0 on edge
        if cv2.pointPolygonTest(polygon, (rand_x, rand_y), False) > 0:
            dots.append([rand_x, rand_y])
            
        attempts += 1
        
    return np.array(dots, dtype=np.int32)

def annotate_image_with_issues(image_array: np.ndarray, issues: List[SkinIssue]) -> str:
    """
    Annotate image with Lovi-style markers:
    - Translucent white lines for wrinkles/fine lines (alpha blended)
    - Translucent white SCATTERED dots for spots (region filling)
    - Legend matching reference style
    """
    results = face_mesh.process(image_array)
    
    annotated = image_array.copy()
    annotated_bgr = cv2.cvtColor(annotated, cv2.COLOR_RGB2BGR)
    h, w, _ = annotated_bgr.shape
    
    # Create a separate overlay for drawing to enable alpha blending
    overlay = annotated_bgr.copy()
    
    # Lovi visual style parameters
    ANNOTATION_ALPHA = 0.75 
    
    DOT_RADIUS = 3
    DOT_COLOR = (255, 255, 255)
    LINE_COLOR = (255, 255, 255)
    LINE_THICKNESS = 2
    
    # Issues drawn as lines
    LINE_ISSUE_TYPES = [
        'wrinkles', 'wrinkle', 'fine_lines', 'fine lines', 
        'crow_feet', 'nasolabial_folds', 'lines'
    ]
    
    # Issues drawn as dots
    DOT_ISSUE_TYPES = [
        'acne', 'pimple', 'moles', 'freckles', 'pores', 
        'blackheads', 'spots', 'blemishes', 'redness'
    ]
    
    if not results.multi_face_landmarks:
        logger.warning("No face detected by MediaPipe")
    else:
        face_landmarks = results.multi_face_landmarks[0]
        
        for idx, issue in enumerate(issues):
            issue_type_lower = issue.type.lower().replace(' ', '_')
            region_lower = issue.region.lower()
            
            # 1. SPECIAL CASE: Dark Circles -> Smooth Crescent
            is_dark_circle = issue_type_lower in ['dark_circles', 'eye_bags', 'puffy_eyes', 'under_eye_circles']
            
            if is_dark_circle:
                # Use simplified tear trough landmarks
                if 'left' in region_lower:
                    indices = [362, 382, 381, 380, 374, 373, 390, 249, 263]
                elif 'right' in region_lower:
                    indices = [33, 7, 163, 144, 145, 153, 154, 155, 133]
                else:
                    indices = [362, 382, 381, 380, 374, 373, 390, 249, 263]
            
            # 2. STANDARD MAPPING
            elif issue_type_lower in ['uneven_skin_tone', 'hyperpigmentation']:
                if 'cheek' in region_lower:
                    indices = LANDMARK_INDICES['left_cheek'] if 'left' in region_lower else LANDMARK_INDICES['right_cheek']
                else:
                    indices = get_region_landmarks(issue.region)
            else:
                indices = get_region_landmarks(issue.region)
            
            # Extract boundary points
            points = []
            for index in indices:
                lm = face_landmarks.landmark[index]
                x, y = int(lm.x * w), int(lm.y * h)
                points.append([x, y])
            points = np.array(points, dtype=np.int32)
            
            if len(points) == 0: continue
            
            # Determine drawing style
            is_dot_issue = any(t in issue_type_lower for t in DOT_ISSUE_TYPES)
            is_line_issue = any(t in issue_type_lower for t in LINE_ISSUE_TYPES) or is_dark_circle
            
            # --- DRAWING LOGIC ---
            
            if is_dark_circle:
                # Force a smooth downward curve (crescent)
                sorted_pts = points[np.argsort(points[:, 0])]
                offset_y = int(h * 0.015)
                sorted_pts[:, 1] += offset_y
                
                try:
                    tck, u = splprep(sorted_pts.T, u=None, s=30.0, per=0)
                    u_new = np.linspace(0, 1, 40)
                    x_new, y_new = splev(u_new, tck, der=0)
                    curve_pts = np.column_stack((x_new, y_new)).astype(np.int32)
                    cv2.polylines(overlay, [curve_pts], False, LINE_COLOR, LINE_THICKNESS, cv2.LINE_AA)
                except:
                    cv2.polylines(overlay, [sorted_pts], False, LINE_COLOR, LINE_THICKNESS, cv2.LINE_AA)
            
            elif is_line_issue and len(points) > 3:
                # Wrinkles: Smooth lines
                sorted_pts = points[np.argsort(points[:, 0])]
                try:
                    tck, u = splprep(sorted_pts.T, u=None, s=15.0, per=0)
                    u_new = np.linspace(0, 1, 40)
                    x_new, y_new = splev(u_new, tck, der=0)
                    curve_pts = np.column_stack((x_new, y_new)).astype(np.int32)
                    cv2.polylines(overlay, [curve_pts], False, LINE_COLOR, LINE_THICKNESS, cv2.LINE_AA)
                except:
                    cv2.polylines(overlay, [sorted_pts], False, LINE_COLOR, LINE_THICKNESS, cv2.LINE_AA)
            
            elif is_dot_issue:
                # Region Filling: Scatter dots inside the polygon
                # Determine density based on severity
                severity_map = {'mild': 12, 'moderate': 25, 'severe': 45}
                num_dots = severity_map.get(issue.severity.lower(), 15)
                
                # Generate points inside the region polygon
                scatter_points = fill_region_with_dots(points, num_dots, seed=42 + idx)
                
                # Draw the scattered dots
                for pt in scatter_points:
                    cv2.circle(overlay, (pt[0], pt[1]), DOT_RADIUS, DOT_COLOR, -1, cv2.LINE_AA)
                    
                # Store these scattered points for the response metadata
                issue.dlib_68_facial_landmarks = [IssuePoint(x=int(p[0]), y=int(p[1])) for p in scatter_points]

            else:
                # Fallback: Single center dot
                center = np.mean(points, axis=0).astype(int)
                cv2.circle(overlay, (center[0], center[1]), DOT_RADIUS + 1, DOT_COLOR, -1, cv2.LINE_AA)
                issue.dlib_68_facial_landmarks = [IssuePoint(x=int(center[0]), y=int(center[1]))]

    # Apply alpha blending for drawing
    cv2.addWeighted(overlay, ANNOTATION_ALPHA, annotated_bgr, 1 - ANNOTATION_ALPHA, 0, annotated_bgr)

    # --- LEGEND ---
    if issues:
        legend_height = min(len(issues) * 25 + 40, 150)
        legend_margin = 15
        
        # Dark overlay
        legend_overlay = annotated_bgr.copy()
        cv2.rectangle(legend_overlay, 
                     (legend_margin, h - legend_height - legend_margin),
                     (w - legend_margin, h - legend_margin),
                     (20, 20, 20), -1)
        cv2.addWeighted(legend_overlay, 0.85, annotated_bgr, 0.15, 0, annotated_bgr)
        
        # White border
        cv2.rectangle(annotated_bgr,
                     (legend_margin, h - legend_height - legend_margin),
                     (w - legend_margin, h - legend_margin),
                     (255, 255, 255), 1)
        
        # Text settings
        font = cv2.FONT_HERSHEY_SIMPLEX
        base_y = h - legend_height - legend_margin + 25
        
        
        base_y += 10
        
        for i, issue in enumerate(issues[:4]):
            base_y += 22
            region_name = issue.region.replace('_', ' ').title()
            issue_name = issue.type.replace('_', ' ').title()
            severity = issue.severity.lower()
            
            text = f"{region_name}: {issue_name} ({severity})"
            if len(text) > 55: text = text[:52] + "..."
            cv2.putText(annotated_bgr, text, (legend_margin + 15, base_y), 
                       font, 0.45, (220, 220, 220), 1, cv2.LINE_AA)
        
        if len(issues) > 4:
            base_y += 22
            cv2.putText(annotated_bgr, f"... (+{len(issues)-4} more)", 
                       (legend_margin + 15, base_y), font, 0.45, (180, 180, 180), 1, cv2.LINE_AA)

    # Convert to base64
    annotated_rgb = cv2.cvtColor(annotated_bgr, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(annotated_rgb)
    img_buffer = io.BytesIO()
    pil_image.save(img_buffer, format='PNG')
    img_buffer.seek(0)
    return f"data:image/png;base64,{base64.b64encode(img_buffer.read()).decode('utf-8')}"

@app.get("/", response_model=Dict[str, str])
async def get_api_info():
    return {
        "service": "Skintel Facial Landmarks API",
        "version": "1.0.0",
        "description": "microservice for facial landmarks detection for Skintel",
        "endpoints": {
            "health": "GET /health",
            "landmarks": "POST /api/v1/landmarks",
            "docs": "GET /docs"
        }
    }

@app.get("/health", response_model=HealthResponse)
async def get_health():
    return HealthResponse(
        status="healthy",
        service="facial-landmarks-api",
        version="1.0.0"
    )

@app.post("/api/v1/landmarks", response_model=LandmarksResponse)
async def create_landmarks_detection(request: ImageUrlRequest):
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
            issues=issues,
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

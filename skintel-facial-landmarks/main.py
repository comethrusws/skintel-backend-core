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

# MediaPipe Face Mesh Landmark Indices
LANDMARK_INDICES = {
    'lips': [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
    # Extended eye regions - taller to touch under-eye area
    'left_eye': [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 359, 255, 339, 254, 253, 252, 256, 341],
    'right_eye': [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 130, 25, 110, 24, 23, 22, 26, 112],
    'left_eyebrow': [276, 283, 282, 295, 285, 300, 293, 334, 296, 336],
    'right_eyebrow': [46, 53, 52, 65, 55, 70, 63, 105, 66, 107],
    'nose': [1, 2, 98, 327, 195, 5, 4, 275, 440, 220, 45, 274, 237, 44, 19],
    'face_oval': [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
    'forehead': [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 67, 109, 10],
    # Tear trough regions - precise infraorbital fold where dark circles appear
    # These landmarks trace the crescent-shaped area directly below the lower lash line
    'left_under_eye': [111, 117, 118, 119, 120, 121, 128, 245, 193, 122, 196, 3, 51, 45],
    'right_under_eye': [340, 346, 347, 348, 349, 350, 357, 465, 417, 351, 419, 248, 281, 275],
    # Specific tear trough for dark circles - tighter crescent under eye
    'left_tear_trough': [111, 117, 118, 119, 120, 121, 128, 245],
    'right_tear_trough': [340, 346, 347, 348, 349, 350, 357, 465],
    # Smaller cheek areas - just the prominent cheek zone
    'left_cheek': [266, 426, 436, 416, 376, 352, 280, 330],
    'right_cheek': [36, 206, 216, 192, 147, 123, 50, 101],
    # T-zone smaller region
    't_zone': [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 19, 94, 2]
}

def get_region_landmarks(region_name: str, is_dark_circle: bool = False) -> List[int]:
    """
    Get landmark indices for a given region name.
    
    Args:
        region_name: Name of the facial region
        is_dark_circle: If True, forces under-eye region for eye-related queries
    """
    region_name = region_name.lower()
    
    # If it's a dark circle, ALWAYS return under-eye landmarks
    if is_dark_circle and 'eye' in region_name:
        if 'left' in region_name:
            return LANDMARK_INDICES['left_under_eye']
        elif 'right' in region_name:
            return LANDMARK_INDICES['right_under_eye']
        else:
            return LANDMARK_INDICES['left_under_eye'] + LANDMARK_INDICES['right_under_eye']
    
    # Prioritize under-eye detection for under-eye keywords
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


def get_smooth_curve(points: np.ndarray, num_points: int = 100) -> np.ndarray:
    """
    Generate a smooth curve from a set of points using spline interpolation.
    """
    if len(points) < 3:
        return points
        
    # Close the loop for interpolation
    points = np.vstack((points, points[0]))
    
    try:
        tck, u = splprep(points.T, u=None, s=0.0, per=1)
        u_new = np.linspace(u.min(), u.max(), num_points)
        x_new, y_new = splev(u_new, tck, der=0)
        
        smooth_points = np.column_stack((x_new, y_new)).astype(np.int32)
        return smooth_points
    except Exception as e:
        logger.warning(f"Spline interpolation failed: {e}")
        return points[:-1] # Return original points without the closing duplicate

def annotate_image_with_issues(image_array: np.ndarray, issues: List[SkinIssue]) -> str:
    results = face_mesh.process(image_array)
    
    annotated = image_array.copy()
    annotated_bgr = cv2.cvtColor(annotated, cv2.COLOR_RGB2BGR)
    
    if not results.multi_face_landmarks:
        logger.warning("No face detected by MediaPipe for annotation")
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
            
            # Dark circle and under-eye specific detection
            is_dark_circle = issue.type.lower() in [
                'dark_circles', 'dark circles', 'eye_bags', 
                'puffy_eyes', 'under_eye_circles', 'under-eye circles',
                'dark_circle', 'eye bags', 'puffy eyes', 'under eye'
            ]
            
            if is_dark_circle:
                # Force tear trough region for dark circles - the infraorbital fold
                if 'left' in issue.region.lower():
                    indices = LANDMARK_INDICES['left_tear_trough']
                elif 'right' in issue.region.lower():
                    indices = LANDMARK_INDICES['right_tear_trough']
                else:
                    # If no specific side mentioned, mark both tear troughs
                    indices = LANDMARK_INDICES['left_tear_trough'] + LANDMARK_INDICES['right_tear_trough']
            # Special handling for uneven skin tone - use broader regions
            elif issue.type.lower() in ['uneven_skin_tone', 'uneven skin tone', 'hyperpigmentation', 'post_inflammatory_hyperpigmentation']:
                if 'cheek' in issue.region.lower():
                    if 'left' in issue.region.lower():
                        indices = LANDMARK_INDICES['left_cheek']
                    elif 'right' in issue.region.lower():
                        indices = LANDMARK_INDICES['right_cheek']
                    else:
                        indices = get_region_landmarks(issue.region, is_dark_circle=False)
                elif 't' in issue.region.lower() and 'zone' in issue.region.lower():
                    indices = LANDMARK_INDICES['t_zone']
                else:
                    indices = get_region_landmarks(issue.region, is_dark_circle=False)
            else:
                # For all other issues, use the normal region detection
                indices = get_region_landmarks(issue.region, is_dark_circle=False)
            
            points = []
            for index in indices:
                lm = face_landmarks.landmark[index]
                x, y = int(lm.x * w), int(lm.y * h)
                points.append([x, y])
            
            points = np.array(points, dtype=np.int32)
            
            # Update the issue's landmarks with the actual coordinates used
            issue.dlib_68_facial_landmarks = [IssuePoint(x=int(p[0]), y=int(p[1])) for p in points]
            
            if len(points) > 0:
                # For dark circles and under-eye issues, draw a crescent/moon shape
                # This is a closed shape that covers the tear trough without going over the eye
                if is_dark_circle or 'under' in issue.region.lower():
                    # Sort points from left to right for a proper arc
                    sorted_points = points[np.argsort(points[:, 0])]
                    
                    if len(sorted_points) >= 3:
                        try:
                            from scipy.interpolate import splprep, splev
                            
                            # Shift points up to be closer to the eye
                            # Move the whole shape upward to hug the lower eyelid
                            upward_shift = int(h * 0.025)  # Shift up by 2.5% of image height
                            sorted_points_shifted = sorted_points.copy().astype(float)
                            sorted_points_shifted[:, 1] -= upward_shift
                            
                            # Create the top edge (shifted tear trough curve - closer to eye)
                            tck_top, u_top = splprep(sorted_points_shifted.T, u=None, s=0.0, per=0)
                            u_new = np.linspace(u_top.min(), u_top.max(), 40)
                            x_top, y_top = splev(u_new, tck_top, der=0)
                            top_curve = np.column_stack((x_top, y_top))
                            
                            # Create the bottom edge by offsetting downward from the shifted position
                            # Increased thickness for a taller crescent
                            offset_y = int(h * 0.05)  # Crescent thickness - 5% of image height (taller)
                            bottom_points = sorted_points_shifted.copy()
                            bottom_points[:, 1] += offset_y
                            
                            # Smooth the bottom curve
                            tck_bottom, u_bottom = splprep(bottom_points.T, u=None, s=0.0, per=0)
                            x_bottom, y_bottom = splev(u_new, tck_bottom, der=0)
                            bottom_curve = np.column_stack((x_bottom, y_bottom))
                            
                            # Combine: top curve left-to-right, then bottom curve right-to-left (to close the shape)
                            crescent_raw = np.vstack([top_curve, bottom_curve[::-1]])
                            
                            # Smooth the entire crescent shape with high smoothing to round the edges
                            # Use much higher smoothing factor to eliminate sharp corners
                            try:
                                tck_smooth, u_smooth = splprep(crescent_raw.T, u=None, s=50.0, per=1)  # High smoothing, closed curve
                                u_final = np.linspace(0, 1, 200)
                                x_smooth, y_smooth = splev(u_final, tck_smooth, der=0)
                                crescent_shape = np.column_stack((x_smooth, y_smooth)).astype(np.int32)
                            except:
                                crescent_shape = crescent_raw.astype(np.int32)
                            
                            # Draw the closed crescent outline
                            cv2.polylines(annotated_bgr, [crescent_shape], isClosed=True, color=color, thickness=2, lineType=cv2.LINE_AA)
                        except Exception as e:
                            logger.warning(f"Spline interpolation failed for dark circle: {e}")
                            # Fallback: create a simple offset crescent
                            upward_shift = int(h * 0.025)
                            offset_y = int(h * 0.05)
                            top_points = sorted_points.copy()
                            top_points[:, 1] -= upward_shift
                            bottom_points = top_points.copy()
                            bottom_points[:, 1] += offset_y
                            crescent = np.vstack([top_points, bottom_points[::-1]])
                            cv2.polylines(annotated_bgr, [crescent], isClosed=True, color=color, thickness=2, lineType=cv2.LINE_AA)
                    else:
                        cv2.polylines(annotated_bgr, [sorted_points], isClosed=False, color=color, thickness=2, lineType=cv2.LINE_AA)
                # For eyes and lips, use smooth curves
                elif 'eye' in issue.region.lower() or 'lip' in issue.region.lower():
                    smooth_points = get_smooth_curve(points)
                    cv2.polylines(annotated_bgr, [smooth_points], isClosed=True, color=color, thickness=1, lineType=cv2.LINE_AA)
                else:
                    # For other regions, use convex hull
                    hull = cv2.convexHull(points)
                    hull = np.squeeze(hull)
                    if len(hull.shape) == 1: # Handle case with single point or malformed hull
                         hull = hull.reshape(-1, 2)
                         
                    smooth_points = get_smooth_curve(hull)
                    cv2.polylines(annotated_bgr, [smooth_points], isClosed=True, color=color, thickness=1, lineType=cv2.LINE_AA)

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
            issues=issues,  # Return updated issues with correct landmarks
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

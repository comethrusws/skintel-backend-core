# Skintel Facial Landmarks API Documentation

## Overview

The Skintel Facial Landmarks API is a FastAPI-based microservice that provides facial landmark detection and skin issue annotation using MediaPipe Face Mesh and dlib. It supports high-quality image annotation with smooth, rounded contours.

**Base URL**: `http://localhost:8000`  
**Documentation**: `/docs` (Interactive Swagger UI)  
**Alternative Docs**: `/redoc` (ReDoc UI)  
**Health Check**: `GET /health`

---

## Technology Stack

- **Framework**: FastAPI
- **Language**: Python 3.8+
- **Face Detection**: 
  - dlib (68-point landmarks for legacy detection)
  - MediaPipe Face Mesh (468-point landmarks for annotations)
- **Image Processing**: OpenCV, Pillow
- **Validation**: Pydantic
- **Scientific Computing**: NumPy, SciPy

---

## Endpoints

### Health Check

#### Get Service Health
```
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "service": "facial-landmarks-api",
  "version": "1.0.0"
}
```

---

### Root Endpoint

#### Get API Info
```
GET /
```

**Response:**
```json
{
  "service": "Skintel Facial Landmarks API",
  "version": "1.0.0",
  "description": "microservice for facial landmarks detection for Skintel",
  "endpoints": {
    "health": "GET /health",
    "landmarks": "POST /api/v1/landmarks",
    "docs": "GET /docs"
  }
}
```

---

### Landmark Detection

#### Detect Facial Landmarks
```
POST /api/v1/landmarks
```

Detects 68 facial landmarks from an image URL using dlib.

**Request Body:**
```json
{
  "image_url": "https://example.com/face-image.jpg"
}
```

**Response:**
```json
{
  "status": "success",
  "landmarks": [
    {
      "x": 123,
      "y": 456,
      "index": 0
    },
    ...
  ],
  "total_landmarks": 68,
  "image_info": {
    "filename": "face-image.jpg",
    "width": 800,
    "height": 600,
    "format": "JPEG"
  }
}
```

**Landmark Groups (68 points):**
- **Jaw Line**: Points 0-16
- **Right Eyebrow**: Points 17-21
- **Left Eyebrow**: Points 22-26
- **Nose Bridge**: Points 27-30
- **Nose Tip**: Points 31-35
- **Right Eye**: Points 36-41
- **Left Eye**: Points 42-47
- **Outer Lip**: Points 48-59
- **Inner Lip**: Points 60-67

**Error Responses:**
- `400`: Invalid image URL or no face detected
- `500`: Internal server error

---

### Skin Issue Annotation

#### Annotate Skin Issues on Image
```
POST /api/v1/annotate-issues-from-url
```

Annotates detected skin issues on an image with smooth, rounded contours using MediaPipe Face Mesh. Automatically re-detects facial landmarks for accurate annotation.

**Request Body:**
```json
{
  "image_url": "https://example.com/face-image.jpg",
  "issues": [
    {
      "type": "dark_circles",
      "region": "left_eye",
      "severity": "moderate",
      "visible_in": ["front"],
      "explanation": "Dark circles detected under the left eye",
      "recommendations": ["Get adequate sleep", "Use eye cream"],
      "dlib_68_facial_landmarks": []
    },
    {
      "type": "acne",
      "region": "forehead",
      "severity": "mild",
      "visible_in": ["front"],
      "dlib_68_facial_landmarks": []
    }
  ]
}
```

**Issue Object Schema:**
- `type` (string, required): Issue type (e.g., "dark_circles", "acne", "dryness")
- `region` (string, required): Facial region (e.g., "left_eye", "forehead", "lips")
- `severity` (string, required): Severity level - `"mild"`, `"moderate"`, `"severe"`, `"critical"`
- `visible_in` (array, required): List of views where issue is visible
- `explanation` (string, optional): Description of the issue
- `recommendations` (array, optional): List of recommendations
- `dlib_68_facial_landmarks` (array, required): Can be empty; service uses MediaPipe for detection

**Supported Regions:**
- `left_eye`, `right_eye`: Eye region
- `left_under_eye`, `right_under_eye`: Under-eye area (auto-selected for dark_circles)
- `left_eyebrow`, `right_eyebrow`: Eyebrow region
- `lips`, `mouth`: Lip/mouth region
- `nose`: Nose region
- `forehead`: Forehead region
- `cheek`: Cheek region
- `face_oval`: General face outline (fallback)

**Severity-Based Colors:**
- `mild`: Yellow (`#FFFF00`)
- `moderate`: Orange (`#FFA500`)
- `severe`: Red (`#FF0000`)
- `critical`: Purple (`#800080`)

**Response:**
```json
{
  "status": "success",
  "annotated_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "total_issues": 2,
  "image_info": {
    "filename": "face-image.jpg",
    "width": 800,
    "height": 600,
    "format": "JPEG"
  }
}
```

**Annotation Features:**
- **Smooth Contours**: Uses spline interpolation for organic, rounded shapes
- **Thin Lines**: 1px thickness with anti-aliasing
- **Smart Region Detection**: 
  - For `dark_circles`, `eye_bags`, `puffy_eyes`: Automatically uses under-eye region
  - For eyes and lips: Uses precise ordered landmarks
  - For other regions: Uses convex hull for scattered landmarks
- **Legend**: Bottom-left overlay showing:
  - Numbered list of issues
  - Color-coded severity indicators
  - Semi-transparent background

**Error Responses:**
- `400`: Invalid image URL, no issues provided, or no face detected
- `500`: Internal server error

---

### Landmark Info

#### Get Landmark Information
```
GET /api/v1/landmarks/info
```

Returns metadata about the 68-point facial landmark system.

**Response:**
```json
{
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
```

---

## MediaPipe Face Mesh Integration

The annotation system uses MediaPipe Face Mesh (468 landmarks) for smoother, more accurate contours:

### Key Features
1. **High Density**: 468 landmarks vs. dlib's 68
2. **Better Coverage**: More precise eye, lip, and facial contour detection
3. **Smooth Interpolation**: Spline curves for organic annotation shapes
4. **Region Mapping**: Intelligent mapping from region names to landmark indices

### Landmark Mapping

| Region | MediaPipe Indices | Description |
|--------|------------------|-------------|
| Lips | 61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185 | Full lip contour |
| Left Eye | 263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466 | Eye outline |
| Right Eye | 33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246 | Eye outline |
| Left Under-Eye | 382, 362, 263, 466, 388, 387, 386, 385, 384, 398 | Under-eye region |
| Right Under-Eye | 33, 246, 161, 160, 159, 158, 157, 173, 133, 155 | Under-eye region |
| Left Eyebrow | 276, 283, 282, 295, 285, 300, 293, 334, 296, 336 | Eyebrow contour |
| Right Eyebrow | 46, 53, 52, 65, 55, 70, 63, 105, 66, 107 | Eyebrow contour |
| Nose | 1, 2, 98, 327, 195, 5, 4, 275, 440, 220, 45, 274, 237, 44, 19 | Nose outline |
| Face Oval | 10, 338, 297, 332, 284, 251, 389, 356, 454... | Face boundary |

---

## Installation & Setup

### Prerequisites

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install cmake build-essential pkg-config
sudo apt install libx11-dev libatlas-base-dev
sudo apt install libgtk-3-dev libboost-python-dev
```

#### macOS
```bash
brew install cmake
brew install boost-python3
```

#### Windows
1. Install Visual Studio Build Tools
2. Install CMake from cmake.org
3. Add CMake to PATH

### Install Dependencies

```bash
# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install requirements
pip install -r requirements.txt
```

**requirements.txt includes:**
- `fastapi`
- `uvicorn`
- `pydantic==2.5.0`
- `dlib-bin` (pre-built dlib)
- `opencv-python`
- `mediapipe`
- `Pillow`
- `numpy`
- `scipy`
- `requests`
- `python-multipart`

### Download Landmark Model

```bash
python download_model.py
```

This downloads `shape_predictor_68_face_landmarks.dat` (95MB) from dlib's model repository.

---

## Running the Service

### Development
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Production
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

### Docker
```bash
# Build image
docker build -t skintel-facial-landmarks .

# Run container
docker run -p 8000:8000 skintel-facial-landmarks
```

---

## Usage Examples

### Python

```python
import requests

# Detect landmarks
response = requests.post(
    "http://localhost:8000/api/v1/landmarks",
    json={"image_url": "https://example.com/face.jpg"}
)
landmarks = response.json()

# Annotate issues
response = requests.post(
    "http://localhost:8000/api/v1/annotate-issues-from-url",
    json={
        "image_url": "https://example.com/face.jpg",
        "issues": [
            {
                "type": "dark_circles",
                "region": "left_eye",
                "severity": "moderate",
                "visible_in": ["front"],
                "dlib_68_facial_landmarks": []
            }
        ]
    }
)

# Save annotated image
import base64
img_data = response.json()["annotated_image"].split(",")[1]
with open("annotated.png", "wb") as f:
    f.write(base64.b64decode(img_data))
```

### cURL

```bash
# Detect landmarks
curl -X POST http://localhost:8000/api/v1/landmarks \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://example.com/face.jpg"}'

# Annotate issues
curl -X POST http://localhost:8000/api/v1/annotate-issues-from-url \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/face.jpg",
    "issues": [
      {
        "type": "acne",
        "region": "forehead",
        "severity": "mild",
        "visible_in": ["front"],
        "dlib_68_facial_landmarks": []
      }
    ]
  }'
```

---

## Error Handling

All errors return JSON format:

```json
{
  "status": "error",
  "error": "HTTP 400",
  "message": "No face detected in the image"
}
```

**Common Errors:**
- `No face detected in the image`: Image doesn't contain a detectable face
- `Invalid image URL provided`: Malformed URL
- `Failed to download image from URL`: Network error or invalid URL
- `URL does not point to an image file`: Non-image content type
- `No issues provided for annotation`: Empty issues array

---

## Performance Considerations

- **Image Size**: Large images are automatically resized to max 800px width for detection
- **Annotation Size**: Max 1024px width for annotated output
- **Processing Time**: ~500ms-2s per image depending on size
- **Memory**: ~200MB per worker process
- **Concurrency**: Use multiple workers for production

---

## Coordinate System

All landmark coordinates use image coordinate system:
- **Origin**: Top-left corner (0,0)
- **X-axis**: Increases to the right
- **Y-axis**: Increases downward
- **Units**: Pixels

---

## Limitations

1. **Single Face**: Only detects/annotates the first detected face
2. **Face Visibility**: Requires front-facing, well-lit faces
3. **Image Quality**: Works best with high-quality images (>300px width)
4. **File Formats**: Supports JPEG, PNG, WebP
5. **URL Only**: Currently only accepts image URLs (not file uploads)

---

## Future Enhancements

- Multi-face support
- File upload endpoint
- Batch processing
- Landmark-based face alignment
- 3D landmark detection
- Video/stream support

---

## API Versioning

Current version: **1.0.0**

All endpoints use `/api/v1/` prefix for versioning.

---

## Support

For issues, check:
1. Logs: Check server output for detailed error messages
2. Dependencies: Ensure all packages are correctly installed
3. Model File: Verify `shape_predictor_68_face_landmarks.dat` exists
4. Image URL: Ensure URL is publicly accessible

---

## Development Notes

### Project Structure
```
skintel-facial-landmarks/
├── main.py                              # FastAPI application
├── requirements.txt                      # Python dependencies
├── download_model.py                     # Model downloader
├── Dockerfile                            # Docker config
├── README.md                             # Installation guide
├── shape_predictor_68_face_landmarks.dat # dlib model (downloaded)
└── venv/                                 # Virtual environment
```

### Key Functions
- `extract_landmarks()`: dlib 68-point detection
- `annotate_image_with_issues()`: MediaPipe-based annotation
- `get_smooth_curve()`: Spline interpolation for smoothing
- `get_region_landmarks()`: Region name to landmark index mapping

---

## License

Proprietary - Skintel/Equalbyte

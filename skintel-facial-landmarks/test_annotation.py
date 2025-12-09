import cv2
import numpy as np
import mediapipe as mp
from main import annotate_image_with_issues, SkinIssue, IssuePoint
import os

# Initialize MediaPipe Face Mesh (normally done in startup_event)
import main
main.mp_face_mesh = mp.solutions.face_mesh
main.face_mesh = main.mp_face_mesh.FaceMesh(
    static_image_mode=True,
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.5
)

def test_annotation():
    # Path to the test image
    image_path = "../public/front.jpeg"
    
    if not os.path.exists(image_path):
        print(f"Error: Image not found at {image_path}")
        return

    # Read image
    image = cv2.imread(image_path)
    if image is None:
        print("Error: Failed to read image")
        return
    
    # Convert to RGB (OpenCV uses BGR)
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    # Define a test issue for dark circles
    issues = [
        SkinIssue(
            type="dark_circles",
            region="left_under_eye",
            severity="moderate",
            visible_in=["front"],
            dlib_68_facial_landmarks=[] # Will be populated by the function
        ),
        SkinIssue(
            type="dark_circles",
            region="right_under_eye",
            severity="moderate",
            visible_in=["front"],
            dlib_68_facial_landmarks=[]
        )
    ]

    print("Annotating image...")
    # The function returns a base64 string, but it also modifies the image in place if we were passing it differently? 
    # No, annotate_image_with_issues returns a base64 string.
    # But wait, let's look at main.py again. 
    # It takes image_array and returns a base64 string.
    
    result_base64 = annotate_image_with_issues(image_rgb, issues)
    
    print(f"Annotation complete. Result length: {len(result_base64)}")
    
    # Decode base64 and save to file for inspection
    import base64
    
    # Remove header if present
    if "base64," in result_base64:
        result_base64 = result_base64.split("base64,")[1]
        
    img_data = base64.b64decode(result_base64)
    with open("annotated_result.png", "wb") as f:
        f.write(img_data)
        
    print("Saved annotated image to 'annotated_result.png'")

if __name__ == "__main__":
    test_annotation()

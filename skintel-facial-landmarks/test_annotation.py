import requests
import base64
import json

# URL of the image to annotate
IMAGE_URL = "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=774&q=80"

# API Endpoint
API_URL = "http://localhost:8000/api/v1/annotate-issues-from-url"

# Dummy issues
issues = [
    {
        "type": "dark_circles",
        "region": "left_eye",
        "severity": "moderate",
        "visible_in": ["front"],
        "dlib_68_facial_landmarks": [] 
    },
    {
        "type": "dark_circles",
        "region": "right_eye",
        "severity": "mild",
        "visible_in": ["front"],
        "dlib_68_facial_landmarks": []
    },
    {
        "type": "dryness",
        "region": "lips",
        "severity": "mild",
        "visible_in": ["front"],
        "dlib_68_facial_landmarks": []
    },
    {
        "type": "acne",
        "region": "forehead",
        "severity": "severe",
        "visible_in": ["front"],
        "dlib_68_facial_landmarks": []
    }
]

payload = {
    "image_url": IMAGE_URL,
    "issues": issues
}

try:
    response = requests.post(API_URL, json=payload)
    response.raise_for_status()
    
    data = response.json()
    if data["status"] == "success":
        img_data = data["annotated_image"].split(",")[1]
        with open("annotated_result.png", "wb") as f:
            f.write(base64.b64decode(img_data))
        print("Successfully saved annotated_result.png")
    else:
        print("API returned error status")
        print(data)

except Exception as e:
    print(f"Error: {e}")
    if 'response' in locals():
        print(response.text)

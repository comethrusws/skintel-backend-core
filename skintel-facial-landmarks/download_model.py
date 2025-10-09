import os
import urllib.request
import bz2
import shutil

def download_dlib_model():
    """Download the dlib 68-point facial landmark predictor"""
    model_url = "http://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2"
    model_filename = "shape_predictor_68_face_landmarks.dat"
    compressed_filename = f"{model_filename}.bz2"
    
    if os.path.exists(model_filename):
        print(f"{model_filename} already exists.")
        return
    
    print("Downloading dlib facial landmark predictor...")
    urllib.request.urlretrieve(model_url, compressed_filename)
    
    print("Extracting model file...")
    with bz2.BZ2File(compressed_filename, 'rb') as f_in:
        with open(model_filename, 'wb') as f_out:
            shutil.copyfileobj(f_in, f_out)
    
    # Clean up compressed file
    os.remove(compressed_filename)
    print(f"Model downloaded and extracted to {model_filename}")

if __name__ == "__main__":
    download_dlib_model()

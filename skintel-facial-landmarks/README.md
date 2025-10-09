# installation Instructions

## prerequisites

### for ubuntu/deb:
```bash
sudo apt update
sudo apt install cmake build-essential pkg-config
sudo apt install libx11-dev libatlas-base-dev
sudo apt install libgtk-3-dev libboost-python-dev
```

### for mac:
```bash
brew install cmake
brew install boost-python3
```

### for qindows:
1. install Visual Studio Build Tools
2. install CMake from cmake.org
3. add CMake to PATH

## install Python Dependencies

1. install the basic requirements:
```bash
pip install -r requirements.txt
```

2. install dlib (choose any one):

### method 1: Using conda (Recommended)
```bash
conda install -c conda-forge dlib
```

### method 2: Using pip with pre-built wheel
```bash
pip install dlib
```

### method 3: Build from source (if above methods fail)
```bash
# Make sure CMake is installed first
cmake --version
pip install dlib --verbose
```
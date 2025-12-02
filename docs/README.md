# Skintel API Documentation

This directory contains comprehensive API documentation for all Skintel microservices.

## Available Documentation

### 1. [Skintel Backend API](./skintel-backend-api.md)
Main backend API built with TypeScript/Express.js and PostgreSQL.

**Topics covered:**
- Authentication & Authorization (JWT, Clerk SSO)
- User Onboarding & Sessions
- Profile Management
- Skin Analysis (vanalyse)
- Skincare Tasks & Plans
- Dashboard Features (water intake, skin tips, skin feel)
- Products & Ingredients Analysis
- Location & Weather Integration
- Image Upload (S3)
- Subscriptions & Payments (iOS In-App Purchase)
- Push Notifications
- Reports & Feedback

**Base URL**: `https://api.skintel.com/v1`

---

### 2. [Skintel Facial Landmarks API](./skintel-facial-landmarks-api.md)
Microservice for facial landmark detection and skin issue annotation.

**Topics covered:**
- 68-point Facial Landmark Detection (dlib)
- 468-point MediaPipe Face Mesh Integration
- Skin Issue Annotation with Smooth Contours
- Region-based Landmark Mapping
- Spline Interpolation for Organic Shapes
- Installation & Setup Instructions

**Base URL**: `http://localhost:8000`

---

## Quick Links

| Service | Swagger Docs | Health Check |
|---------|--------------|--------------|
| Backend API | `/docs` | `GET /health` |
| Facial Landmarks | `/docs` | `GET /health` |

---

## Architecture Overview

```
┌─────────────────┐
│   Mobile App    │
│   (iOS/Android) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│   Skintel Backend API       │
│   (Express.js + PostgreSQL) │
│   Port: 3000                │
└────────┬────────────────────┘
         │
         │  Landmark Detection
         │  & Annotation
         ▼
┌─────────────────────────────┐
│ Facial Landmarks API        │
│ (FastAPI + MediaPipe/dlib)  │
│ Port: 8000                  │
└─────────────────────────────┘
```

---

## Technology Stack

### Backend API
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Auth**: JWT, Clerk (SSO)
- **Cloud**: AWS S3
- **Monitoring**: Sentry

### Facial Landmarks API
- **Language**: Python 3.8+
- **Framework**: FastAPI
- **Face Detection**: dlib, MediaPipe
- **Image Processing**: OpenCV, Pillow
- **Scientific**: NumPy, SciPy

---

## Development Setup

```bash
# Clone repository
git clone <repo-url>
cd skintel-backend-core

# Setup Backend API
cd skintel-backend
npm install
cp .env.example .env
npm run db:generate
npm run dev

# Setup Facial Landmarks API
cd ../skintel-facial-landmarks
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python download_model.py
uvicorn main:app --reload
```

---

## API Conventions

### Authentication
Most endpoints require a Bearer token:
```
Authorization: Bearer <access_token>
```

### Request/Response Format
All APIs use JSON:
```json
{
  "key": "value"
}
```

### Error Format
```json
{
  "error": "Error message",
  "details": [...]  // Optional
}
```

### Status Codes
- `200`: Success
- `201`: Created
- `400`: Bad Request
- `401`: Unauthorized
- `404`: Not Found
- `500`: Internal Server Error

---

## Support

For questions or issues:
1. Check the relevant API documentation
2. Review Swagger/OpenAPI docs at `/docs`
3. Submit via `POST /v1/report/issue` (Backend API)
4. Contact the development team

---

## Version

- **Backend API**: v1.0.0
- **Facial Landmarks API**: v1.0.0

Last updated: December 2, 2025

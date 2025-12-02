# Skintel Backend API Documentation

## Overview

The Skintel Backend API is a comprehensive TypeScript/Express.js REST API that powers the Skintel skincare application. It provides user authentication, onboarding, skin analysis, task management, and subscription services.

**Base URL**: `https://api.skintel.com/v1`  
**Documentation**: `/docs` (Swagger/OpenAPI 3.0)  
**Health Check**: `GET /health`

---

## Authentication

All authenticated endpoints require a Bearer token in the Authorization header:

```
Authorization: Bearer <access_token>
```

### Endpoints

#### Create Anonymous Session
```
POST /v1/sessions/anonymous
```
Creates a temporary session for onboarding without registration (48hr expiry).

**Request Body:**
```json
{
  "device_id": "123e4567-e89b-12d3-a456-426614174000",
  "device_info": {
    "os": "ios",
    "os_version": "17.4",
    "app_version": "1.0.0"
  }
}
```

**Response:**
```json
{
  "session_id": "sess_abc123",
  "session_token": "st_eyJhbGc...",
  "expires_at": "2025-12-04T11:22:00Z"
}
```

---

#### User Signup
```
POST /v1/auth/signup
```
Create new user account. Merges anonymous session data if `session_id` provided.

**Request Body:**
```json
{
  "session_id": "sess_abc123",
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response:**
```json
{
  "user_id": "user_uuid",
  "email": "user@example.com",
  "access_token": "eyJhbGc...",
  "refresh_token": "rt_abc123...",
  "expires_in": 3600
}
```

---

#### User Login
```
POST /v1/auth/login
```
Authenticate with email and password.

**Request Body:**
```json
{
  "session_id": "sess_abc123",
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

---

#### SSO Login (Clerk)
```
POST /v1/auth/sso
```
Authenticate via Clerk SSO (Google, Facebook, Apple).

**Request Body:**
```json
{
  "session_id": "sess_abc123",
  "provider": "clerk_google",
  "clerk_token": "clerk_token_here",
  "clerk_session_id": "sess_clerk_id"
}
```

---

####  Refresh Token
```
POST /v1/auth/token/refresh
```
Obtain new access token using refresh token.

**Request Body:**
```json
{
  "refresh_token": "rt_abc123..."
}
```

---

#### Logout
```
POST /v1/auth/logout
```
Invalidate refresh token.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**
```json
{
  "refresh_token": "rt_abc123..."
}
```

---

#### Request Password Reset
```
POST /v1/auth/password-reset/request
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

---

#### Confirm Password Reset
```
POST /v1/auth/password-reset/confirm
```

**Request Body:**
```json
{
  "reset_token": "reset_token_here",
  "new_password": "NewSecurePass123!"
}
```

---

## Onboarding

#### Save Onboarding Data
```
PUT /v1/onboarding
```
Save user onboarding answers. Supports idempotency via `Idempotency-Key` header.

**Headers:**
- `X-Session-Token: <session_token>`
- `Idempotency-Key: <uuid>` (optional, recommended)

**Request Body:**
```json
{
  "session_id": "sess_abc123",
  "answers": [
    {
      "answer_id": "ans_uuid",
      "screen_id": "screen_skin_type",
      "question_id": "q_skin_type",
      "type": "single",
      "value": "combination",
      "status": "answered",
      "saved_at": "2025-12-02T11:35:10Z"
    }
  ],
  "screen_completed": true
}
```

**Question Types:**
- `single`: Single choice
- `multi`: Multiple choice (array)
- `slider`: Numeric
- `image`: Image reference (object with `image_id`)
- `boolean`: true/false
- `derived`: Server-calculated

---

#### Get Onboarding Data
```
GET /v1/onboarding?session_id=sess_abc123
```

**Headers:** `X-Session-Token: <session_token>` or `Authorization: Bearer <access_token>`

---

#### Get Onboarding Questions
```
GET /v1/onboarding/questions
```
Retrieve all onboarding questions.

---

## Profile

#### Get User Profile
```
GET /v1/profile
```
**Headers:** `Authorization: Bearer <access_token>`

---

#### Update Profile
```
PATCH /v1/profile
```

**Request Body:**
```json
{
  "name": "John Doe",
  "date_of_birth": "1995-05-15"
}
```

---

#### Delete Account
```
DELETE /v1/profile
```

---

## Facial Landmarks

#### Get User Landmarks
```
GET /v1/landmarks/user
```
Retrieve all processed facial landmarks for authenticated user.

**Response:**
```json
{
  "user_id": "user_uuid",
  "landmarks": [
    {
      "answer_id": "ans_uuid",
      "question_id": "q_selfie",
      "screen_id": "screen_selfie",
      "landmarks": [...],
      "status": "processed",
      "processed_at": "2025-12-02T11:30:00Z",
      "created_at": "2025-12-02T11:29:00Z"
    }
  ]
}
```

---

## Skin Analysis

#### Analyze Skin (vanalyse)
```
POST /v1/vanalyse
```
Submit images for AI skin analysis. Returns detected issues and personalized skincare plan.

**Request Body:**
```json
{
  "front_image_url": "https://...",
  "left_image_url": "https://...",
  "right_image_url": "https://..."
}
```

**Response:** Analysis results with detected issues, severity, recommendations, and annotated images.

---

## Tasks & Skincare Plan

#### Get User Tasks
```
GET /v1/tasks
```
Retrieve user's skincare tasks and plan.

---

#### Mark Task Complete
```
POST /v1/tasks/{taskId}/complete
```

**Request Body:**
```json
{
  "completedAt": "2025-12-02T08:00:00Z"
}
```

---

#### Unmark Task
```
DELETE /v1/tasks/{taskId}/complete?date=2025-12-02
```

---

#### Get Progress
```
GET /v1/tasks/progress
```
Comprehensive progress statistics.

---

## Dashboard Features

#### Get Skin Tip of the Day
```
GET /v1/skin-tip
```

**Response:**
```json
{
  "content": "Always apply sunscreen 30 minutes before sun exposure...",
  "category": "sun_protection"
}
```

---

#### Water Intake Suggestion
```
GET /v1/water-intake
```

**Response:**
```json
{
  "amount": 2500,
  "unit": "ml",
  "reason": "Based on your climate and activity level"
}
```

---

#### Update Water Intake
```
PUT /v1/water-intake
```

**Request Body:**
```json
{
  "date": "2025-12-02",
  "amount": 1800,
  "unit": "ml"
}
```

**Response:**
```json
{
  "date": "2025-12-02",
  "amount": 1800,
  "unit": "ml",
  "recommended": {
    "amount": 2500,
    "unit": "ml",
    "reason": "..."
  },
  "progress": 0.72
}
```

---

#### Log Skin Feel
```
POST /v1/skin-feel
```

**Request Body:**
```json
{
  "value": "good"
}
```

**Values:** `"terrible"`, `"bad"`, `"neutral"`, `"good"`, `"excellent"`

---

#### Get Skin Feel History
```
GET /v1/skin-feel?limit=10
```

---

## Products

#### Search Products
```
GET /v1/products/search?query=cleanser&limit=10
```

---

#### Get Product Details
```
GET /v1/products/{productId}
```

---

#### Analyze Product Ingredients
```
POST /v1/products/analyze-ingredients
```

**Request Body:**
```json
{
  "ingredients": "Water, Glycerin, Niacinamide, ..."
}
```

---

## Location & Weather

#### Update Location
```
POST /v1/location
```

**Request Body:**
```json
{
  "latitude": 27.7172,
  "longitude": 85.3240,
  "city": "Kathmandu",
  "country": "Nepal"
}
```

---

#### Get Location Data
```
GET /v1/location
```
Returns location and weather (UV index, temperature, humidity).

---

## Image Upload

#### Upload Image to S3
```
POST /v1/upload
```

**Request Body:**
```json
{
  "imageBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "filename": "selfie.jpg"
}
```

**Response:**
```json
{
  "url": "https://s3.amazonaws.com/...",
  "key": "uploads/...",
  "contentType": "image/jpeg",
  "sizeBytes": 245678
}
```

---

## Subscriptions & Payments

#### Verify iOS In-App Purchase
```
POST /v1/payment/verify-ios
```

**Request Body:**
```json
{
  "receipt_data": "base64_encoded_receipt",
  "product_id": "com.skintel.monthly"
}
```

---

#### Get Available Plans
```
GET /v1/payment/plans
```

**Response:**
```json
{
  "plans": [
    {
      "id": "com.skintel.weekly",
      "name": "Weekly Plan",
      "type": "WEEKLY"
    },
    {
      "id": "com.skintel.monthly",
      "name": "Monthly Plan",
      "type": "MONTHLY"
    }
  ]
}
```

---

#### Get Subscription Status
```
GET /v1/payment/status
```
Fetches live status from Apple.

**Response:**
```json
{
  "isActive": true,
  "planType": "MONTHLY",
  "expiresDate": "2025-12-31T23:59:59Z"
}
```

---

#### Submit Cancellation Reason
```
POST /v1/payment/cancel-reason
```

**Request Body:**
```json
{
  "reason": "Too expensive",
  "otherDetails": "Additional feedback..."
}
```

---

## Notifications

#### Upload Device Token
```
POST /v1/notifications/device-token
```

**Request Body:**
```json
{
  "token": "fcm_or_apns_token",
  "platform": "ios"
}
```

---

#### Remove Device Token
```
DELETE /v1/notifications/device-token
```

**Request Body:**
```json
{
  "token": "fcm_or_apns_token"
}
```

---

#### Get Notification Preferences
```
GET /v1/notifications/preferences
```

---

#### Update Notification Preferences
```
PATCH /v1/notifications/preferences
```

**Request Body:**
```json
{
  "dailyRoutineReminders": true,
  "hydrationAlerts": true,
  "uvIndexAlerts": false,
  "tipOfTheDay": true,
  "ingredientRecommendations": true,
  "notificationSound": true
}
```

---

## Reports

#### Send Email Report
```
POST /v1/report/email
```

**Request Body:**
```json
{
  "subject": "Feedback",
  "description": "I love the app!"
}
```

---

#### Report an Issue
```
POST /v1/report/issue
```

**Request Body:**
```json
{
  "title": "Bug in water tracker",
  "description": "The counter resets unexpectedly..."
}
```

---

## Version Check

#### Check App Version
```
POST /v1/version
```

**Request Body:**
```json
{
  "platform": "ios",
  "current_version": "1.0.0"
}
```

**Response:**
```json
{
  "update_required": false,
  "latest_version": "1.2.0",
  "download_url": "https://apps.apple.com/..."
}
```

---

## Error Handling

All errors return JSON with appropriate HTTP status codes:

```json
{
  "error": "Error message",
  "details": [...]  // Optional validation details
}
```

**Common Status Codes:**
- `200`: Success
- `201`: Created
- `400`: Bad Request / Validation Error
- `401`: Unauthorized / Authentication Required
- `403`: Forbidden
- `404`: Not Found
- `409`: Conflict (e.g., duplicate email)
- `500`: Internal Server Error

---

## Rate Limiting

*To be implemented*

---

## Security

- **Password Hashing**: bcrypt (12 rounds)
- **JWT Tokens**: Access tokens (1hr) + Refresh tokens (30 days)
- **Session Tokens**: Database-validated for anonymous sessions
- **Input Validation**: Zod schemas on all endpoints
- **Idempotency**: Prevents duplicate requests
- **Middleware**: Helmet, CORS
- **SQL Injection**: Prevented by Prisma ORM

---

## Data Models

### User
- `id`: UUID
- `email`: string (unique)
- `password_hash`: string (bcrypt)
- `name`: string (nullable)
- `date_of_birth`: date (nullable)
- Timestamps: `created_at`, `updated_at`

### AnonymousSession
- `session_id`: string (unique)
- `device_id`: UUID
- `expires_at`: datetime
- Token: `session_token` (JWT)

### OnboardingAnswer
- `answer_id`: UUID
- `session_id` or `user_id`
- `screen_id`, `question_id`
- `type`: enum (single, multi, slider, etc.)
- `value`: JSON
- `status`: answered/skipped

### RefreshToken
- `token`: string (hashed)
- `user_id`: UUID
- `expires_at`: datetime

---

## Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Validation**: Zod
- **Authentication**: JWT, bcrypt
- **Documentation**: Swagger/OpenAPI 3.0
- **SSO**: Clerk (Google, Facebook, Apple)
- **Monitoring**: Sentry
- **Cloud Storage**: AWS S3
- **Push Notifications**: FCM/APNS

---

## Development

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env

# Generate Prisma client
npm run db:generate

# Push schema (dev)
npm run db:push

# Run dev server
npm run dev
```

**Swagger Docs**: `http://localhost:3000/docs`

---

## Support

For issues or questions, contact the development team or submit via `/v1/report/issue`.

# skintel backend api

backend for the skintel onboarding and user auth flow. built with typescript, express, postgresql, and prisma.

## what's in here

- **database**: postgresql with prisma orm
- **auth**: jwt tokens with refresh token rotation  
- **validation**: zod schemas for request validation
- **security**: bcrypt password hashing, helmet middleware, cors
- **idempotency**: request deduplication for onboarding updates
- **documentation**: swagger/openapi 3.0 docs at `/docs`

## quick start

### prerequisites
- node.js 18+
- postgresql database
- npm/yarn

### setup

```bash
# install dependencies
npm install

# copy environment variables
cp .env.example .env

# update .env with your database url and jwt secret

# generate prisma client
npm run db:generate

# push database schema (for dev)
npm run db:push

# start development server
npm run dev
```

server runs on `http://localhost:3000`

**api documentation**: visit `http://localhost:3000/docs` for interactive swagger ui

## testing

run the comprehensive test suite:

```bash
# make sure server is running first
npm run dev

# in another terminal, run tests
npm test
```

**for testing** - focused onboarding flow test:

```bash
# to test just the onboarding flow with clear examples
node scripts/test-onboarding-flow.js
```

the test script validates:
- health check endpoint
- anonymous session creation
- onboarding data save/retrieve
- user signup and authentication
- token refresh and logout
- error handling for invalid requests

## environment variables

update your `.env` file:

```env
NODE_ENV=development
PORT=3000
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
DATABASE_URL="postgresql://username:password@localhost:5432/skintel_db"
```

## api endpoints

all endpoints use `/v1` prefix. also there's a health check at `/health`.

### anonymous sessions

`POST /v1/sessions/anonymous` - create temp session for onboarding

```bash
curl -X POST http://localhost:3000/v1/sessions/anonymous \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "123e4567-e89b-12d3-a456-426614174000",
    "device_info": {
      "os": "ios",
      "os_version": "17.4", 
      "app_version": "1.0.0"
    }
  }'
```

returns session_id, session_token, and expires_at.

### onboarding data

`PUT /v1/onboarding` - save user answers (supports idempotency with `Idempotency-Key` header)

```bash
curl -X PUT http://localhost:3000/v1/onboarding \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: st_eyJhbGc..." \
  -H "Idempotency-Key: 123e4567-e89b-12d3-a456-426614174001" \
  -d '{
    "session_id": "sess_abc123",
    "answers": [
      {
        "answer_id": "ans_9d3b-uuid-v4",
        "screen_id": "screen_skin_type",
        "question_id": "q_skin_type",
        "type": "single",
        "value": "combination",
        "status": "answered",
        "saved_at": "2025-10-06T12:35:10Z"
      }
    ],
    "screen_completed": true
  }'
```

`GET /v1/onboarding?session_id=sess_abc123` - get saved answers for session

### authentication

`POST /v1/auth/signup` - create account with email/password
`POST /v1/auth/login` - login with email/password  
`POST /v1/auth/sso` - login with apple/google
`POST /v1/auth/token/refresh` - get new access token
`POST /v1/auth/logout` - logout and invalidate tokens

all auth endpoints merge anonymous session data into the user account when you provide a session_id.

## onboarding questions

the api handles different question types:

- `single` - single choice (e.g., skin type: oily, dry, combination, normal)
- `multi` - multiple choice (e.g., skin concerns: ["acne", "dark_spots"])  
- `slider` - numeric input (e.g., age)
- `image` - image reference (e.g., `{"image_id": "img_xxx"}`)
- `boolean` - yes/no questions
- `derived` - server-calculated values

## database schema

using prisma with these main models:

- `AnonymousSession` - temp sessions for onboarding (48hr expiry)
- `User` - registered users with email/sso auth
- `OnboardingAnswer` - user responses to questions
- `RefreshToken` - jwt refresh tokens with expiration
- `IdempotencyKey` - request deduplication

## development

### scripts

```bash
npm run dev          # start dev server with hot reload
npm run build        # build for production  
npm start            # start production server
npm run db:generate  # generate prisma client
npm run db:push      # push schema to db (dev)
npm run db:migrate   # create migration (prod)
npm run db:studio    # open prisma studio
```

### project structure

```
src/
├── index.ts              # express app entry point
├── lib/
│   ├── prisma.ts        # database client
│   └── validation.ts    # zod schemas
├── middleware/
│   ├── auth.ts          # jwt auth middleware
│   └── idempotency.ts   # request deduplication
├── routes/
│   ├── sessions.ts      # anonymous sessions
│   ├── onboarding.ts    # save/get answers
│   └── auth.ts          # signup/login/sso
├── types/index.ts       # typescript definitions
└── utils/
    ├── auth.ts          # jwt + bcrypt helpers
    └── validation.ts    # question validation
```

## security stuff

- bcrypt password hashing (12 rounds)
- jwt access tokens (1hr expiry) + refresh tokens (30 days)
- session token validation via database lookup
- zod input validation on all endpoints
- idempotency keys prevent duplicate requests
- helmet + cors middleware
- prisma prevents sql injection

## error handling

errors return `{"error": "message"}` with appropriate http status codes. validation errors include a `details` field with specifics.
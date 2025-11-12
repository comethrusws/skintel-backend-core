const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://skintel.srecraft.io';
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

let sessionToken = '';
let sessionId = '';
let accessToken = '';
let refreshToken = '';

// Use local images from public directory
const PUBLIC_DIR = path.join(__dirname, '../../public');
const TEST_IMAGE_FRONT = path.join(PUBLIC_DIR, 'front.jpeg');
const TEST_IMAGE_LEFT = path.join(PUBLIC_DIR, 'left.jpeg');
const TEST_IMAGE_RIGHT = path.join(PUBLIC_DIR, 'right.jpeg');

function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

function makeBinaryRequest(method, path, buffer = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: {
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (buffer) req.write(buffer);
    req.end();
  });
}

function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadToBuffer(res.headers.location));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function test(name, fn) {
  try {
    log(`\n🧪 ${name}`, 'blue');
    await fn();
    log(`✅ ${name} passed`, 'green');
  } catch (error) {
    log(`❌ ${name} failed: ${error.message}`, 'red');
    throw error;
  }
}

async function assertEquals(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

async function testHealthCheck() {
  const response = await makeRequest('GET', '/health');
  assertEquals(response.status, 200, 'Health check should return 200');
  assertEquals(response.data.status, 'healthy', 'Health status should be healthy');
}

async function testCreateAnonymousSession() {
  const deviceId = uuidv4();
  const response = await makeRequest('POST', '/v1/sessions/anonymous', {
    device_id: deviceId,
    device_info: {
      os: 'ios',
      os_version: '17.4',
      app_version: '1.0.0'
    }
  });

  assertEquals(response.status, 201, 'Should create session with 201');
  
  if (!response.data.session_id || !response.data.session_token) {
    throw new Error('Response should contain session_id and session_token');
  }

  sessionId = response.data.session_id;
  sessionToken = response.data.session_token;
  
  log(`Session created: ${sessionId}`, 'yellow');
}

async function testSaveOnboardingAnswers() {
  // Upload test images via our upload API first, then use returned S3 URLs in onboarding
  const imgBufferFront = fs.readFileSync(TEST_IMAGE_FRONT);
  const imgBufferLeft = fs.readFileSync(TEST_IMAGE_LEFT);
  const imgBufferRight = fs.readFileSync(TEST_IMAGE_RIGHT);

  const uploadFront = await makeBinaryRequest('POST', '/v1/upload/file?prefix=prod-tests', imgBufferFront, {
    'Content-Type': 'image/jpeg'
  });
  const uploadLeft = await makeBinaryRequest('POST', '/v1/upload/file?prefix=prod-tests', imgBufferLeft, {
    'Content-Type': 'image/jpeg'
  });
  const uploadRight = await makeBinaryRequest('POST', '/v1/upload/file?prefix=prod-tests', imgBufferRight, {
    'Content-Type': 'image/jpeg'
  });

  if (uploadFront.status !== 201 || !uploadFront.data.url) {
    throw new Error(`Front image upload failed. Status: ${uploadFront.status}, Body: ${JSON.stringify(uploadFront.data)}`);
  }
  if (uploadLeft.status !== 201 || !uploadLeft.data.url) {
    throw new Error(`Left image upload failed. Status: ${uploadLeft.status}, Body: ${JSON.stringify(uploadLeft.data)}`);
  }
  if (uploadRight.status !== 201 || !uploadRight.data.url) {
    throw new Error(`Right image upload failed. Status: ${uploadRight.status}, Body: ${JSON.stringify(uploadRight.data)}`);
  }

  const uploadedFrontUrl = uploadFront.data.url;
  const uploadedLeftUrl = uploadLeft.data.url;
  const uploadedRightUrl = uploadRight.data.url;

  // Generate comprehensive onboarding answers for all valid questions
  const answers = [
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_skin_concerns',
      question_id: 'q_skin_concerns',
      type: 'multi',
      value: ['acne', 'dark_spots', 'dryness'],
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_skin_sensitivity',
      question_id: 'q_skin_sensitivity',
      type: 'single',
      value: 'mildly_sensitive',
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_skin_type',
      question_id: 'q_skin_type',
      type: 'single',
      value: 'combination',
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_goals',
      question_id: 'q_goal',
      type: 'multi',
      value: ['clear_skin', 'hydration', 'anti_aging'],
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_profile_gender',
      question_id: 'q_profile_gender',
      type: 'single',
      value: 'female',
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_age',
      question_id: 'q_age',
      type: 'slider',
      value: 28,
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_profile_ethnicity',
      question_id: 'q_profile_ethnicity',
      type: 'single',
      value: 'south_asian',
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_time_outdoors',
      question_id: 'q_time_spent_outdoors',
      type: 'single',
      value: '1_to_3_hours',
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_weather_conditions',
      question_id: 'q_profile_weather_conditions',
      type: 'single',
      value: 'temperate',
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_regime_products',
      question_id: 'q_regime_product',
      type: 'multi',
      value: ['cleanser', 'serum', 'moisturizer', 'face_mask'],
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_medical_conditions',
      question_id: 'q_medical_conditions',
      type: 'multi',
      value: ['none'],
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_hormone_factors',
      question_id: 'q_hormone_factors',
      type: 'multi',
      value: ['none'],
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_face_photos',
      question_id: 'q_face_photo_front',
      type: 'image',
      value: { image_url: uploadedFrontUrl },
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_face_photos',
      question_id: 'q_face_photo_left',
      type: 'image',
      value: { image_url: uploadedLeftUrl },
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_face_photos',
      question_id: 'q_face_photo_right',
      type: 'image',
      value: { image_url: uploadedRightUrl },
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_onboarding_complete',
      question_id: 'q_onboarding_complete',
      type: 'boolean',
      value: true,
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_onboarding_status',
      question_id: 'q_onboarding_status',
      type: 'derived',
      value: 'completed',
      status: 'answered',
      saved_at: new Date().toISOString()
    }
  ];
  
  const response = await makeRequest('PUT', '/v1/onboarding', {
    session_id: sessionId,
    answers,
    screen_completed: true
  }, {
    'X-Session-Token': sessionToken,
    'Idempotency-Key': uuidv4()
  });

  assertEquals(response.status, 200, 'Should save answers with 200');
  assertEquals(response.data.saved, true, 'Should indicate answers were saved');
  
  log(`Saved ${answers.length} onboarding answers including comprehensive questionnaire`, 'yellow');
  
  // Wait longer for landmark processing in production
  await new Promise(r => setTimeout(r, 30000));
}

async function testInvalidQuestionValues() {
  const invalidResponse = await makeRequest('PUT', '/v1/onboarding', {
    session_id: sessionId,
    answers: [{
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_skin_type',
      question_id: 'q_skin_type',
      type: 'single',
      value: 'invalid_skin_type',
      status: 'answered',
      saved_at: new Date().toISOString()
    }]
  }, {
    'X-Session-Token': sessionToken,
    'Idempotency-Key': uuidv4()
  });
  
  assertEquals(invalidResponse.status, 400, 'Should reject invalid question values');
}

async function testGetOnboardingState() {
  const response = await makeRequest('GET', `/v1/onboarding?session_id=${sessionId}`, null, {
    'X-Session-Token': sessionToken
  });

  assertEquals(response.status, 200, 'Should get onboarding state with 200');
  assertEquals(response.data.session_id, sessionId, 'Should return correct session ID');
  
  if (!Array.isArray(response.data.answers)) {
    throw new Error('Response should contain answers array');
  }
}

async function testUserSignup() {
  const uniqueEmail = `prod_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@example.com`;
  
  const response = await makeRequest('POST', '/v1/auth/signup', {
    session_id: sessionId,
    email: uniqueEmail,
    password: 'prodtest123'
  });

  assertEquals(response.status, 201, 'Should create user with 201');
  
  if (!response.data.access_token || !response.data.refresh_token) {
    throw new Error(`Response should contain tokens. Got: ${JSON.stringify(response.data)}`);
  }

  accessToken = response.data.access_token;
  refreshToken = response.data.refresh_token;
  
  log(`User created with email: ${uniqueEmail}`, 'yellow');
}

async function testGetUserLandmarksAfterSignup() {
  const response = await makeRequest('GET', '/v1/landmarks/user', null, {
    'Authorization': `Bearer ${accessToken}`
  });
  assertEquals(response.status, 200, 'Should get user landmarks with 200');
  if (!Array.isArray(response.data.landmarks)) {
    throw new Error('Response should contain landmarks array');
  }
  if (response.data.landmarks.length === 0) {
    log('No landmarks found yet (processing may still be running). Waiting 15s and retrying...', 'yellow');
    await new Promise(r => setTimeout(r, 15000));
    const retry = await makeRequest('GET', '/v1/landmarks/user', null, {
      'Authorization': `Bearer ${accessToken}`
    });
    if (!Array.isArray(retry.data.landmarks) || retry.data.landmarks.length === 0) {
      throw new Error('Expected at least one completed landmark record after signup merge');
    }
  }
}

async function testRefreshToken() {
  const response = await makeRequest('POST', '/v1/auth/token/refresh', {
    refresh_token: refreshToken
  });

  assertEquals(response.status, 200, 'Should refresh token with 200');
  
  if (!response.data.access_token || !response.data.refresh_token) {
    throw new Error('Response should contain new tokens');
  }

  const newAccessToken = response.data.access_token;
  const newRefreshToken = response.data.refresh_token;
  
  if (newAccessToken === accessToken) {
    throw new Error('New access token should be different');
  }

  accessToken = newAccessToken;
  refreshToken = newRefreshToken;
  
  log(`Tokens refreshed successfully`, 'yellow');
}

async function testLogout() {
  const response = await makeRequest('POST', '/v1/auth/logout', {
    refresh_token: refreshToken
  }, {
    'Authorization': `Bearer ${accessToken}`
  });

  assertEquals(response.status, 200, 'Should logout with 200');
  assertEquals(response.data.status, 'logged_out', 'Should confirm logout');
}

async function testInvalidRequests() {
  const invalidSessionResponse = await makeRequest('POST', '/v1/sessions/anonymous', {
    device_id: 'invalid',
    device_info: {
      os: 'ios'
    }
  });
  
  assertEquals(invalidSessionResponse.status, 400, 'Should reject invalid session data');

  const unauthorizedResponse = await makeRequest('PUT', '/v1/onboarding', {
    session_id: 'fake_session',
    answers: []
  });
  
  assertEquals(unauthorizedResponse.status, 401, 'Should reject unauthorized access');

  await testInvalidQuestionValues();
}

async function runAllTests() {
  log('🚀 Starting Production API Tests', 'blue');
  log(`🌐 Testing against: ${BASE_URL}`, 'blue');
  
  try {
    await test('Health Check', testHealthCheck);
    await test('Create Anonymous Session', testCreateAnonymousSession);
    await test('Save Onboarding Answers + Landmark + Analysis', testSaveOnboardingAnswers);
    await test('Get Onboarding State', testGetOnboardingState);
    await test('User Signup', testUserSignup);
    await test('Get User Landmarks After Signup', testGetUserLandmarksAfterSignup);
    await test('Refresh Token', testRefreshToken);
    await test('User Logout', testLogout);
    await test('Invalid Requests', testInvalidRequests);
    
    log('\n🎉 All production tests passed!', 'green');
  } catch (error) {
    log(`\n💥 Production test suite failed: ${error.message}`, 'red');
    process.exit(1);
  }
}

async function checkServer() {
  try {
    await makeRequest('GET', '/health');
    log(`Production server is running at ${BASE_URL}`, 'green');
  } catch (error) {
    log(`Production server is not accessible at ${BASE_URL}: ${error.message}`, 'red');
    process.exit(1);
  }
}

(async () => {
  await checkServer();
  await runAllTests();
})();

const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = 'http://localhost:3000';
const TEST_IMAGE_URL = 'https://i.pinimg.com/1200x/8a/76/0c/8a760c2a013aa5d83e0bee58db0fe6c8.jpg';
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

function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
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
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        ...headers
      }
    };

    const req = http.request(options, (res) => {
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
        // handle simple redirects
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
  // Upload test image via our upload API first, then use returned S3 URL in onboarding
  const imgBuffer = await downloadToBuffer(TEST_IMAGE_URL);
  const uploadResp = await makeBinaryRequest('POST', '/v1/upload/file?prefix=tests', imgBuffer, {
    'Content-Type': 'image/jpeg'
  });
  if (uploadResp.status !== 201 || !uploadResp.data || !uploadResp.data.url) {
    throw new Error(`Image upload failed. Status: ${uploadResp.status}, Body: ${JSON.stringify(uploadResp.data)}`);
  }
  const uploadedUrl = uploadResp.data.url;

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
      value: { image_url: uploadedUrl },
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
  
  // Wait for landmark processing to complete
  await new Promise(r => setTimeout(r, 9000));
}

async function testInvalidQuestionValues() {
  // Test invalid skin type value
  const invalidResponse = await makeRequest('PUT', '/v1/onboarding', {
    session_id: sessionId,
    answers: [{
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_skin_type',
      question_id: 'q_skin_type',
      type: 'single',
      value: 'invalid_skin_type', // Invalid value
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
  const response = await makeRequest('POST', '/v1/auth/signup', {
    session_id: sessionId,
    email: `${uuidv4()}@mail.com`,
    password: 'basabhaha123'
  });

  assertEquals(response.status, 201, 'Should create user with 201');
  
  if (!response.data.access_token || !response.data.refresh_token) {
    throw new Error('Response should contain tokens');
  }

  accessToken = response.data.access_token;
  refreshToken = response.data.refresh_token;
  
  log(`User created with access token`, 'yellow');
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
    log('No landmarks found yet (processing may still be running). Waiting 5s and retrying...', 'yellow');
    await new Promise(r => setTimeout(r, 10000));
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
  // Test invalid session creation
  const invalidSessionResponse = await makeRequest('POST', '/v1/sessions/anonymous', {
    device_id: 'invalid',
    device_info: {
      os: 'ios'
      // missing required fields
    }
  });
  
  assertEquals(invalidSessionResponse.status, 400, 'Should reject invalid session data');

  // Test unauthorized onboarding access
  const unauthorizedResponse = await makeRequest('PUT', '/v1/onboarding', {
    session_id: 'fake_session',
    answers: []
  });
  
  assertEquals(unauthorizedResponse.status, 401, 'Should reject unauthorized access');

  // Test invalid question values
  await testInvalidQuestionValues();
}

async function runAllTests() {
  log('🚀 Starting API Tests', 'blue');
  
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
    
    log('\n🎉 All tests passed!', 'green');
  } catch (error) {
    log(`\n💥 Test suite failed: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Check if server is running
async function checkServer() {
  try {
    await makeRequest('GET', '/health');
    log('Server is running', 'green');
  } catch (error) {
    log('Server is not running. Please start the server with: npm run dev', 'red');
    process.exit(1);
  }
}

// Main execution
(async () => {
  await checkServer();
  await runAllTests();
})();

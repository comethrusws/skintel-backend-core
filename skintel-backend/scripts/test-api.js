const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = 'http://localhost:3000';
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
  const answerId1 = `ans_${uuidv4()}`;
  const answerId2 = `ans_${uuidv4()}`;
  
  // Test with multiple question types
  const response = await makeRequest('PUT', '/v1/onboarding', {
    session_id: sessionId,
    answers: [
      {
        answer_id: answerId1,
        screen_id: 'screen_skin_type',
        question_id: 'q_skin_type',
        type: 'single',
        value: 'combination',
        status: 'answered',
        saved_at: new Date().toISOString()
      },
      {
        answer_id: answerId2,
        screen_id: 'screen_concerns',
        question_id: 'q_skin_concerns',
        type: 'multi',
        value: ['acne', 'dark_spots'],
        status: 'answered',
        saved_at: new Date().toISOString()
      }
    ],
    screen_completed: true
  }, {
    'X-Session-Token': sessionToken,
    'Idempotency-Key': uuidv4()
  });

  assertEquals(response.status, 200, 'Should save answers with 200');
  assertEquals(response.data.saved, true, 'Should indicate answers were saved');
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
    email: `test.${Date.now()}@example.com`,
    password: 'password123'
  });

  assertEquals(response.status, 201, 'Should create user with 201');
  
  if (!response.data.access_token || !response.data.refresh_token) {
    throw new Error('Response should contain tokens');
  }

  accessToken = response.data.access_token;
  refreshToken = response.data.refresh_token;
  
  log(`User created with access token`, 'yellow');
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
    await test('Save Onboarding Answers', testSaveOnboardingAnswers);
    await test('Get Onboarding State', testGetOnboardingState);
    await test('User Signup', testUserSignup);
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
    log('✅ Server is running', 'green');
  } catch (error) {
    log('❌ Server is not running. Please start the server with: npm run dev', 'red');
    process.exit(1);
  }
}

// Main execution
(async () => {
  await checkServer();
  await runAllTests();
})();

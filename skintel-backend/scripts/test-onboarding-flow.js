const http = require('http');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

let sessionToken = '';
let sessionId = '';

const PUBLIC_DIR = path.join(__dirname, '../../public');
const TEST_IMAGE_FRONT = path.join(PUBLIC_DIR, 'front.jpeg');
const TEST_IMAGE_LEFT = path.join(PUBLIC_DIR, 'left.jpeg');
const TEST_IMAGE_RIGHT = path.join(PUBLIC_DIR, 'right.jpeg');

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

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
    if (data) req.write(JSON.stringify(data));
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
      headers
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

async function step1_createSession() {
  log('\n📱 STEP 1: Creating anonymous session', 'blue');
  
  const deviceId = uuidv4();
  const response = await makeRequest('POST', '/v1/sessions/anonymous', {
    device_id: deviceId,
    device_info: {
      os: 'ios',
      os_version: '17.4',
      app_version: '1.0.0'
    }
  });

  if (response.status !== 201) {
    throw new Error(`Session creation failed: ${response.status} ${JSON.stringify(response.data)}`);
  }

  sessionId = response.data.session_id;
  sessionToken = response.data.session_token;
  
  log(`✅ Session created successfully`, 'green');
  log(`   session_id: ${sessionId}`, 'cyan');
  log(`   session_token: ${sessionToken.substring(0, 20)}...`, 'cyan');
  
  return response.data;
}

async function step2_uploadImages() {
  log('\n📸 STEP 2: Uploading test images', 'blue');
  
  const imgBufferFront = fs.readFileSync(TEST_IMAGE_FRONT);
  const uploadFront = await makeBinaryRequest('POST', '/v1/upload/file?prefix=frontend-test', imgBufferFront, {
    'Content-Type': 'image/jpeg'
  });

  if (uploadFront.status !== 201) {
    throw new Error(`Front image upload failed: ${uploadFront.status}`);
  }

  log(`✅ Front image uploaded: ${uploadFront.data.url}`, 'green');
  return {
    front_url: uploadFront.data.url
  };
}

async function step3_partialOnboarding(imageUrls) {
  log('\n📝 STEP 3: Saving partial onboarding data', 'blue');
  
  const partialAnswers = [
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_skin_concerns',
      question_id: 'q_skin_concerns',
      type: 'multi',
      value: ['acne', 'dark_spots'],
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
      screen_id: 'screen_age',
      question_id: 'q_age',
      type: 'slider',
      value: 25,
      status: 'answered',
      saved_at: new Date().toISOString()
    }
  ];

  const response = await makeRequest('PUT', '/v1/onboarding', {
    session_id: sessionId,
    answers: partialAnswers,
    screen_completed: false
  }, {
    'X-Session-Token': sessionToken,
    'Idempotency-Key': uuidv4()
  });

  if (response.status !== 200) {
    throw new Error(`Partial onboarding failed: ${response.status} ${JSON.stringify(response.data)}`);
  }

  log(`✅ Partial onboarding saved (${partialAnswers.length} answers)`, 'green');
  log(`   Status: ${response.data.session_onboarding_status}`, 'cyan');
  log(`   Total answers received: ${response.data.total_answers_received}`, 'cyan');
  
  return response.data;
}

async function step4_completeOnboarding(imageUrls) {
  log('\n✨ STEP 4: Completing onboarding with images', 'blue');
  
  const finalAnswers = [
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
      screen_id: 'screen_goals',
      question_id: 'q_goal',
      type: 'multi',
      value: ['clear_skin', 'hydration'],
      status: 'answered',
      saved_at: new Date().toISOString()
    },
    {
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_face_photos',
      question_id: 'q_face_photo_front',
      type: 'image',
      value: { image_url: imageUrls.front_url },
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
    answers: finalAnswers,
    screen_completed: true
  }, {
    'X-Session-Token': sessionToken,
    'Idempotency-Key': uuidv4()
  });

  if (response.status !== 200) {
    throw new Error(`Complete onboarding failed: ${response.status} ${JSON.stringify(response.data)}`);
  }

  log(`✅ Onboarding completed successfully!`, 'green');
  log(`   Status: ${response.data.session_onboarding_status}`, 'cyan');
  log(`   Total answers: ${response.data.total_answers_received}`, 'cyan');
  
  return response.data;
}

async function step5_getOnboardingState() {
  log('\n📊 STEP 5: Retrieving onboarding state', 'blue');
  
  const response = await makeRequest('GET', `/v1/onboarding?session_id=${sessionId}`, null, {
    'X-Session-Token': sessionToken
  });

  if (response.status !== 200) {
    throw new Error(`Get onboarding state failed: ${response.status} ${JSON.stringify(response.data)}`);
  }

  log(`✅ Onboarding state retrieved`, 'green');
  log(`   Session ID: ${response.data.session_id}`, 'cyan');
  log(`   Total saved answers: ${response.data.answers.length}`, 'cyan');
  
  return response.data;
}

async function testInvalidRequests() {
  log('\n❌ TESTING: Invalid requests', 'blue');
  
  const invalidResponse = await makeRequest('PUT', '/v1/onboarding', {
    session_id: sessionId,
    answers: [{
      answer_id: `ans_${uuidv4()}`,
      screen_id: 'screen_skin_type',
      question_id: 'q_skin_type',
      type: 'single',
      value: 'invalid_value',
      status: 'answered',
      saved_at: new Date().toISOString()
    }]
  }, {
    'X-Session-Token': sessionToken,
    'Idempotency-Key': uuidv4()
  });
  
  if (invalidResponse.status === 400) {
    log(`✅ Invalid data properly rejected (400)`, 'green');
  } else {
    log(`⚠️  Expected 400 but got ${invalidResponse.status}`, 'yellow');
  }

  const noAuthResponse = await makeRequest('PUT', '/v1/onboarding', {
    session_id: 'fake_session',
    answers: []
  });
  
  if (noAuthResponse.status === 401) {
    log(`✅ Unauthorized request properly rejected (401)`, 'green');
  } else {
    log(`⚠️  Expected 401 but got ${noAuthResponse.status}`, 'yellow');
  }
}

async function printExamplePayloads() {
  log('\n📋 EXAMPLE PAYLOADS FOR FRONTEND', 'yellow');
  
  log('\n1. Create Session Request:', 'cyan');
  console.log(JSON.stringify({
    device_id: "YOUR_DEVICE_UUID",
    device_info: {
      os: "ios",
      os_version: "17.4",
      app_version: "1.0.0"
    }
  }, null, 2));

  log('\n2. Onboarding Answer Format:', 'cyan');
  console.log(JSON.stringify({
    answer_id: "ans_" + uuidv4(),
    screen_id: "screen_skin_concerns",
    question_id: "q_skin_concerns", 
    type: "multi",
    value: ["acne", "dark_spots"],
    status: "answered",
    saved_at: new Date().toISOString()
  }, null, 2));

  log('\n3. Complete Onboarding Request:', 'cyan');
  console.log(JSON.stringify({
    session_id: "YOUR_SESSION_ID",
    answers: ["ARRAY_OF_ANSWERS"],
    screen_completed: true
  }, null, 2));

  log('\n4. Required Headers:', 'cyan');
  console.log(JSON.stringify({
    "Content-Type": "application/json",
    "X-Session-Token": "YOUR_SESSION_TOKEN",
    "Idempotency-Key": "OPTIONAL_UUID_FOR_DEDUPLICATION"
  }, null, 2));
}

async function checkServer() {
  try {
    const response = await makeRequest('GET', '/health');
    if (response.status === 200) {
      log(`✅ Server is running at ${BASE_URL}`, 'green');
      return true;
    }
  } catch (error) {
    log(`❌ Server not accessible: ${error.message}`, 'red');
    log(`💡 Start the server with: npm run dev`, 'yellow');
    return false;
  }
}

async function runOnboardingTest() {
  log('🚀 ONBOARDING FLOW TEST FOR FRONTEND TEAM', 'blue');
  log('=' .repeat(50), 'blue');
  
  try {
    const serverRunning = await checkServer();
    if (!serverRunning) return;

    const session = await step1_createSession();
    const images = await step2_uploadImages();
    const partialResult = await step3_partialOnboarding(images);
    const completeResult = await step4_completeOnboarding(images);
    const finalState = await step5_getOnboardingState();
    await testInvalidRequests();
    
    log('\n🎉 ALL TESTS PASSED!', 'green');
    log('=' .repeat(50), 'green');
    
    await printExamplePayloads();
    
  } catch (error) {
    log(`\n💥 TEST FAILED: ${error.message}`, 'red');
    log('=' .repeat(50), 'red');
    process.exit(1);
  }
}

if (require.main === module) {
  runOnboardingTest();
}

module.exports = {
  runOnboardingTest,
  makeRequest,
  makeBinaryRequest
};

const https = require('https');
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
  reset: '\x1b[0m'
};

let sessionToken = '';
let sessionId = '';
let accessToken = '';
let refreshToken = '';

// Use test.jpg from public directory
const PUBLIC_DIR = path.join(__dirname, '../../public');
const TEST_IMAGE = path.join(PUBLIC_DIR, 'test.jpg');
const OUTPUT_DIR = path.join(__dirname, '../../test-results');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadToBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download: ${res.statusCode} ${res.statusMessage}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // Verify it's an image by checking content type or magic bytes
        if (buffer.length === 0) {
          return reject(new Error('Downloaded buffer is empty'));
        }
        resolve(buffer);
      });
    }).on('error', reject);
  });
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function test(name, fn) {
  try {
    log(`\n🧪 ${name}`, 'blue');
    const result = await fn();
    log(`✅ ${name} passed`, 'green');
    return result;
  } catch (error) {
    log(`❌ ${name} failed: ${error.message}`, 'red');
    throw error;
  }
}

async function createUser() {
  const deviceId = uuidv4();
  
  // Create anonymous session
  const sessionResponse = await makeRequest('POST', '/v1/sessions/anonymous', {
    device_id: deviceId,
    device_info: {
      os: 'ios',
      os_version: '17.4',
      app_version: '1.0.0'
    }
  });

  if (sessionResponse.status !== 201) {
    throw new Error(`Failed to create session: ${JSON.stringify(sessionResponse.data)}`);
  }

  sessionId = sessionResponse.data.session_id;
  sessionToken = sessionResponse.data.session_token;

  log(`Session created: ${sessionId}`, 'yellow');

  // Upload test image
  const imgBuffer = fs.readFileSync(TEST_IMAGE);
  const uploadResponse = await makeBinaryRequest('POST', '/v1/upload/file?prefix=test-analysis', imgBuffer, {
    'Content-Type': 'image/jpeg'
  });

  if (uploadResponse.status !== 201 || !uploadResponse.data.url) {
    throw new Error(`Image upload failed: ${JSON.stringify(uploadResponse.data)}`);
  }

  const uploadedImageUrl = uploadResponse.data.url;
  log(`Image uploaded: ${uploadedImageUrl}`, 'yellow');

  // Save onboarding answers with test image
  const answers = [
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
      screen_id: 'screen_face_photos',
      question_id: 'q_face_photo_front',
      type: 'image',
      value: { image_url: uploadedImageUrl },
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
    }
  ];

  const onboardingResponse = await makeRequest('PUT', '/v1/onboarding', {
    session_id: sessionId,
    answers,
    screen_completed: true
  }, {
    'X-Session-Token': sessionToken,
    'Idempotency-Key': uuidv4()
  });

  if (onboardingResponse.status !== 200) {
    throw new Error(`Onboarding failed: ${JSON.stringify(onboardingResponse.data)}`);
  }

  log(`Onboarding completed`, 'yellow');

  // Signup user
  const uniqueEmail = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@example.com`;
  const signupResponse = await makeRequest('POST', '/v1/auth/signup', {
    session_id: sessionId,
    email: uniqueEmail,
    password: 'testpass123'
  });

  if (signupResponse.status !== 201) {
    throw new Error(`Signup failed: ${JSON.stringify(signupResponse.data)}`);
  }

  accessToken = signupResponse.data.access_token;
  refreshToken = signupResponse.data.refresh_token;

  log(`User created: ${uniqueEmail}`, 'yellow');
  log(`Access token: ${accessToken.substring(0, 20)}...`, 'yellow');

  return uploadedImageUrl;
}

async function getOnboardingAnalysis() {
  const maxWaitTime = 5 * 60 * 1000; // 5 minutes
  const pollInterval = 10000; // Check every 10 seconds
  const startTime = Date.now();
  
  log('Polling for initial analysis (max 5 minutes)...', 'yellow');
  
  while (Date.now() - startTime < maxWaitTime) {
    const response = await makeRequest('GET', '/v1/profile/analysis', null, {
      'Authorization': `Bearer ${accessToken}`
    });

    if (response.status === 200) {
      const analysis = response.data.analysis;
      if (analysis && analysis.length > 0) {
        // Find INITIAL analysis
        const initialAnalysis = analysis.find(a => a.analysis_type === 'INITIAL');
        if (initialAnalysis) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          log(`Found initial analysis after ${elapsed}s with ${initialAnalysis.analysis?.issues?.length || 0} issues`, 'green');
          return initialAnalysis;
        }
      }
    }
    
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    process.stdout.write(`\r⏳ Waiting for analysis... (${elapsed}s)`);
    await new Promise(r => setTimeout(r, pollInterval));
  }
  
  process.stdout.write('\n');
  throw new Error('Timeout: Initial analysis not found after 5 minutes');
}

async function runProgressAnalysis(frontImageUrl) {
  log('Running progress analysis...', 'yellow');
  
  const response = await makeRequest('POST', '/v1/vanalyse/progress', {
    front_image_url: frontImageUrl
  }, {
    'Authorization': `Bearer ${accessToken}`
  });

  if (response.status !== 200) {
    throw new Error(`Progress analysis failed: ${JSON.stringify(response.data)}`);
  }

  log(`Progress analysis completed`, 'yellow');
  return response.data;
}

async function renderSvgOnImage(imageBuffer, svgContent, outputPath) {
  try {
    // Try to use sharp if available
    const sharp = require('sharp');
    
    // Verify image buffer is valid
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Image buffer is empty');
    }
    
    // Get image dimensions and verify format
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    
    if (!metadata.width || !metadata.height) {
      throw new Error('Invalid image metadata');
    }
    
    const width = metadata.width;
    const height = metadata.height;
    
    // Extract SVG content (remove outer svg tags if present, we'll add our own)
    let svgInner = svgContent || '';
    // Remove outer svg tag if it exists
    svgInner = svgInner.replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '');
    
    if (!svgInner.trim()) {
      log(`⚠️  Empty SVG content for ${outputPath}`, 'yellow');
      // Just save the base image
      await image.toFile(outputPath);
      return;
    }
    
    // Create complete SVG with proper dimensions
    const completeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgInner}</svg>`;
    const svgBuffer = Buffer.from(completeSvg);
    
    // Composite SVG on image
    await image
      .composite([{
        input: svgBuffer,
        blend: 'over'
      }])
      .toFile(outputPath);
    
    log(`Rendered image: ${outputPath}`, 'green');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      log(`⚠️  Sharp not found. Install with: npm install --save-dev sharp`, 'yellow');
      const svgPath = outputPath.replace(/\.(jpg|jpeg|png)$/i, '.svg');
      const dir = path.dirname(svgPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(svgPath, svgContent);
      fs.writeFileSync(outputPath, imageBuffer);
      log(`Saved files separately: ${outputPath} and ${svgPath}`, 'yellow');
    } else {
      log(`Error rendering: ${error.message}`, 'yellow');
      // Fallback: save files separately
      const svgPath = outputPath.replace(/\.(jpg|jpeg|png)$/i, '.svg');
      const dir = path.dirname(svgPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(svgPath, svgContent || '');
      fs.writeFileSync(outputPath, imageBuffer);
    }
  }
}

async function visualizeResults(analysisData, frontImageUrl, analysisType) {
  log(`\n📊 Visualizing ${analysisType} analysis results...`, 'blue');

  // Get presigned front image URL from profile endpoint
  let presignedFrontImageUrl = frontImageUrl;
  try {
    log('Getting presigned front image URL from profile...', 'yellow');
    const profileResponse = await makeRequest('GET', '/v1/profile', null, {
      'Authorization': `Bearer ${accessToken}`
    });
    if (profileResponse.status === 200 && profileResponse.data.profile_image) {
      presignedFrontImageUrl = profileResponse.data.profile_image;
      log(`Got presigned URL: ${presignedFrontImageUrl.substring(0, 50)}...`, 'green');
    }
  } catch (error) {
    log(`⚠️  Could not get presigned URL, using original: ${error.message}`, 'yellow');
  }

  // Download front image
  log('Downloading front image...', 'yellow');
  let frontImageBuffer;
  try {
    frontImageBuffer = await downloadToBuffer(presignedFrontImageUrl);
    const frontImagePath = path.join(OUTPUT_DIR, `${analysisType}_front_image.jpg`);
    fs.writeFileSync(frontImagePath, frontImageBuffer);
    log(`Saved front image: ${frontImagePath}`, 'green');
  } catch (error) {
    log(`⚠️  Failed to download front image: ${error.message}`, 'yellow');
    log(`URL was: ${presignedFrontImageUrl}`, 'yellow');
    return;
  }

  // Get SVG overlays from progress analysis response
  let svgOverlays = [];
  if (analysisData.svg_overlays && Array.isArray(analysisData.svg_overlays)) {
    svgOverlays = analysisData.svg_overlays;
  } else if (analysisData.current_analysis?.svg_overlays) {
    svgOverlays = analysisData.current_analysis.svg_overlays;
  } else if (analysisData.progress_update?.svgOverlays) {
    svgOverlays = analysisData.progress_update.svgOverlays;
  } else if (analysisData.analysis?.svg_overlays) {
    svgOverlays = analysisData.analysis.svg_overlays;
  }

  if (svgOverlays.length === 0) {
    log('⚠️  No SVG overlays found in response', 'yellow');
    log('Checking if we can get them from analysis endpoint...', 'yellow');
    
    // Try to get from profile analysis endpoint
    const profileResponse = await makeRequest('GET', '/v1/profile/analysis', null, {
      'Authorization': `Bearer ${accessToken}`
    });
    
    if (profileResponse.status === 200) {
      const analyses = profileResponse.data.analysis || [];
      const relevantAnalysis = analyses.find(a => 
        a.analysis_type === analysisType
      );
      
      if (relevantAnalysis) {
        // Check in analysis.analysis.svg_overlays
        if (relevantAnalysis.analysis?.svg_overlays) {
          svgOverlays = relevantAnalysis.analysis.svg_overlays;
        } else if (relevantAnalysis.svg_overlays) {
          svgOverlays = relevantAnalysis.svg_overlays;
        }
      }
    }
  }

  if (svgOverlays.length === 0) {
    log('⚠️  No SVG overlays available. The analysis may not have completed annotation yet.', 'yellow');
    return;
  }

  log(`Found ${svgOverlays.length} SVG overlay(s)`, 'yellow');

  // Get image dimensions for SVG viewBox
  let imageWidth = 1000;
  let imageHeight = 1000;
  try {
    const sharp = require('sharp');
    const image = sharp(frontImageBuffer);
    const metadata = await image.metadata();
    imageWidth = metadata.width || 1000;
    imageHeight = metadata.height || 1000;
  } catch (e) {
    // Use defaults if sharp not available
  }

  // Render overall image with all SVG overlays combined
  // Extract inner content from each SVG overlay
  const allSvgContent = svgOverlays.map(overlay => {
    let content = overlay.svg_content || '';
    // Remove outer svg tags if present
    content = content.replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '');
    return content;
  }).join('\n');
  
  const overallPath = path.join(OUTPUT_DIR, `${analysisType}_all_issues.jpg`);
  await renderSvgOnImage(frontImageBuffer, allSvgContent, overallPath);

  // Render individual images for each issue type
  for (let i = 0; i < svgOverlays.length; i++) {
    const overlay = svgOverlays[i];
    // Sanitize issue type for filename (remove slashes and special chars)
    let issueType = (overlay.issue_type || `issue_${i}`).replace(/[\/\\:*?"<>|]/g, '_');
    
    // Extract inner SVG content
    let svgInner = overlay.svg_content || '';
    svgInner = svgInner.replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '');
    
    const individualPath = path.join(OUTPUT_DIR, `${analysisType}_${issueType}.jpg`);
    await renderSvgOnImage(frontImageBuffer, svgInner, individualPath);
    
    log(`Rendered ${issueType} overlay (${overlay.issue_count} issues)`, 'green');
  }

  // Also save the annotated image URL if available
  if (analysisData.annotated_image_url) {
    log('Downloading annotated image...', 'yellow');
    try {
      const annotatedBuffer = await downloadToBuffer(analysisData.annotated_image_url);
      const annotatedPath = path.join(OUTPUT_DIR, `${analysisType}_annotated.jpg`);
      fs.writeFileSync(annotatedPath, annotatedBuffer);
      log(`Saved annotated image: ${annotatedPath}`, 'green');
    } catch (error) {
      log(`Failed to download annotated image: ${error.message}`, 'yellow');
    }
  }

  // Save analysis results as JSON
  const resultsPath = path.join(OUTPUT_DIR, `${analysisType}_results.json`);
  fs.writeFileSync(resultsPath, JSON.stringify(analysisData, null, 2));
  log(`Saved analysis results: ${resultsPath}`, 'green');
}

async function main() {
  log('🚀 Starting Analysis SVG Test', 'blue');
  log(`Output directory: ${OUTPUT_DIR}`, 'yellow');
  
  // Check if sharp is available
  try {
    require('sharp');
    log('Sharp found - will render SVG overlays on images', 'green');
  } catch (e) {
    log('⚠️  Sharp not found. Install with: npm install --save-dev sharp', 'yellow');
    log('Without sharp, SVG files will be saved separately', 'yellow');
  }

  try {
    // Check if server is running
    try {
      await makeRequest('GET', '/health');
      log('Server is running', 'green');
    } catch (error) {
      log('Server is not running. Please start the server with: npm run dev', 'red');
      process.exit(1);
    }

    // Create user and get image URL
    const frontImageUrl = await test('Create User and Upload Image', createUser);

    // Get onboarding analysis (will poll for up to 5 minutes)
    const initialAnalysis = await test('Get Onboarding Analysis', getOnboardingAnalysis);
    
    // Wait a bit more for annotation to complete
    log('Waiting for annotation to complete...', 'yellow');
    await new Promise(r => setTimeout(r, 30000));

    // Get analysis again to check for SVG overlays (poll up to 5 minutes)
    const updatedAnalysis = await test('Get Updated Analysis', async () => {
      const maxWaitTime = 5 * 60 * 1000; // 5 minutes
      const pollInterval = 10000;
      const startTime = Date.now();

      log('Polling for INITIAL svg_overlays (max 5 minutes)...', 'yellow');

      while (Date.now() - startTime < maxWaitTime) {
        const response = await makeRequest('GET', '/v1/profile/analysis', null, {
          'Authorization': `Bearer ${accessToken}`
        });

        const entry = response?.data?.analysis?.find?.((a) => a.analysis_type === 'INITIAL');
        if (entry && Array.isArray(entry.svg_overlays) && entry.svg_overlays.length > 0 && entry.front_profile_url) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          log(`Found INITIAL svg_overlays after ${elapsed}s (${entry.svg_overlays.length} overlays)`, 'green');
          return entry;
        }

        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        process.stdout.write(`\r⏳ Waiting for INITIAL svg_overlays... (${elapsed}s)`);
        await new Promise(r => setTimeout(r, pollInterval));
      }

      process.stdout.write('\n');
      // return whatever we have (may be missing svg_overlays)
      const fallback = await makeRequest('GET', '/v1/profile/analysis', null, {
        'Authorization': `Bearer ${accessToken}`
      });
      return fallback?.data?.analysis?.find?.((a) => a.analysis_type === 'INITIAL');
    });

    // Visualize initial analysis if we have data
    if (updatedAnalysis) {
      await visualizeResults({
        analysis: updatedAnalysis.analysis,
        annotated_image_url: updatedAnalysis.annotated_image_url,
        svg_overlays: updatedAnalysis.svg_overlays,
        front_profile_url: updatedAnalysis.front_profile_url
      }, updatedAnalysis.front_profile_url || frontImageUrl, 'INITIAL');
    }

    // Run progress analysis
    if (!frontImageUrl) {
      throw new Error('frontImageUrl is not defined');
    }
    log(`Using front image URL: ${frontImageUrl}`, 'yellow');
    const progressAnalysis = await test('Run Progress Analysis', () => runProgressAnalysis(frontImageUrl));
    
    // Wait for progress annotation (progress analysis is synchronous, but give it time)
    log('Waiting for progress annotation to complete...', 'yellow');
    await new Promise(r => setTimeout(r, 30000));

    // Visualize progress analysis
    await visualizeResults(progressAnalysis, frontImageUrl, 'PROGRESS');

    log('\n🎉 All tests completed!', 'green');
    log(`\n📁 Results saved to: ${OUTPUT_DIR}`, 'blue');
    log('\nGenerated files:', 'blue');
    const files = fs.readdirSync(OUTPUT_DIR);
    files.forEach(file => {
      log(`  - ${file}`, 'yellow');
    });

  } catch (error) {
    log(`\n💥 Test failed: ${error.message}`, 'red');
    if (error.stack) {
      log(error.stack, 'red');
    }
    process.exit(1);
  }
}

// Run the test
main();

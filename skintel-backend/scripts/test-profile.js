// Test file for profile endpoints
// Run with: node scripts/test-profile.js

const testProfileEndpoints = () => {
  console.log('Profile API Endpoints Available:');
  console.log('- GET /v1/profile - Fetch user profile with facial landmarks and analysis');
  console.log('- PUT /v1/profile - Update user email and/or password');
  console.log('- DELETE /v1/profile - Delete user account and all associated data');
  console.log('\nAuthentication: Bearer token required for all endpoints');
  console.log('\nProfile GET response includes:');
  console.log('- User basic info (id, email, sso_provider, dates)');
  console.log('- Facial landmarks with analysis');
  console.log('- Onboarding answers');
  console.log('- User products');
  console.log('\nProfile PUT accepts:');
  console.log('- email: string (optional)');
  console.log('- password: string (optional, min 8 chars)');
  console.log('- At least one field must be provided');
  console.log('\nProfile DELETE removes:');
  console.log('- User account');
  console.log('- All refresh tokens');
  console.log('- All facial landmarks');
  console.log('- All onboarding answers');
  console.log('- All products');
  console.log('- Onboarding sessions');
};

testProfileEndpoints();
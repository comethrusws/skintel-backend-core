export interface DeviceInfo {
  os: string;
  os_version: string;
  app_version: string;
}

export interface AnonymousSessionRequest {
  device_id: string;
  device_info: DeviceInfo;
}

export interface AnonymousSessionResponse {
  session_id: string;
  session_token: string;
  expires_at: string;
}

export interface OnboardingAnswer {
  answer_id: string;
  screen_id: string;
  question_id: string;
  type: 'single' | 'multi' | 'slider' | 'image' | 'boolean' | 'derived';
  value: string | string[] | number | { image_id: string } | { image_url: string } | boolean;
  status: 'answered' | 'skipped';
  saved_at: string;
  landmarks?: {
    status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
    data?: LandmarkResponse;
    error?: string;
    processed_at?: string;
  };
}

export interface OnboardingRequest {
  session_id: string;
  answers: OnboardingAnswer[];
  screen_completed?: boolean;
}

export interface OnboardingResponse {
  saved: boolean;
  total_answers_received: number;
  answers: Array<{
    answer_id: string;
    saved: boolean;
    saved_at: string;
  }>;
  session_onboarding_status: 'in_progress' | 'completed' | 'skipped';
}

export interface OnboardingStateResponse {
  session_id: string;
  answers: Array<{
    question_id: string;
    value: string | string[] | number | { image_id: string } | boolean;
  }>;
}

export interface AuthSignupRequest {
  session_id: string;
  email: string;
  password: string;
}

export interface AuthLoginRequest {
  session_id: string;
  email: string;
  password: string;
}

export interface AuthSSORequest {
  session_id: string;
  provider: 'apple' | 'google';
  sso_token: string;
}

export interface AuthResponse {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  session_merged: boolean;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface LogoutRequest {
  refresh_token: string;
}

export interface LogoutResponse {
  status: 'logged_out';
}

export interface StoredSession {
  session_id: string;
  session_token: string;
  device_id: string;
  device_info: DeviceInfo;
  created_at: Date;
  expires_at: Date;
  answers: OnboardingAnswer[];
}

export interface StoredUser {
  user_id: string;
  email?: string;
  sso_provider?: string;
  sso_id?: string;
  password_hash?: string;
  created_at: Date;
  refresh_tokens: string[];
  merged_session_id?: string;
}

export type OnboardingAnswerValue = 
  | string 
  | number 
  | boolean 
  | string[] 
  | { image_id: string } | { image_url: string };

export interface LandmarkPoint {
  x: number;
  y: number;
  index: number;
}

export interface ImageInfo {
  filename: string;
  width: number;
  height: number;
  format: string;
}

export interface LandmarkResponse {
  status: 'success' | 'error';
  landmarks?: LandmarkPoint[];
  total_landmarks?: number;
  image_info?: ImageInfo;
  error?: string;
}

export interface LandmarkProcessingResult {
  success: boolean;
  data?: LandmarkResponse;
  error?: string;
}

export interface UserLandmarksResponse {
  user_id: string;
  landmarks: Array<{
    answer_id: string;
    question_id: string;
    screen_id: string;
    landmarks: LandmarkResponse;
    status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
    processed_at?: string;
    created_at: string;
  }>;
}
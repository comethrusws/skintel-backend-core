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

export interface ProfileUpdateRequest {
  name?: string;
  phone_number?: string;
}

export interface UserProfileResponse {
  user_id: string;
  name?: string;
  phone_number?: string;
  date_of_birth?: string;
  profile_image?: string;
  email?: string;
  sso_provider?: string;
  created_at: string;
  updated_at: string;
}

export interface WeeklyPlanItem {
  week: number;
  preview: string;
  improvement_expected: string;
  weekly_improvement_score?: number;
}

export interface EnhancedAnalysisResult {
  issues: Array<{
    type: string;
    region: string;
    severity: string;
    visible_in: string[];
    dlib_68_facial_landmarks: Array<{ x: number; y: number }>;
  }>;
  overall_assessment: string;
  images_analyzed: string[];
  score: number;
  estimated_improvement_score?: number;
  care_plan_4_weeks: WeeklyPlanItem[];
}

export interface UserAnalysisResponse {
  user_id: string;
  analysis: Array<{
    answer_id: string;
    question_id: string;
    screen_id: string;
    analysis?: any;
    score?: number;
    weekly_plan?: WeeklyPlanItem[];
    analysis_type?: 'INITIAL' | 'PROGRESS';
    plan_start_date?: string;
    plan_end_date?: string;
    status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
    processed_at?: string;
    created_at: string;
    error?: string;
  }>;
}

export interface UserLandmarksDataResponse {
  user_id: string;
  landmarks: Array<{
    answer_id: string;
    question_id: string;
    screen_id: string;
    landmarks: any;
    status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
    processed_at?: string;
    created_at: string;
    error?: string;
  }>;
}

export interface ProfileUpdateResponse {
  user_id: string;
  name?: string;
  phone_number?: string;
  date_of_birth?: string;
  profile_image?: string;
  email?: string;
  sso_provider?: string;
  created_at: string;
  updated_at: string;
  updated: boolean;
}

export interface ProfileDeleteResponse {
  user_id: string;
  deleted: boolean;
  deleted_at: string;
}

export interface VersionCheckRequest {
  current_version: string;
  platform: 'ios';
}

export interface VersionCheckResponse {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  update_required: boolean;
  download_url: string;
  platform: 'ios';
}

export interface ProgressAnalysisItem {
  answer_id: string;
  question_id: string;
  screen_id: string;
  analysis?: any;
  score?: number;
  weekly_plan?: WeeklyPlanItem[];
  analysis_type: 'INITIAL' | 'PROGRESS';
  created_at: string;
  days_since_initial: number;
}

export interface UserProgressResponse {
  user_id: string;
  has_active_plan: boolean;
  plan_start_date?: string;
  plan_end_date?: string;
  days_remaining?: number;
  days_elapsed?: number;
  initial_analysis?: ProgressAnalysisItem;
  progress_analyses: ProgressAnalysisItem[];
  latest_score?: number;
  score_improvement?: number;
  total_analyses_in_period: number;
  next_recommended_analysis?: string;
}

export interface LocationWeatherRequest {
  latitude: number;
  longitude: number;
}

export interface LocationWeatherResponse {
  latitude: number;
  longitude: number;
  temperature_celsius: number;
  weather_condition_range: 'minus_10_to_15_celsius' | '6_to_29_celsius' | '30_celsius_and_above';
  location_name?: string;
}

export interface ProgressUpdateResult {
  overall_progress_score: number;
  score_change: number;
  issues_improved: Array<{
    issue_type: string;
    initial_severity: string;
    current_severity: string;
    improvement_percentage: number;
  }>;
  plan_adherence: {
    weeks_completed: number;
    adherence_score: number;
    missed_recommendations: string[];
  };
  visual_improvements: string[];
  areas_needing_attention: string[];
  updated_recommendations: string[];
  next_week_focus: string;
}

export interface Task {
  id: string;
  userId: string;
  week: number; // 1-4
  title: string;
  description: string;
  timeOfDay: 'morning' | 'evening' | 'anytime';
  category: 'cleansing' | 'treatment' | 'moisturizing' | 'protection' | 'lifestyle';
  priority: 'critical' | 'important' | 'optional';
  recommendedProducts?: string[]; // product categories
  userProducts?: string[]; // user's scanned product IDs
  isActive: boolean;
  adaptations?: {
    skipCount: number;
    lastSkipped?: string;
    timeAdjusted?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TaskCompletion {
  id: string;
  taskId: string;
  userId: string;
  completedAt: string; // date string (YYYY-MM-DD)
  timestamp: string; // full datetime when marked complete
}

export interface DailyTasksResponse {
  date: string;
  week: number;
  dayOfPlan: number; // 1-28
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    timeOfDay: 'morning' | 'evening' | 'anytime';
    category: string;
    priority: 'critical' | 'important' | 'optional';
    recommendedProducts?: string[];
    userProducts?: Array<{
      id: string;
      name: string;
      category: string;
    }>;
    isCompleted: boolean;
    completedAt?: string;
  }>;
  completionRate: number;
  dailyScore: number;
}

export interface TaskProgressResponse {
  userId: string;
  currentWeek: number;
  currentDay: number; // 1-28
  overallScore: number;
  weeklyScores: Array<{
    week: number;
    score: number;
    completedTasks: number;
    totalTasks: number;
    criticalTasksCompleted: number;
    criticalTasksTotal: number;
  }>;
  dailyStreak: number;
  longestStreak: number;
  totalTasksCompleted: number;
  totalTasksPossible: number;
  planStartDate: string;
  planEndDate: string;
  recentActivity: Array<{
    date: string;
    score: number;
    tasksCompleted: number;
    tasksTotal: number;
  }>;
}

export interface TaskGenerationRequest {
  userId: string;
  weeklyPlan: WeeklyPlanItem[];
  userProducts?: Array<{
    id: string;
    category: string;
    name: string;
    ingredients?: string[];
  }>;
  force?: boolean;
}

export interface TaskCompletionRequest {
  taskId: string;
  completedAt?: string; // optional, defaults to today. as it shudl
}

export interface TaskAdaptationResult {
  taskId: string;
  adaptationType: 'time_adjusted' | 'made_optional' | 'alternative_suggested';
  reason: string;
  newTimeOfDay?: 'morning' | 'evening' | 'anytime';
  alternativeTask?: {
    title: string;
    description: string;
  };
}
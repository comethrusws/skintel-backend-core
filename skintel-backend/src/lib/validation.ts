import { z } from 'zod';
import { OnboardingAnswerValue } from '../types';
import { 
  VALID_QUESTION_IDS, 
  validateQuestionValue, 
  getExpectedType 
} from '../utils/validation';

export const deviceInfoSchema = z.object({
  os: z.string().min(1),
  os_version: z.string().min(1),
  app_version: z.string().min(1),
});

export const anonymousSessionRequestSchema = z.object({
  device_id: z.string().uuid(),
  device_info: deviceInfoSchema,
});

export const answerValueSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.number().int(),
  z.object({ image_id: z.string().startsWith('img_') }),
  z.object({ image_url: z.string().url() }),
  z.boolean(),
]);

export const onboardingAnswerSchema = z.object({
  answer_id: z.string().min(1),
  screen_id: z.string().min(1),
  question_id: z.string().min(1).refine(
    (id) => VALID_QUESTION_IDS.includes(id as any),
    { message: "Invalid question_id" }
  ),
  type: z.enum(['single', 'multi', 'slider', 'image', 'boolean', 'derived']),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.object({ image_id: z.string() }),
    z.object({ image_url: z.string() }),
  ]) as z.ZodSchema<OnboardingAnswerValue>,
  status: z.enum(['answered', 'skipped']),
  saved_at: z.string().datetime(),
}).refine(
  (data) => {
    const expectedType = getExpectedType(data.question_id);
    return expectedType === data.type;
  },
  { message: "Answer type doesn't match expected type for question_id" }
).refine(
  (data) => {
    if (data.status === 'skipped') return true; // skipc validation for skipped questions
    return validateQuestionValue(data.question_id, data.value);
  },
  { message: "Invalid value for question_id" }
);

export const onboardingRequestSchema = z.object({
  session_id: z.string().min(1),
  answers: z.array(onboardingAnswerSchema),
  screen_completed: z.boolean().optional(),
});

export const authSignupRequestSchema = z.object({
  session_id: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

export const authLoginRequestSchema = z.object({
  session_id: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

export const authSSORequestSchema = z.object({
  session_id: z.string().min(1),
  provider: z.enum(['apple', 'google']),
  sso_token: z.string().min(1),
});

export const refreshTokenRequestSchema = z.object({
  refresh_token: z.string().min(1),
});

export const logoutRequestSchema = z.object({
  refresh_token: z.string().min(1),
});


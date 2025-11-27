import { z } from 'zod';
import { OnboardingAnswerValue } from '../types';
import {
  VALID_QUESTION_IDS,
  validateQuestionValue,
  getExpectedType,
  getValidValues
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
  {
    message: "Answer type doesn't match expected type for question_id",
    path: ["type"]
  }
).refine(
  (data) => {
    if (data.status === 'skipped') return true;
    const isValid = validateQuestionValue(data.question_id, data.value);
    if (!isValid) {
      console.log(`Validation failed for ${data.question_id}:`, {
        value: data.value,
        expectedType: getExpectedType(data.question_id),
        validValues: getValidValues(data.question_id)
      });
    }
    return isValid;
  },
  {
    message: "Invalid value for question_id",
    path: ["value"]
  }
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
  provider: z.enum(['clerk_google', 'clerk_apple', 'clerk_facebook']),
  clerk_token: z.string().min(1),
  clerk_session_id: z.string().min(1),
});

export const refreshTokenRequestSchema = z.object({
  refresh_token: z.string().min(1),
});

export const logoutRequestSchema = z.object({
  refresh_token: z.string().min(1),
});

export const profileUpdateRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone_number: z.string().min(1).max(20).optional(),
}).refine(
  (data) => data.name || data.phone_number,
  { message: "At least one field (name or phone_number) must be provided" }
);

export const profileLocationUpdateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const versionCheckRequestSchema = z.object({
  current_version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be in format x.y.z"),
  platform: z.enum(['ios']),
});

export const locationWeatherRequestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email()
});

export const passwordResetConfirmSchema = z.object({
  reset_token: z.string().min(1),
  new_password: z.string().min(8)
});

export const skinFeelRequestSchema = z.object({
  value: z.enum(['feeling_rough', 'not_great', 'feeling_good', 'feeling_fresh', 'glowing'])
});

// profile questions validation
export const profileQuestionAnswerSchema = z.object({
  question_id: z.string().min(1),
  value: z.union([z.string(), z.number(), z.null()]),
  status: z.enum(['answered', 'skipped']),
}).refine(
  (data) => {
    if (data.status === 'skipped') {
      return data.value === null;
    }
    return data.value !== null;
  },
  {
    message: "Answered questions must have a value, skipped questions must have null value",
    path: ["value"]
  }
);

export const profileQuestionsAnswerRequestSchema = z.object({
  answers: z.array(profileQuestionAnswerSchema).min(1),
});

export const paymentVerifySchema = z.object({
  receipt_data: z.string().min(1),
  product_id: z.string().min(1),
});

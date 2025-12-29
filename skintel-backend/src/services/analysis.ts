import { prisma } from '../lib/prisma';
import OpenAI from 'openai';
import { maybePresignUrl, uploadImageToS3 } from '../lib/s3';
import axios from 'axios';
import { EnhancedAnalysisResult } from '../types';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getImageUrl(imageId: string): string {
  // temp implementation until S3  is wired
  if (imageId.startsWith('http://') || imageId.startsWith('https://')) return imageId;
  return `http://localhost:3000/images/${imageId}`;
}

interface UserOnboardingProfile {
  ethnicity?: string;
  age?: number;
  gender?: string;
  skinType?: string;
  skinConcerns?: string[];
  skinSensitivity?: string;
  goals?: string[];
  sunExposure?: string;
  weatherConditions?: string;
  medicalConditions?: string[];
  hormoneFactors?: string[];
}

async function getUserOnboardingProfile(userId: string | null, sessionId: string | null): Promise<UserOnboardingProfile> {
  const relevantQuestions = [
    'q_profile_ethnicity',
    'q_age',
    'q_profile_gender',
    'q_skin_type',
    'q_skin_concerns',
    'q_skin_sensitivity',
    'q_goal',
    'q_profile_sun_exposure',
    'q_profile_weather_conditions',
    'q_medical_conditions',
    'q_hormone_factors'
  ];

  const answers = await prisma.onboardingAnswer.findMany({
    where: {
      OR: [
        { userId: userId },
        { sessionId: sessionId }
      ],
      questionId: { in: relevantQuestions },
      status: 'answered'
    }
  });

  const profile: UserOnboardingProfile = {};

  for (const answer of answers) {
    const value = answer.value;

    switch (answer.questionId) {
      case 'q_profile_ethnicity':
        profile.ethnicity = typeof value === 'string' ? value : undefined;
        break;
      case 'q_age':
        profile.age = typeof value === 'number' ? value : undefined;
        break;
      case 'q_profile_gender':
        profile.gender = typeof value === 'string' ? value : undefined;
        break;
      case 'q_skin_type':
        profile.skinType = typeof value === 'string' ? value : undefined;
        break;
      case 'q_skin_concerns':
        profile.skinConcerns = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
        break;
      case 'q_skin_sensitivity':
        profile.skinSensitivity = typeof value === 'string' ? value : undefined;
        break;
      case 'q_goal':
        profile.goals = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
        break;
      case 'q_profile_sun_exposure':
        profile.sunExposure = typeof value === 'string' ? value : undefined;
        break;
      case 'q_profile_weather_conditions':
        profile.weatherConditions = typeof value === 'string' ? value : undefined;
        break;
      case 'q_medical_conditions':
        profile.medicalConditions = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
        break;
      case 'q_hormone_factors':
        profile.hormoneFactors = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
        break;
    }
  }

  return profile;
}

function formatProfileContext(profile: UserOnboardingProfile): string {
  const parts: string[] = [];

  if (profile.ethnicity) {
    parts.push(`Ethnicity: ${profile.ethnicity.replace(/_/g, ' ')}`);
  }
  if (profile.age) {
    parts.push(`Age: ${profile.age}`);
  }
  if (profile.gender) {
    parts.push(`Gender: ${profile.gender.replace(/_/g, ' ')}`);
  }
  if (profile.skinType) {
    parts.push(`Skin Type: ${profile.skinType.replace(/_/g, ' ')}`);
  }
  if (profile.skinSensitivity) {
    parts.push(`Skin Sensitivity: ${profile.skinSensitivity.replace(/_/g, ' ')}`);
  }
  if (profile.skinConcerns && profile.skinConcerns.length > 0) {
    parts.push(`Primary Skin Concerns: ${profile.skinConcerns.map(c => c.replace(/_/g, ' ')).join(', ')}`);
  }
  if (profile.goals && profile.goals.length > 0) {
    parts.push(`Skincare Goals: ${profile.goals.map(g => g.replace(/_/g, ' ')).join(', ')}`);
  }
  if (profile.sunExposure) {
    parts.push(`Sun Exposure: ${profile.sunExposure.replace(/_/g, ' ')}`);
  }
  if (profile.weatherConditions) {
    parts.push(`Climate/Weather: ${profile.weatherConditions.replace(/_/g, ' ')}`);
  }
  if (profile.medicalConditions && profile.medicalConditions.length > 0) {
    const conditions = profile.medicalConditions.filter(c => c !== 'none');
    if (conditions.length > 0) {
      parts.push(`Medical Conditions: ${conditions.map(c => c.replace(/_/g, ' ')).join(', ')}`);
    }
  }
  if (profile.hormoneFactors && profile.hormoneFactors.length > 0) {
    const factors = profile.hormoneFactors.filter(f => f !== 'none');
    if (factors.length > 0) {
      parts.push(`Hormone Factors: ${factors.map(f => f.replace(/_/g, ' ')).join(', ')}`);
    }
  }

  return parts.length > 0 ? `\n\nUSER PROFILE:\n${parts.join('\n')}` : '';
}

function buildPrompt(): string {
  return (
    'You are a dermatologist assistant AI specializing in personalized skin analysis.\n' +
    'You will receive 1-3 face images (front, left profile, right profile), facial landmarks data, and the user\'s profile information.\n' +
    '\n' +
    'IMPORTANT: Use the user profile to provide HYPER-PERSONALIZED analysis:\n' +
    '- ETHNICITY: Consider skin tone, melanin levels, and region-specific concerns (e.g., hyperpigmentation in darker skin, sun damage patterns in lighter skin)\n' +
    '- AGE: Provide age-appropriate recommendations and identify age-related concerns\n' +
    '- CLIMATE/WEATHER: Tailor recommendations to their environment (humidity, sun protection needs, temperature)\n' +
    '- SKIN TYPE & SENSITIVITY: Adjust ingredient recommendations and treatment intensity\n' +
    '- MEDICAL CONDITIONS: Avoid contraindicated ingredients, suggest gentle alternatives\n' +
    '- SUN EXPOSURE: Adjust protection recommendations based on outdoor time\n' +
    '\n' +
    'Your task:\n' +
    '1. Analyze skin across all provided images with special attention to ethnicity-specific patterns\n' +
    '2. Identify SPECIFIC, LOCALIZED skin issues - not large general areas\n' +
    '3. For dark circles: use left_under_eye or right_under_eye (small crescent under the eye)\n' +
    '4. For pigmentation/acne: specify exact location (left_cheek, right_cheek, forehead, nose, etc.)\n' +
    '5. Keep marked regions SMALL and PRECISE - only mark the visible problem area\n' +
    '6. Provide an overall skin health score out of 100\n' +
    '7. Create a 4-week improvement plan tailored to their ethnicity, climate, and skin profile\n' +
    '8. Return the facial issues in 68 face landmark data format in JSON\n' +
    '9. Make sure to also analyse for any lip related issues like pigmentation\n' +
    '10. Reference their profile in recommendations (e.g., "Given your [ethnicity] and [climate], I recommend...")\n' +
    '\n' +
    'Example JSON output (clearly highlight the issues visible in the images) and respond strictly in the following json format! DO NOT ADD ANYTHING ELSE:\n' +
    '{\n' +
    '  "issues": [\n' +
    '    {"type": "dark_circles", "region": "left_under_eye", "severity": "moderate", "visible_in": ["front"], "dlib_68_facial_landmarks": [\n' +
    '      {"x": 30, "y": 40},\n' +
    '      {"x": 32, "y": 42}\n' +
    '    ]},\n' +
    '    {"type": "uneven_skin_tone", "region": "left_cheek", "severity": "mild", "visible_in": ["front", "left"], "dlib_68_facial_landmarks": [\n' +
    '      {"x": 50, "y": 60},\n' +
    '      {"x": 52, "y": 62}\n' +
    '    ]},\n' +
    '    {"type": "acne", "region": "right_cheek", "severity": "mild", "visible_in": ["front", "right"], "dlib_68_facial_landmarks": [\n' +
    '      {"x": 55, "y": 65},\n' +
    '      {"x": 57, "y": 67}\n' +
    '    ]}\n' +
    '  ],\n' +
    '  "important_notes": "1. Use SMALL, PRECISE regions. 2. For dark circles: left_under_eye or right_under_eye (NOT eye). 3. For pigmentation: specify exact small area like left_cheek, right_cheek. 4. Avoid marking large areas - be specific and localized. 5. Only mark the visible problem area, not the entire face region.",\n' +
    '  "overall_assessment": "Combination skin with mild acne and moderate dark circles. Analysis tailored for [user ethnicity/profile]",\n' +
    '  "score": 72,\n' +
    '  "estimated_improvement_score": 85,\n' +
    '  "care_plan_4_weeks": [\n' +
    '    {"week": 1, "preview": "Start gentle cleansing routine with salicylic acid suitable for [skin type]", "improvement_expected": "15%", "weekly_improvement_score": 75},\n' +
    '    {"week": 2, "preview": "Add eye cream for dark circles and maintain cleansing. Consider [climate]-appropriate moisturizer", "improvement_expected": "30%", "weekly_improvement_score": 78},\n' +
    '    {"week": 3, "preview": "Introduce retinol treatment and enhanced sun protection for [sun exposure level]", "improvement_expected": "50%", "weekly_improvement_score": 82},\n' +
    '    {"week": 4, "preview": "Maintain routine and assess overall progress", "improvement_expected": "70%", "weekly_improvement_score": 85}\n' +
    '  ],\n' +
    '  "estimated_weekly_scores": {"week_1": 75, "week_2": 78, "week_3": 82, "week_4": 85},\n' +
    '  "images_analyzed": ["front", "left", "right"]\n' +
    '}'
  );
}

function buildProgressPrompt(): string {
  return (
    'You are a dermatologist assistant AI specializing in personalized progress tracking.\n' +
    'You will receive:\n' +
    '1. Current face images (front, left profile, right profile) with landmarks\n' +
    '2. Initial analysis data with weekly plan and baseline score\n' +
    '3. Time elapsed since initial analysis\n' +
    '4. User profile information (ethnicity, age, climate, skin type, etc.)\n' +
    '\n' +
    'IMPORTANT: Maintain consistency with the user\'s profile throughout tracking: \n' +
    '- Reference their ETHNICITY when discussing skin changes and concerns\n' +
    '- Consider their CLIMATE/WEATHER in recommendations\n' +
    '- Adjust expectations based on AGE and SKIN TYPE\n' +
    '- Account for MEDICAL CONDITIONS and SENSITIVITY in suggestions\n' +
    '\n' +
    'Your task:\n' +
    '1. Compare current skin condition to initial analysis\n' +
    '2. Evaluate progress on specific issues identified initially\n' +
    '3. Assess adherence to the 4-week improvement plan\n' +
    '4. Provide progress score and updated recommendations tailored to their profile\n' +
    '5. Identify visual improvements and areas needing attention\n' +
    '6. Make sure to also analyse for any lip related issues like pigmentation\n' +
    '7. Ensure recommendations remain appropriate for their ethnicity, climate, and skin profile\n' +
    '\n' +
    'Respond strictly in this JSON format:\n' +
    '{\n' +
    '  "overall_progress_score": 85,\n' +
    '  "score_change": 13,\n' +
    '  "estimated_improvement_score": 92,\n' +
    '  "issues_improved": [\n' +
    '    {"issue_type": "dark_circles", "initial_severity": "moderate", "current_severity": "mild", "improvement_percentage": 40}\n' +
    '  ],\n' +
    '  "plan_adherence": {\n' +
    '    "weeks_completed": 2,\n' +
    '    "adherence_score": 75,\n' +
    '    "missed_recommendations": ["retinol application", "sun protection"]\n' +
    '  },\n' +
    '  "visual_improvements": ["reduced under-eye puffiness", "clearer T-zone"],\n' +
    '  "areas_needing_attention": ["forehead texture", "jawline breakouts"],\n' +
    '  "updated_recommendations": ["increase retinol frequency suitable for [skin type]", "add exfoliation appropriate for [ethnicity/skin tone]"],\n' +
    '  "next_week_focus": "Focus on consistency with evening routine and add gentle exfoliation twice weekly. Given your [climate], ensure adequate moisturization.",\n' +
    '  "updated_weekly_scores": {"week_1": 85, "week_2": 88, "week_3": 90, "week_4": 92},\n' +
    '  "remaining_issues": [\n' +
    '    {"type": "dark_circles", "region": "under_eye_left", "severity": "mild", "visible_in": ["front"], "dlib_68_facial_landmarks": [\n' +
    '      {"x": 30, "y": 40},\n' +
    '      {"x": 32, "y": 42}\n' +
    '    ]}\n' +
    '  ]\n' +
    '}'
  );
}

interface FaceImages {
  front?: string;
  left?: string;
  right?: string;
}

async function getUserFaceImages(userId: string | null, sessionId: string | null): Promise<FaceImages> {
  const faceQuestions = ['q_face_photo_front', 'q_face_photo_left', 'q_face_photo_right'];

  const answers = await prisma.onboardingAnswer.findMany({
    where: {
      OR: [
        { userId: userId },
        { sessionId: sessionId }
      ],
      questionId: { in: faceQuestions },
      status: 'answered'
    }
  });

  const images: FaceImages = {};

  for (const answer of answers) {
    const value = answer.value as unknown as { image_id?: string; image_url?: string } | undefined;
    const imageUrl = typeof value?.image_url === 'string'
      ? value.image_url
      : (value?.image_id ? getImageUrl(value.image_id) : undefined);

    if (imageUrl) {
      if (answer.questionId === 'q_face_photo_front') images.front = imageUrl;
      else if (answer.questionId === 'q_face_photo_left') images.left = imageUrl;
      else if (answer.questionId === 'q_face_photo_right') images.right = imageUrl;
    }
  }

  return images;
}

async function determineAnalysisType(userId: string | null, sessionId: string | null): Promise<{
  type: 'INITIAL' | 'PROGRESS',
  planStartDate?: Date,
  planEndDate?: Date
}> {
  const recentAnalysis = await prisma.facialLandmarks.findFirst({
    where: {
      OR: [
        { userId: userId },
        { answer: { sessionId: sessionId } }
      ],
      planStartDate: { not: null }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!recentAnalysis || !recentAnalysis.planEndDate) {
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 28);

    return {
      type: 'INITIAL',
      planStartDate: startDate,
      planEndDate: endDate
    };
  }

  const now = new Date();
  if (now <= recentAnalysis.planEndDate) {
    return {
      type: 'PROGRESS',
      planStartDate: recentAnalysis.planStartDate!,
      planEndDate: recentAnalysis.planEndDate
    };
  } else {
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 28);

    return {
      type: 'INITIAL',
      planStartDate: startDate,
      planEndDate: endDate
    };
  }
}

export async function analyzeSkin(answerId: string) {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set');
    throw new Error('OPENAI_API_KEY is not set');
  }

  const record = await prisma.facialLandmarks.findUnique({
    where: { answerId },
    select: {
      landmarks: true,
      answer: {
        select: { userId: true, sessionId: true }
      }
    }
  });

  if (!record) {
    console.error(`No landmarks record found for answerId: ${answerId}`);
    throw new Error('Landmarks record not found');
  }

  const faceImages = await getUserFaceImages(record.answer?.userId, record.answer?.sessionId);

  if (!faceImages.front && !faceImages.left && !faceImages.right) {
    console.error('No face images found for analysis');
    throw new Error('No face images found for analysis');
  }

  let analysisTypeInfo;
  try {
    analysisTypeInfo = await determineAnalysisType(record.answer?.userId, record.answer?.sessionId);
  } catch (error) {
    console.error('Error determining analysis type:', error);
    throw error;
  }

  const landmarks = record.landmarks as unknown as object;
  const prompt = buildPrompt();

  const imageContent: any[] = [];
  const availableImages: string[] = [];

  // Parallelize image presigning for better performance
  const imagePromises: Promise<void>[] = [];

  if (faceImages.front) {
    imagePromises.push(
      maybePresignUrl(faceImages.front, 300).then(presignedUrl => {
        imageContent.push({ type: 'image_url', image_url: { url: presignedUrl } });
        availableImages.push('front');
      })
    );
  }

  if (faceImages.left) {
    imagePromises.push(
      maybePresignUrl(faceImages.left, 300).then(presignedUrl => {
        imageContent.push({ type: 'image_url', image_url: { url: presignedUrl } });
        availableImages.push('left');
      })
    );
  }

  if (faceImages.right) {
    imagePromises.push(
      maybePresignUrl(faceImages.right, 300).then(presignedUrl => {
        imageContent.push({ type: 'image_url', image_url: { url: presignedUrl } });
        availableImages.push('right');
      })
    );
  }

  try {
    await Promise.all(imagePromises);
  } catch (error) {
    console.error('Error processing images:', error);
    throw error;
  }

  // Fetch user profile for personalized analysis
  const userProfile = await getUserOnboardingProfile(record.answer?.userId, record.answer?.sessionId);
  const profileContext = formatProfileContext(userProfile);

  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze these face images (${availableImages.join(', ')}) with facial landmarks. Provide comprehensive skin analysis with score and 4-week plan.${profileContext}`
            },
            ...imageContent,
            { type: 'text', text: `Landmarks: ${JSON.stringify(landmarks)}` }
          ]
        }
      ],
      response_format: { type: 'json_object' }
    });
  } catch (error) {
    console.error('OpenAI API call failed:', error);
    throw error;
  }

  const content = completion.choices?.[0]?.message?.content ?? '';

  let parsed: EnhancedAnalysisResult;
  try {
    parsed = JSON.parse(content) as EnhancedAnalysisResult;
  } catch (parseError) {
    console.error('Failed to parse OpenAI response as JSON:', parseError);
    parsed = { raw: content } as any;
  }

  if (parsed.issues && parsed.issues.length > 0 && faceImages.front) {
    generateAnnotatedImageBackground(faceImages.front, parsed.issues, answerId).catch(err => {
      console.error('Background annotation failed for analyzeSkin:', err);
    });
  }

  try {
    await prisma.facialLandmarks.update({
      where: { answerId },
      data: {
        analysis: parsed as any,
        score: parsed.score || null,
        weeklyPlan: parsed.care_plan_4_weeks as any,
        analysisType: analysisTypeInfo.type,
        planStartDate: analysisTypeInfo.planStartDate,
        planEndDate: analysisTypeInfo.planEndDate,
        annotatedImageUrl: null
      }
    });
  } catch (dbError) {
    console.error('Failed to update database:', dbError);
    throw dbError;
  }

  return parsed;
}

export async function analyzeProgress(
  currentImages: { front: string; left?: string; right?: string },
  currentLandmarks: object,
  initialAnalysis: any,
  initialScore: number,
  weeklyPlan: any[],
  daysElapsed: number,
  userId?: string | null,
  sessionId?: string | null
): Promise<any> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const prompt = buildProgressPrompt();
  const imageContent: any[] = [];
  const availableImages: string[] = [];

  const imagePromises: Promise<void>[] = [];

  imagePromises.push(
    maybePresignUrl(currentImages.front, 300).then(presignedUrl => {
      imageContent.push({ type: 'image_url', image_url: { url: presignedUrl } });
      availableImages.push('front');
    })
  );

  if (currentImages.left) {
    imagePromises.push(
      maybePresignUrl(currentImages.left, 300).then(presignedUrl => {
        imageContent.push({ type: 'image_url', image_url: { url: presignedUrl } });
        availableImages.push('left');
      })
    );
  }

  if (currentImages.right) {
    imagePromises.push(
      maybePresignUrl(currentImages.right, 300).then(presignedUrl => {
        imageContent.push({ type: 'image_url', image_url: { url: presignedUrl } });
        availableImages.push('right');
      })
    );
  }

  await Promise.all(imagePromises);

  const weeksElapsed = Math.floor(daysElapsed / 7);
  const currentWeekPlan = weeklyPlan[Math.min(weeksElapsed, weeklyPlan.length - 1)];

  // Fetch user profile for personalized progress tracking
  const userProfile = await getUserOnboardingProfile(userId ?? null, sessionId ?? null);
  const profileContext = formatProfileContext(userProfile);

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze progress in these current images (${availableImages.join(', ')}) compared to initial analysis and return your response in JSON.${profileContext}`
          },
          ...imageContent,
          {
            type: 'text',
            text: `Current landmarks: ${JSON.stringify(currentLandmarks)}\n` +
              `Initial analysis: ${JSON.stringify(initialAnalysis)}\n` +
              `Initial score: ${initialScore}\n` +
              `Weekly plan: ${JSON.stringify(weeklyPlan)}\n` +
              `Days elapsed: ${daysElapsed}\n` +
              `Current week plan: ${JSON.stringify(currentWeekPlan)}`
          }
        ]
      }
    ],
    response_format: { type: 'json_object' },
  });

  const content = completion.choices?.[0]?.message?.content ?? '';
  let parsed: any;

  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { raw: content };
  }

  // generation of annotated image
  let annotatedImageUrl: string | null = null;
  try {
    if (parsed.remaining_issues && parsed.remaining_issues.length > 0 && currentImages.front) {
      const frontImagePresigned = await maybePresignUrl(currentImages.front, 86400);

      const microserviceUrl = process.env.LANDMARK_URL || process.env.FACIAL_LANDMARKS_API_URL || 'http://localhost:8000';

      const annotationResponse = await axios.post(`${microserviceUrl}/api/v1/annotate-issues-from-url`, {
        image_url: frontImagePresigned,
        issues: parsed.remaining_issues
      });

      if (annotationResponse.data.status === 'success' && annotationResponse.data.annotated_image) {
        const uploadResult = await uploadImageToS3({
          imageBase64: annotationResponse.data.annotated_image,
          prefix: 'annotated-issues-progress'
        });
        annotatedImageUrl = uploadResult.url;

        // Use the updated issues with correct MediaPipe landmarks
        if (annotationResponse.data.issues) {
          parsed.remaining_issues = annotationResponse.data.issues;
        }
      }
    }
  } catch (annotationError) {
    console.error('Failed to generate annotated image in analyzeProgress:', annotationError);
  }

  return { ...parsed, annotatedImageUrl };
}

export async function analyzeWithLandmarks(frontImageUrl: string, landmarks: object, answerId: string, leftImageUrl?: string, rightImageUrl?: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const prompt = buildPrompt();

  const imageContent: any[] = [];
  const availableImages: string[] = [];

  const imagePromises: Promise<void>[] = [];

  imagePromises.push(
    maybePresignUrl(frontImageUrl, 300).then(presignedUrl => {
      imageContent.push({ type: 'image_url', image_url: { url: presignedUrl } });
      availableImages.push('front');
    })
  );

  if (leftImageUrl) {
    imagePromises.push(
      maybePresignUrl(leftImageUrl, 300).then(presignedUrl => {
        imageContent.push({ type: 'image_url', image_url: { url: presignedUrl } });
        availableImages.push('left');
      })
    );
  }

  if (rightImageUrl) {
    imagePromises.push(
      maybePresignUrl(rightImageUrl, 300).then(presignedUrl => {
        imageContent.push({ type: 'image_url', image_url: { url: presignedUrl } });
        availableImages.push('right');
      })
    );
  }

  await Promise.all(imagePromises);

  // Fetch user profile for personalized analysis
  const answerRecord = await prisma.onboardingAnswer.findUnique({
    where: { answerId },
    select: { userId: true, sessionId: true }
  });

  const userProfile = await getUserOnboardingProfile(answerRecord?.userId ?? null, answerRecord?.sessionId ?? null);
  const profileContext = formatProfileContext(userProfile);

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze these face images (${availableImages.join(', ')}) with facial landmarks for comprehensive skin analysis.${profileContext}`
          },
          ...imageContent,
          { type: 'text', text: `Landmarks: ${JSON.stringify(landmarks)}` }
        ]
      }
    ],
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content ?? '';
  let parsed: EnhancedAnalysisResult;

  try {
    parsed = JSON.parse(content) as EnhancedAnalysisResult;
  } catch {
    return { raw: content } as any;
  }

  // generation of annotated image in background
  if (parsed.issues && parsed.issues.length > 0) {
    generateAnnotatedImageBackground(frontImageUrl, parsed.issues, answerId).catch(err => {
      console.error('Background annotation failed for analyzeWithLandmarks:', err);
    });
  }


  return { ...parsed, annotatedImageUrl: null };
}

async function generateAnnotatedImageBackground(
  imageUrl: string,
  issues: any[],
  answerId: string
) {
  try {
    const presignedUrl = await maybePresignUrl(imageUrl, 300);
    const microserviceUrl = process.env.LANDMARK_URL || process.env.FACIAL_LANDMARKS_API_URL || 'http://localhost:8000';

    const annotationResponse = await axios.post(`${microserviceUrl}/api/v1/annotate-issues-from-url`, {
      image_url: presignedUrl,
      issues: issues
    });

    if (annotationResponse.data.status === 'success' && annotationResponse.data.annotated_image) {
      const uploadResult = await uploadImageToS3({
        imageBase64: annotationResponse.data.annotated_image,
        prefix: 'annotated-issues'
      });

      await prisma.facialLandmarks.update({
        where: { answerId },
        data: {
          annotatedImageUrl: uploadResult.url
        }
      });

      console.log(`[Background] Annotated image updated for answer ${answerId}`);
    }
  } catch (annotationError) {
    console.error('Failed to generate annotated image in background:', annotationError);
  }



}

// Export these for the optimized functions
export { buildPrompt, buildProgressPrompt, openai, OPENAI_MODEL, getUserOnboardingProfile, formatProfileContext };

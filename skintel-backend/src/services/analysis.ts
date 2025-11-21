import { prisma } from '../lib/prisma';
import OpenAI from 'openai';
import { maybePresignUrl, uploadImageToS3 } from '../lib/s3';
import axios from 'axios';
import { EnhancedAnalysisResult } from '../types';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getImageUrl(imageId: string): string {
  // temp implementation until S3  is wired
  if (imageId.startsWith('http://') || imageId.startsWith('https://')) return imageId;
  return `http://localhost:3000/images/${imageId}`;
}

function buildPrompt(): string {
  return (
    'You are a dermatologist assistant AI.\n' +
    'You will receive 1-3 face images (front, left profile, right profile) and facial landmarks data from the front image.\n' +
    'Your task:\n' +
    '1. Analyze skin across all provided images\n' +
    '2. Clearly mention the affected regions (e.g., "mild acne on the right cheek", "dark spots on left temple")\n' +
    '3. Give severity-based explanations (mild = easy care, severe = consider dermatologist)\n' +
    '4. Use information from all angles to provide comprehensive analysis\n' +
    '5. Provide an overall skin health score out of 100\n' +
    '6. Create a 4-week improvement plan with weekly previews and expected improvement percentages\n' +
    '7. Return the facial issues in 68 face landmark data format in JSON\n' +
    '\n' +
    'Example JSON output (clearly highlight the issues visible in the images) and respond strictly in the following json format! DO NOT ADD ANYTHING ELSE:\n' +
    '{\n' +
    '  "issues": [\n' +
    '    {"type": "dark_circles", "region": "under_eye_left", "severity": "moderate", "visible_in": ["front"], "dlib_68_facial_landmarks": [\n' +
    '      {"x": 30, "y": 40},\n' +
    '      {"x": 32, "y": 42}\n' +
    '    ]},\n' +
    '    {"type": "acne", "region": "cheek_right", "severity": "mild", "visible_in": ["front", "right"], "dlib_68_facial_landmarks": [\n' +
    '      {"x": 50, "y": 60},\n' +
    '      {"x": 52, "y": 62}\n' +
    '    ]}\n' +
    '  ],\n' +
    '  "overall_assessment": "Combination skin with mild acne and moderate dark circles",\n' +
    '  "score": 72,\n' +
    '  "care_plan_4_weeks": [\n' +
    '    {"week": 1, "preview": "Start gentle cleansing routine with salicylic acid", "improvement_expected": "15%"},\n' +
    '    {"week": 2, "preview": "Add eye cream for dark circles and maintain cleansing", "improvement_expected": "30%"},\n' +
    '    {"week": 3, "preview": "Introduce retinol treatment and sun protection", "improvement_expected": "50%"},\n' +
    '    {"week": 4, "preview": "Maintain routine and assess overall progress", "improvement_expected": "70%"}\n' +
    '  ],\n' +
    '  "images_analyzed": ["front", "left", "right"]\n' +
    '}'
  );
}

function buildProgressPrompt(): string {
  return (
    'You are a dermatologist assistant AI specializing in progress tracking.\n' +
    'You will receive:\n' +
    '1. Current face images (front, left profile, right profile) with landmarks\n' +
    '2. Initial analysis data with weekly plan and baseline score\n' +
    '3. Time elapsed since initial analysis\n' +
    '\n' +
    'Your task:\n' +
    '1. Compare current skin condition to initial analysis\n' +
    '2. Evaluate progress on specific issues identified initially\n' +
    '3. Assess adherence to the 4-week improvement plan\n' +
    '4. Provide progress score and updated recommendations\n' +
    '5. Identify visual improvements and areas needing attention\n' +
    '\n' +
    'Respond strictly in this JSON format:\n' +
    '{\n' +
    '  "overall_progress_score": 85,\n' +
    '  "score_change": 13,\n' +
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
    '  "updated_recommendations": ["increase retinol frequency", "add exfoliation"],\n' +
    '  "next_week_focus": "Focus on consistency with evening routine and add gentle exfoliation twice weekly",\n' +
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
              text: `Analyze these face images (${availableImages.join(', ')}) with facial landmarks. Provide comprehensive skin analysis with score and 4-week plan.`
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

  // generation of annotated image
  let annotatedImageUrl: string | null = null;
  try {
    if (parsed.issues && parsed.issues.length > 0 && faceImages.front) {
      const frontImagePresigned = await maybePresignUrl(faceImages.front, 300);

      const microserviceUrl = process.env.LANDMARK_URL || 'http://skintel-facial-landmarks:8000';

      const annotationResponse = await axios.post(`${microserviceUrl}/api/v1/annotate-issues-from-url`, {
        image_url: frontImagePresigned,
        issues: parsed.issues
      });

      console.log(`[Analysis] Annotation service response status: ${annotationResponse.data.status}`);

      if (annotationResponse.data.status === 'success' && annotationResponse.data.annotated_image) {
        console.log(`[Analysis] Uploading annotated image to S3...`);
        const uploadResult = await uploadImageToS3({
          imageBase64: annotationResponse.data.annotated_image,
          prefix: 'annotated-issues'
        });
        annotatedImageUrl = uploadResult.url;
        console.log(`[Analysis] Annotated image uploaded: ${annotatedImageUrl}`);
      } else {
        console.warn(`[Analysis] Annotation service failed or no image returned:`, annotationResponse.data);
      }
    }
  } catch (annotationError) {
    console.error('[Analysis] Failed to generate annotated image:', annotationError);
    // don't fail the whole analysis if annotation fails
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
        annotatedImageUrl: annotatedImageUrl
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
  daysElapsed: number
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

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze progress in these current images (${availableImages.join(', ')}) compared to initial analysis and return your response in JSON.`
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
      }
    }
  } catch (annotationError) {
    console.error('Failed to generate annotated image in analyzeProgress:', annotationError);
  }

  return { ...parsed, annotatedImageUrl };
}

export async function analyzeWithLandmarks(frontImageUrl: string, landmarks: object, leftImageUrl?: string, rightImageUrl?: string) {
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

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze these face images (${availableImages.join(', ')}) with facial landmarks for comprehensive skin analysis.`
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

  // generation of annotated image
  let annotatedImageUrl: string | null = null;
  try {
    if (parsed.issues && parsed.issues.length > 0) {
      const frontImagePresigned = await maybePresignUrl(frontImageUrl, 300);

      const microserviceUrl = process.env.LANDMARK_URL || process.env.FACIAL_LANDMARKS_API_URL || 'http://localhost:8000';

      const annotationResponse = await axios.post(`${microserviceUrl}/api/v1/annotate-issues-from-url`, {
        image_url: frontImagePresigned,
        issues: parsed.issues
      });

      if (annotationResponse.data.status === 'success' && annotationResponse.data.annotated_image) {
        const uploadResult = await uploadImageToS3({
          imageBase64: annotationResponse.data.annotated_image,
          prefix: 'annotated-issues'
        });
        annotatedImageUrl = uploadResult.url;
      }
    }
  } catch (annotationError) {
    console.error('Failed to generate annotated image:', annotationError);
  }


  return { ...parsed, annotatedImageUrl };
}

// Export these for the optimized functions
export { buildPrompt, buildProgressPrompt, openai, OPENAI_MODEL };

import { prisma } from '../lib/prisma';
import OpenAI from 'openai';
import { maybePresignUrl } from '../lib/s3';
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
    'Example output (clearly highlight the issues visible in the images):\n' +
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
    '  "weekly_plan": [\n' +
    '    {"week": 1, "preview": "Start gentle cleansing routine with salicylic acid", "improvement_expected": "15%"},\n' +
    '    {"week": 2, "preview": "Add eye cream for dark circles and maintain cleansing", "improvement_expected": "30%"},\n' +
    '    {"week": 3, "preview": "Introduce retinol treatment and sun protection", "improvement_expected": "50%"},\n' +
    '    {"week": 4, "preview": "Maintain routine and assess overall progress", "improvement_expected": "70%"}\n' +
    '  ],\n' +
    '  "images_analyzed": ["front", "left", "right"]\n' +
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
    throw new Error('Landmarks record not found');
  }

  const faceImages = await getUserFaceImages(record.answer?.userId, record.answer?.sessionId);
  
  if (!faceImages.front && !faceImages.left && !faceImages.right) {
    throw new Error('No face images found for analysis');
  }

  const analysisTypeInfo = await determineAnalysisType(record.answer?.userId, record.answer?.sessionId);
  const landmarks = record.landmarks as unknown as object;
  const prompt = buildPrompt();

  const imageContent: any[] = [];
  const availableImages: string[] = [];

  if (faceImages.front) {
    const presignedUrl = await maybePresignUrl(faceImages.front, 300);
    imageContent.push({ type: 'image_url', image_url: { url: presignedUrl } });
    availableImages.push('front');
  }
  if (faceImages.left) {
    const presignedUrl = await maybePresignUrl(faceImages.left, 300);
    imageContent.push({ type: 'image_url', image_url: { url: presignedUrl } });
    availableImages.push('left');
  }
  if (faceImages.right) {
    const presignedUrl = await maybePresignUrl(faceImages.right, 300);
    imageContent.push({ type: 'image_url', image_url: { url: presignedUrl } });
    availableImages.push('right');
  }

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          { 
            type: 'text', 
            text: `Here are the face images (${availableImages.join(', ')}) and the facial landmarks JSON from the front image. Please analyze all visible skin issues across all provided images and provide a comprehensive analysis with score and 4-week plan.` 
          },
          ...imageContent,
          { type: 'text', text: `Facial landmarks from front image: ${JSON.stringify(landmarks)}` }
        ]
      }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content ?? '';

  let parsed: EnhancedAnalysisResult;
  try {
    parsed = JSON.parse(content) as EnhancedAnalysisResult;
  } catch {
    parsed = { raw: content } as any;
  }

  try {
    await prisma.facialLandmarks.update({
      where: { answerId },
      data: { 
        analysis: parsed as any,
        score: parsed.score || null,
        weeklyPlan: parsed.weekly_plan || null,
        analysisType: analysisTypeInfo.type,
        planStartDate: analysisTypeInfo.planStartDate,
        planEndDate: analysisTypeInfo.planEndDate
      }
    });
  } catch (e) {
    console.error('Failed to persist analysis JSON:', e);
  }

  return parsed;
}

export async function analyzeWithLandmarks(frontImageUrl: string, landmarks: object, leftImageUrl?: string, rightImageUrl?: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const prompt = buildPrompt();
  
  const imageContent: any[] = [];
  const availableImages: string[] = [];

  const frontPresignedUrl = await maybePresignUrl(frontImageUrl, 300);
  imageContent.push({ type: 'image_url', image_url: { url: frontPresignedUrl } });
  availableImages.push('front');

  if (leftImageUrl) {
    const leftPresignedUrl = await maybePresignUrl(leftImageUrl, 300);
    imageContent.push({ type: 'image_url', image_url: { url: leftPresignedUrl } });
    availableImages.push('left');
  }

  if (rightImageUrl) {
    const rightPresignedUrl = await maybePresignUrl(rightImageUrl, 300);
    imageContent.push({ type: 'image_url', image_url: { url: rightPresignedUrl } });
    availableImages.push('right');
  }

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          { 
            type: 'text', 
            text: `Here are the face images (${availableImages.join(', ')}) and the facial landmarks JSON from the front image. Please analyze all visible skin issues and provide a comprehensive analysis with score and 4-week plan.` 
          },
          ...imageContent,
          { type: 'text', text: `Facial landmarks: ${JSON.stringify(landmarks)}` }
        ]
      }
    ],
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content ?? '';

  try {
    return JSON.parse(content) as EnhancedAnalysisResult;
  } catch {
    return { raw: content } as any;
  }
}

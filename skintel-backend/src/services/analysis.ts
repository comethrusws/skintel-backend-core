import { prisma } from '../lib/prisma';
import OpenAI from 'openai';
import { maybePresignUrl } from '../lib/s3';
import { EnhancedAnalysisResult } from '../types';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const IMAGE_RESIZE_SERVICE_URL = process.env.LANDMARK_URL || 'http://localhost:8000';
const MAX_IMAGE_DIMENSION = 768;

function getImageUrl(imageId: string): string {
  // temp implementation until S3  is wired
  if (imageId.startsWith('http://') || imageId.startsWith('https://')) return imageId;
  return `http://localhost:3000/images/${imageId}`;
}

function buildPrompt(): string {
  return (
    'You are a dermatologist assistant AI.\n' +
    'You will receive 1-3 face images (front, left profile, right profile).\n' +
    'Your task:\n' +
    '1. Analyze skin across all provided images\n' +
    '2. Identify skin issues and provide approximate facial landmark coordinates for each issue\n' +
    '3. Clearly mention the affected regions (e.g., "mild acne on the right cheek", "dark spots on left temple")\n' +
    '4. Give severity-based explanations (mild = easy care, severe = consider dermatologist)\n' +
    '5. Use information from all angles to provide comprehensive analysis\n' +
    '6. Provide an overall skin health score out of 100\n' +
    '7. Create a 4-week improvement plan with weekly previews and expected improvement percentages\n' +
    '8. For each issue, provide dlib 68-point facial landmark coordinates that outline the affected area\n' +
    '\n' +
    'Example output (clearly highlight the issues visible in the images):\n' +
    '{\n' +
    '  "issues": [\n' +
    '    {\n' +
    '      "type": "dark_circles",\n' +
    '      "region": "under_eye_left",\n' +
    '      "severity": "moderate",\n' +
    '      "visible_in": ["front"],\n' +
    '      "explanation": "Visible dark circles under left eye indicating fatigue or genetics",\n' +
    '      "recommendations": ["Use eye cream with caffeine", "Ensure adequate sleep"],\n' +
    '      "dlib_68_facial_landmarks": [\n' +
    '        {"x": 30, "y": 40},\n' +
    '        {"x": 32, "y": 42},\n' +
    '        {"x": 35, "y": 45}\n' +
    '      ]\n' +
    '    }\n' +
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

async function annotateImageWithIssues(imageUrl: string, issues: any[]): Promise<string | null> {
  if (!issues || issues.length === 0) {
    return null;
  }

  const LANDMARK_SERVICE_URL = process.env.LANDMARK_URL || 'http://localhost:8000';
  const ANNOTATION_ENDPOINT = '/api/v1/annotate-issues-from-url';
  
  try {
    const response = await fetch(`${LANDMARK_SERVICE_URL}${ANNOTATION_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: imageUrl,
        issues: issues
      })
    });

    if (!response.ok) {
      console.error('Annotation service error:', response.status, await response.text());
      return null;
    }

    const result = await response.json();
    return result.annotated_image;
  } catch (error) {
    console.error('Error calling annotation service:', error);
    return null;
  }
}

async function resizeImageForAnalysis(imageUrl: string): Promise<string> {
  try {
    const response = await fetch(`${IMAGE_RESIZE_SERVICE_URL}/api/v1/resize-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: imageUrl,
        max_dimension: MAX_IMAGE_DIMENSION,
        quality: 85
      })
    });

    if (!response.ok) {
      console.warn('Image resize failed, using original:', response.status);
      return imageUrl;
    }

    const result = await response.json();
    return result.resized_image_url || imageUrl;
  } catch (error) {
    console.warn('Image resize error, using original:', error);
    return imageUrl;
  }
}

export async function analyzeSkin(answerId: string) {
  console.log(`[analyzeSkin] Starting analysis for answerId: ${answerId}`);
  
  if (!process.env.OPENAI_API_KEY) {
    console.error('[analyzeSkin] OPENAI_API_KEY is not set');
    throw new Error('OPENAI_API_KEY is not set');
  }

  console.log('[analyzeSkin] Fetching answer record from database');
  const answer = await prisma.onboardingAnswer.findUnique({
    where: { answerId },
    select: { userId: true, sessionId: true }
  });

  if (!answer) {
    console.error(`[analyzeSkin] No answer record found for answerId: ${answerId}`);
    throw new Error('Answer record not found');
  }

  console.log(`[analyzeSkin] Found answer record for userId: ${answer.userId}, sessionId: ${answer.sessionId}`);

  console.log('[analyzeSkin] Fetching face images');
  const faceImages = await getUserFaceImages(answer.userId, answer.sessionId);
  
  console.log(`[analyzeSkin] Face images found: ${JSON.stringify(Object.keys(faceImages))}`);
  
  if (!faceImages.front && !faceImages.left && !faceImages.right) {
    console.error('[analyzeSkin] No face images found for analysis');
    throw new Error('No face images found for analysis');
  }

  console.log('[analyzeSkin] Determining analysis type');
  let analysisTypeInfo;
  try {
    analysisTypeInfo = await determineAnalysisType(answer.userId, answer.sessionId);
    console.log(`[analyzeSkin] Analysis type determined: ${analysisTypeInfo.type}, planStartDate: ${analysisTypeInfo.planStartDate}, planEndDate: ${analysisTypeInfo.planEndDate}`);
  } catch (error) {
    console.error('[analyzeSkin] Error determining analysis type:', error);
    throw error;
  }

  const prompt = buildPrompt();
  console.log(`[analyzeSkin] Built prompt, length: ${prompt.length} characters`);

  console.log('[analyzeSkin] Preparing image content for OpenAI');
  const imageContent: any[] = [];
  const availableImages: string[] = [];

  try {
    if (faceImages.front) {
      console.log(`[analyzeSkin] Processing front image: ${faceImages.front}`);
      const presignedUrl = await maybePresignUrl(faceImages.front, 300);
      const resizedUrl = await resizeImageForAnalysis(presignedUrl);
      imageContent.push({ type: 'image_url', image_url: { url: resizedUrl, detail: 'high' } });
      availableImages.push('front');
      console.log('[analyzeSkin] Front image processed and resized');
    }
    
    if (faceImages.left) {
      console.log(`[analyzeSkin] Processing left image: ${faceImages.left}`);
      const presignedUrl = await maybePresignUrl(faceImages.left, 300);
      const resizedUrl = await resizeImageForAnalysis(presignedUrl);
      imageContent.push({ type: 'image_url', image_url: { url: resizedUrl, detail: 'high' } });
      availableImages.push('left');
      console.log('[analyzeSkin] Left image processed and resized');
    }
    
    if (faceImages.right) {
      console.log(`[analyzeSkin] Processing right image: ${faceImages.right}`);
      const presignedUrl = await maybePresignUrl(faceImages.right, 300);
      const resizedUrl = await resizeImageForAnalysis(presignedUrl);
      imageContent.push({ type: 'image_url', image_url: { url: resizedUrl, detail: 'high' } });
      availableImages.push('right');
      console.log('[analyzeSkin] Right image processed and resized');
    }
  } catch (error) {
    console.error('[analyzeSkin] Error processing images:', error);
    throw error;
  }

  console.log(`[analyzeSkin] Prepared ${imageContent.length} images for OpenAI: ${availableImages.join(', ')}`);

  console.log(`[analyzeSkin] Calling OpenAI API with model: ${OPENAI_MODEL}`);
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
              text: `Here are the face images (${availableImages.join(', ')}). Please analyze all visible skin issues across all provided images and provide a comprehensive analysis with score and 4-week plan. For each issue, provide approximate facial landmark coordinates that outline the affected area. Return your response as valid JSON.` 
            },
            ...imageContent
          ]
        }
      ],
      response_format: { type: 'json_object' }
    });
    console.log('[analyzeSkin] OpenAI API call completed successfully');
  } catch (error: any) {
    if (error?.code === 'context_length_exceeded') {
      console.error('[analyzeSkin] Token limit exceeded, trying with front image only');
      try {
        // fallback to ensure that we analyze with atleast front image
        const frontOnlyContent = imageContent.slice(0, 1);
        completion = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          messages: [
            { role: 'system', content: prompt },
            {
              role: 'user',
              content: [
                { 
                  type: 'text', 
                  text: `Here is the front face image. Please analyze visible skin issues and provide a comprehensive analysis with score and 4-week plan. For each issue, provide approximate facial landmark coordinates that outline the affected area. Return your response as valid JSON.` 
                },
                ...frontOnlyContent
              ]
            }
          ],
          response_format: { type: 'json_object' }
        });
        availableImages.length = 1; 
        console.log('[analyzeSkin] Fallback analysis with front image only completed');
      } catch (fallbackError) {
        console.error('[analyzeSkin] Fallback analysis also failed:', fallbackError);
        throw fallbackError;
      }
    } else {
      console.error('[analyzeSkin] OpenAI API call failed:', error);
      throw error;
    }
  }

  const content = completion.choices?.[0]?.message?.content ?? '';
  console.log(`[analyzeSkin] OpenAI response received, content length: ${content.length} characters`);

  console.log('[analyzeSkin] Parsing OpenAI response');
  let parsed: EnhancedAnalysisResult;
  try {
    parsed = JSON.parse(content) as EnhancedAnalysisResult;
    console.log(`[analyzeSkin] Successfully parsed OpenAI response. Score: ${parsed.score}, Issues count: ${parsed.issues?.length || 0}, Weekly plan items: ${parsed.weekly_plan?.length || 0}`);
  } catch (parseError) {
    console.error('[analyzeSkin] Failed to parse OpenAI response as JSON:', parseError);
    console.error('[analyzeSkin] Raw content that failed to parse:', content);
    parsed = { raw: content } as any;
  }

  let annotatedImageUrl: string | null = null;
  if (parsed.issues && parsed.issues.length > 0 && faceImages.front) {
    console.log('[analyzeSkin] Generating annotated image');
    try {
      annotatedImageUrl = await annotateImageWithIssues(faceImages.front, parsed.issues);
      console.log(`[analyzeSkin] Annotated image generated: ${annotatedImageUrl ? 'success' : 'failed'}`);
    } catch (annotationError) {
      console.error('[analyzeSkin] Failed to generate annotated image:', annotationError);
    }
  }

  console.log('[analyzeSkin] Updating database with analysis results');
  try {
    await prisma.facialLandmarks.create({
      data: {
        answerId,
        userId: answer.userId,
        landmarks: {} as any, // empty landmarks since we're doing analysis first
        analysis: { ...parsed, annotated_image_url: annotatedImageUrl } as any,
        score: parsed.score || null,
        weeklyPlan: parsed.weekly_plan as any,
        analysisType: analysisTypeInfo.type,
        planStartDate: analysisTypeInfo.planStartDate,
        planEndDate: analysisTypeInfo.planEndDate,
        status: 'COMPLETED',
        processedAt: new Date()
      }
    });
    console.log(`[analyzeSkin] Successfully created facial landmarks record for answerId: ${answerId}`);
  } catch (dbError) {
    console.error('[analyzeSkin] Failed to create database record:', dbError);
    throw dbError;
  }

  console.log(`[analyzeSkin] Analysis completed successfully for answerId: ${answerId}`);
  return { ...parsed, annotated_image_url: annotatedImageUrl };
}

export async function analyzeWithLandmarks(frontImageUrl: string, landmarks: object, leftImageUrl?: string, rightImageUrl?: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const prompt = buildPrompt();
  
  const imageContent: any[] = [];
  const availableImages: string[] = [];

  const frontPresignedUrl = await maybePresignUrl(frontImageUrl, 300);
  const frontResizedUrl = await resizeImageForAnalysis(frontPresignedUrl);
  imageContent.push({ type: 'image_url', image_url: { url: frontResizedUrl, detail: 'high' } });
  availableImages.push('front');

  if (leftImageUrl) {
    const leftPresignedUrl = await maybePresignUrl(leftImageUrl, 300);
    const leftResizedUrl = await resizeImageForAnalysis(leftPresignedUrl);
    imageContent.push({ type: 'image_url', image_url: { url: leftResizedUrl, detail: 'high' } });
    availableImages.push('left');
  }

  if (rightImageUrl) {
    const rightPresignedUrl = await maybePresignUrl(rightImageUrl, 300);
    const rightResizedUrl = await resizeImageForAnalysis(rightPresignedUrl);
    imageContent.push({ type: 'image_url', image_url: { url: rightResizedUrl, detail: 'high' } });
    availableImages.push('right');
  }

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: `Here are the face images (${availableImages.join(', ')}). Please analyze all visible skin issues and provide a comprehensive analysis with score and 4-week plan. Provide approximate facial landmark coordinates for each issue.` 
            },
            ...imageContent
          ]
        }
      ],
      response_format: { type: 'json_object' }
    });

    const content = completion.choices?.[0]?.message?.content ?? '';

    let parsed: any;
    try {
      parsed = JSON.parse(content) as EnhancedAnalysisResult;
    } catch {
      parsed = { raw: content } as any;
    }

    // generate annotated image if we have issues
    let annotatedImageUrl: string | null = null;
    if (parsed.issues && parsed.issues.length > 0) {
      try {
        annotatedImageUrl = await annotateImageWithIssues(frontImageUrl, parsed.issues);
      } catch (error) {
        console.error('Failed to generate annotated image:', error);
      }
    }

    return { ...parsed, annotated_image_url: annotatedImageUrl };
  } catch (error: any) {
    if (error?.code === 'context_length_exceeded') {
      console.error('Token limit exceeded in analyzeWithLandmarks, trying front only');
      // fallback with front image only
      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: [
              { 
                type: 'text', 
                text: `Here is the front face image. Please analyze visible skin issues and provide a comprehensive analysis with score and 4-week plan. Provide approximate facial landmark coordinates for each issue. Return your response as valid JSON.` 
              },
              imageContent[0] // only front image
            ]
          }
        ],
        response_format: { type: 'json_object' }
      });

      const content = completion.choices?.[0]?.message?.content ?? '';
      let parsed: any;
      try {
        parsed = JSON.parse(content) as EnhancedAnalysisResult;
      } catch {
        parsed = { raw: content } as any;
      }

      let annotatedImageUrl: string | null = null;
      if (parsed.issues && parsed.issues.length > 0) {
        try {
          annotatedImageUrl = await annotateImageWithIssues(frontImageUrl, parsed.issues);
        } catch (error) {
          console.error('Failed to generate annotated image:', error);
        }
      }

      return { ...parsed, annotated_image_url: annotatedImageUrl };
    }
    throw error;
  }
}

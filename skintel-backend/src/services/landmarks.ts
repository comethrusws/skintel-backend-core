import { LandmarkResponse, LandmarkProcessingResult } from '../types';
import { maybePresignUrl } from '../lib/s3';
import { analyzeSkin, analyzeWithLandmarks } from './analysis';
import { generateTasksForUser } from './tasks';

const LANDMARK_SERVICE_URL = process.env.LANDMARK_URL || 'http://localhost:8000';
const LANDMARK_ENDPOINT = '/api/v1/landmarks';
const REQUEST_TIMEOUT = 30000;

/**
 * convert image_id to accessible URL (temp)
 * todo; implementing acc logic with s3 storage
 */
function getImageUrl(imageId: string): string {
  // allow passing full URLs directly for testing/microservice
  if (imageId.startsWith('http://') || imageId.startsWith('https://')) {
    return imageId;
  }
  return `http://localhost:3000/images/${imageId}`;
}

/**
 * facial landmarks for an img
 * Note: Landmarks should only be processed for front-facing images
 * as this is the standard pose for accurate facial landmark detection
 */
export async function processLandmarks(imageId: string): Promise<LandmarkProcessingResult> {
  try {
    const imageUrl = getImageUrl(imageId);
    const presignedUrl = await maybePresignUrl(imageUrl, 300);
    const url = `${LANDMARK_SERVICE_URL}${LANDMARK_ENDPOINT}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: presignedUrl
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Landmark service returned ${response.status}: ${errorText}`);
    }

    const data: LandmarkResponse = await response.json();

    if (data.status !== 'success') {
      throw new Error(`Landmark processing failed: ${data.error || 'Unknown error'}`);
    }

    return {
      success: true,
      data
    };

  } catch (error) {
    console.error('Landmark processing error:', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * process landmarks asynchronously for front face images only, skip other profile
 */
export async function processLandmarksAsync(answerId: string, imageId: string): Promise<void> {
  const { prisma } = await import('../lib/prisma');

  let answer: { userId: string | null; sessionId: string | null } | null = null;

  try {
    answer = await prisma.onboardingAnswer.findUnique({
      where: { answerId },
      select: { userId: true, sessionId: true }
    });

    if (!answer) {
      console.error(`Answer not found for landmark processing: ${answerId}`);
      return;
    }

    // insert initial processing record
    await prisma.facialLandmarks.create({
      data: {
        answerId,
        userId: answer.userId, // set userId if the answer belongs to a user
        landmarks: {} as any,
        status: 'PROCESSING'
      }
    });

    const result = await processLandmarks(imageId);

    if (result.success && result.data) {
      await prisma.facialLandmarks.update({
        where: { answerId },
        data: {
          landmarks: result.data as unknown as any,
          status: 'PROCESSING',
          processedAt: new Date()
        }
      });

      try {
        const analysis = await analyzeSkin(answerId);

        await prisma.facialLandmarks.update({
          where: { answerId },
          data: {
            status: 'COMPLETED',
            analysis: analysis as any,
            score: analysis.score || null,
            weeklyPlan: analysis.care_plan_4_weeks as any,
            analysisType: 'INITIAL', // def value as onboarding analysis is always apne liye initial
            planStartDate: new Date(),
            planEndDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000) // basically a 4 week end date rom current
          }
        });

        try {
          const userProducts = await prisma.product.findMany({
            where: { userId: answer.userId || undefined },
            select: {
              id: true,
              productData: true
            }
          });

          const formattedProducts = userProducts.map(p => {
            const data = p.productData as any;
            return {
              id: p.id,
              name: data?.product_name || 'Unknown Product',
              category: data?.category || 'unknown',
              ingredients: data?.ingredients || []
            };
          });

          if (analysis.care_plan_4_weeks && answer.userId) {
            await generateTasksForUser({
              userId: answer.userId,
              weeklyPlan: analysis.care_plan_4_weeks,
              userProducts: formattedProducts
            });
            console.log(`Auto-generated tasks for user ${answer.userId}`);
          }
        } catch (taskError) {
          console.error('Failed to auto-generate tasks:', taskError);
        }
      } catch (analysisError) {
        console.error('Skin analysis failed:', analysisError);
        await prisma.facialLandmarks.update({
          where: { answerId },
          data: {
            status: 'FAILED',
            error: `Analysis failed: ${analysisError instanceof Error ? analysisError.message : 'Unknown error'}`
          }
        });
      }

      // reconcile user link in case merge happened after we created the record
      try {
        const latest = await prisma.onboardingAnswer.findUnique({ where: { answerId }, select: { userId: true } });
        if (latest?.userId) {
          await prisma.facialLandmarks.update({ where: { answerId }, data: { userId: latest.userId } });
        }
      } catch (linkErr) {
        console.warn('Failed to reconcile facialLandmarks.userId post-processing', { answerId });
      }
    } else {
      await prisma.facialLandmarks.update({
        where: { answerId },
        data: {
          status: 'FAILED',
          error: result.error,
          processedAt: new Date()
        }
      });

      console.error(`landmark processing failed for answer: ${answerId}, error: ${result.error}`);
    }

  } catch (error) {
    console.error('Error in async landmark processing:', error);

    try {
      await prisma.facialLandmarks.upsert({
        where: { answerId },
        create: {
          answerId,
          userId: answer?.userId || null,
          landmarks: {} as any,
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'db error',
          processedAt: new Date()
        },
        update: {
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'db error',
          processedAt: new Date()
        }
      });
    } catch (dbError) {
      console.error('Failed to update landmark processing status:', dbError);
    }
  }
}

/**
 * process landmarks for a direct image URL (front face only)
 * and persist analysis for an answer
 */
export async function processLandmarksForAnswerWithUrl(answerId: string, imageUrl: string): Promise<void> {
  const { prisma } = await import('../lib/prisma');

  let answer: { userId: string | null; sessionId: string | null } | null = null;

  try {
    answer = await prisma.onboardingAnswer.findUnique({
      where: { answerId },
      select: { userId: true, sessionId: true }
    });

    if (!answer) {
      console.error(`Answer not found for landmark processing: ${answerId}`);
      return;
    }

    await prisma.facialLandmarks.create({
      data: {
        answerId,
        userId: answer.userId,
        landmarks: {} as any,
        status: 'PROCESSING'
      }
    });

    // presifgned landmark image url
    const presignedUrl = await maybePresignUrl(imageUrl, 300);
    const url = `${LANDMARK_SERVICE_URL}${LANDMARK_ENDPOINT}`;

    console.log(`[Landmarks] Processing landmarks for image URL: ${imageUrl} (presigned) at ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: presignedUrl
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Landmark service returned ${response.status}: ${errorText}`);
    }

    const result: LandmarkResponse = await response.json();

    if (result.status !== 'success') {
      console.error(`[Landmarks] Service returned error status: ${result.error}`);
      throw new Error(`Landmark processing failed: ${result.error || 'Unknown error'}`);
    }

    console.log(`[Landmarks] Service success. Updating DB...`);

    await prisma.facialLandmarks.update({
      where: { answerId },
      data: {
        landmarks: result as unknown as any,
        status: 'PROCESSING',
        processedAt: new Date()
      }
    });

    try {
      console.log(`[Landmarks] Starting skin analysis...`);
      const analysisResult = await analyzeWithLandmarks(imageUrl, result, answerId);
      console.log(`[Landmarks] Skin analysis completed. Annotated image: ${!!(analysisResult as any).annotatedImageUrl}`);
      const { annotatedImageUrl, ...analysis } = analysisResult as any;

      await prisma.facialLandmarks.update({
        where: { answerId },
        data: {
          status: 'COMPLETED',
          analysis: analysis as any,
          score: analysis.score || null,
          weeklyPlan: analysis.care_plan_4_weeks as any,
          analysisType: 'INITIAL',
          planStartDate: new Date(),
          planEndDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
          annotatedImageUrl: annotatedImageUrl
        }
      });

      try {
        const userProducts = await prisma.product.findMany({
          where: { userId: answer.userId || undefined },
          select: {
            id: true,
            productData: true
          }
        });

        const formattedProducts = userProducts.map(p => {
          const data = p.productData as any;
          return {
            id: p.id,
            name: data?.product_name || 'Unknown Product',
            category: data?.category || 'unknown',
            ingredients: data?.ingredients || []
          };
        });

        if (analysis.care_plan_4_weeks && answer.userId) {
          await generateTasksForUser({
            userId: answer.userId,
            weeklyPlan: analysis.care_plan_4_weeks,
            userProducts: formattedProducts
          });
          console.log(`Auto-generated tasks for user ${answer.userId}`);
        }
      } catch (taskError) {
        console.error('Failed to auto-generate tasks:', taskError);
      }
    } catch (analysisError) {
      console.error('Skin analysis failed:', analysisError);
      await prisma.facialLandmarks.update({
        where: { answerId },
        data: {
          status: 'FAILED',
          error: `Analysis failed: ${analysisError instanceof Error ? analysisError.message : 'Unknown error'}`
        }
      });
    }

    try {
      const latest = await prisma.onboardingAnswer.findUnique({ where: { answerId }, select: { userId: true } });
      if (latest?.userId) {
        await prisma.facialLandmarks.update({ where: { answerId }, data: { userId: latest.userId } });
      }
    } catch (linkErr) {
      console.warn('Failed to reconcile facialLandmarks.userId post-processing (url)', { answerId });
    }
  } catch (error) {
    console.error('Error in url-based landmark processing:', error);
    try {
      await prisma.facialLandmarks.upsert({
        where: { answerId },
        create: {
          answerId,
          userId: answer?.userId || null,
          landmarks: {} as any,
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'db error',
          processedAt: new Date()
        },
        update: {
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'db error',
          processedAt: new Date()
        }
      });
    } catch (dbError) {
      console.error('Failed to update landmark processing status:', dbError);
    }
  }
}

/**
 * fetch user's all facial landmarks
 */
export async function getUserLandmarks(userId: string) {
  const { prisma } = await import('../lib/prisma');

  return await prisma.facialLandmarks.findMany({
    where: {
      userId,
      status: 'COMPLETED'
    },
    include: {
      answer: {
        select: {
          questionId: true,
          screenId: true,
          savedAt: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

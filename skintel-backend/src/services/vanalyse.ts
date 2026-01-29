import { prisma } from '../lib/prisma';
import { processLandmarks } from './landmarks';
import { maybePresignUrl, uploadImageToS3 } from '../lib/s3';
import { generateTasksForUser } from './tasks';
import { buildPrompt, buildProgressPrompt, openai, OPENAI_MODEL, getUserOnboardingProfile, formatProfileContext } from './analysis';
import axios from 'axios';

export class VanalyseService {
    static async analyzeProgress(userId: string, data: { front_image_url: string; left_image_url?: string; right_image_url?: string }) {
        const { front_image_url, left_image_url, right_image_url } = data;

        const [activePlan, presignedUrls, landmarkResult] = await Promise.all([
            prisma.facialLandmarks.findFirst({
                where: {
                    userId,
                    planStartDate: { not: null },
                    planEndDate: { gt: new Date() }
                },
                orderBy: { createdAt: 'desc' }
            }),

            Promise.all([
                maybePresignUrl(front_image_url, 300),
                left_image_url ? maybePresignUrl(left_image_url, 300) : Promise.resolve(null),
                right_image_url ? maybePresignUrl(right_image_url, 300) : Promise.resolve(null)
            ]).then(([front, left, right]) => ({ front, left, right })),

            processLandmarks(front_image_url)
        ]);

        if (!activePlan) {
            throw { status: 400, message: 'No active improvement plan found. Complete initial analysis first.' };
        }

        if (!landmarkResult.success || !landmarkResult.data) {
            throw { status: 500, message: landmarkResult.error || 'Landmark processing failed' };
        }

        const initialAnalysis = await prisma.facialLandmarks.findFirst({
            where: {
                userId,
                analysisType: 'INITIAL',
                planStartDate: activePlan.planStartDate,
                planEndDate: activePlan.planEndDate,
                status: 'COMPLETED'
            },
            orderBy: { createdAt: 'asc' }
        });

        if (!initialAnalysis || !initialAnalysis.analysis || !initialAnalysis.weeklyPlan) {
            throw { status: 400, message: 'Initial analysis data not found. Cannot compare progress.' };
        }

        const initialAnalysisData = typeof initialAnalysis.analysis === 'string'
            ? JSON.parse(initialAnalysis.analysis)
            : initialAnalysis.analysis;

        const initialWeeklyPlan = typeof initialAnalysis.weeklyPlan === 'string'
            ? JSON.parse(initialAnalysis.weeklyPlan)
            : initialAnalysis.weeklyPlan;

        const daysElapsed = Math.floor(
            (new Date().getTime() - initialAnalysis.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        );

        const answerId = `progress_${Date.now()}_${userId.slice(-6)}`;

        await prisma.$transaction([
            prisma.onboardingAnswer.create({
                data: {
                    answerId,
                    userId,
                    sessionId: null,
                    screenId: 'progress_analysis',
                    questionId: 'q_face_photo_front',
                    type: 'image',
                    value: { image_url: front_image_url },
                    status: 'answered'
                }
            }),
            prisma.facialLandmarks.create({
                data: {
                    answerId,
                    userId,
                    landmarks: landmarkResult.data as unknown as any,
                    analysis: {},
                    status: 'PROCESSING',
                    processedAt: new Date(),
                    analysisType: 'PROGRESS',
                    planStartDate: activePlan.planStartDate,
                    planEndDate: activePlan.planEndDate,
                    weeklyPlan: {},
                }
            })
        ]);

        const user = await prisma.user.findUnique({
            where: { userId },
            select: { planType: true }
        });

        const [currentAnalysis, progressUpdate] = await Promise.all([
            this.analyzeWithLandmarksOptimized(
                presignedUrls.front,
                landmarkResult.data,
                presignedUrls.left,
                presignedUrls.right,
                userId
            ),

            this.analyzeProgressOptimized(
                presignedUrls,
                landmarkResult.data,
                initialAnalysisData,
                initialAnalysis.score || 0,
                initialWeeklyPlan,
                daysElapsed,
                userId,
                answerId,
                user?.planType || 'MONTHLY'
            )
        ]);

        if (progressUpdate && typeof progressUpdate === 'object' && 'score_change' in progressUpdate) {
            const currentScore = currentAnalysis.score || 0;
            const initialScore = initialAnalysis.score || 0;
            progressUpdate.score_change = currentScore - initialScore;
            progressUpdate.overall_progress_score = currentScore;
        }

        await prisma.facialLandmarks.update({
            where: { answerId },
            data: {
                analysis: currentAnalysis,
                progressUpdate: progressUpdate ?? null,
                status: 'COMPLETED',
                score: currentAnalysis.score || null,
                weeklyPlan: currentAnalysis.care_plan_4_weeks as any,
            }
        });

        try {
            const userProducts = await prisma.product.findMany({
                where: { userId },
                select: {
                    id: true,
                    productData: true
                }
            });

            const formattedProducts = userProducts.map(p => {
                const data = p.productData as any;
                return {
                    id: p.id,
                    category: data?.category || 'unknown',
                    name: data?.product_name || 'Unknown Product',
                    ingredients: data?.ingredients
                };
            });

            const newPlan = currentAnalysis.care_plan_4_weeks || [];
            const oldPlan = initialWeeklyPlan || [];

            const planChangedSignificantly = this.hasSignificantPlanChange(oldPlan, newPlan);

            if (planChangedSignificantly) {
                console.log(`Plan changed significantly for user ${userId}, regenerating tasks`);
                await generateTasksForUser({
                    userId,
                    weeklyPlan: newPlan,
                    userProducts: formattedProducts,
                    force: true
                });
            } else {
                console.log(`Plan unchanged for user ${userId}, skipping task regeneration`);
            }

        } catch (taskError) {
            console.error('Failed to check/regenerate tasks after progress analysis:', taskError);
        }

        const imagesAnalyzed = ['front'];
        if (left_image_url) imagesAnalyzed.push('left');
        if (right_image_url) imagesAnalyzed.push('right');

        const estimatedImprovementScore = initialAnalysisData?.estimated_improvement_score || null;
        const estimatedWeeklyScores = initialAnalysisData?.estimated_weekly_scores || null;
        const updatedWeeklyScores = currentAnalysis?.updated_weekly_scores || null;

        // Get annotated image URL and SVG overlays from progress update
        const annotatedImageUrl = progressUpdate?.annotatedImageUrl || null;
        const svgOverlays = progressUpdate?.svgOverlays || [];
        
        // Get presigned URL for front profile image
        const frontProfileUrl = await maybePresignUrl(front_image_url, 86400);
        
        // Get presigned URL for annotated image if available
        let presignedAnnotatedImageUrl = null;
        if (annotatedImageUrl) {
            try {
                presignedAnnotatedImageUrl = await maybePresignUrl(annotatedImageUrl, 86400);
            } catch (err) {
                console.error('Failed to presign annotated image URL:', err);
            }
        }

        return {
            answer_id: answerId,
            current_analysis: currentAnalysis,
            progress_update: progressUpdate,
            landmarks: landmarkResult.data,
            images_analyzed: imagesAnalyzed,
            analysis_type: 'PROGRESS',
            days_elapsed: daysElapsed,
            plan_start_date: activePlan.planStartDate?.toISOString(),
            plan_end_date: activePlan.planEndDate?.toISOString(),
            initial_score: initialAnalysis.score,
            current_score: currentAnalysis.score,
            estimated_improvement_score: estimatedImprovementScore,
            estimated_weekly_scores: estimatedWeeklyScores,
            updated_weekly_scores: updatedWeeklyScores,
            initial_analysis: {
                issues: initialAnalysisData?.issues || [],
                overall_assessment: initialAnalysisData?.overall_assessment || null
            },
            annotated_image_url: presignedAnnotatedImageUrl,
            svg_overlays: svgOverlays,
            front_profile_url: frontProfileUrl
        };
    }

    private static async analyzeWithLandmarksOptimized(
        frontPresignedUrl: string,
        landmarks: object,
        leftPresignedUrl?: string | null,
        rightPresignedUrl?: string | null,
        userId?: string,
        sessionId?: string | null
    ) {
        const imageContent: any[] = [];
        const availableImages: string[] = [];

        imageContent.push({ type: 'image_url', image_url: { url: frontPresignedUrl } });
        availableImages.push('front');

        if (leftPresignedUrl) {
            imageContent.push({ type: 'image_url', image_url: { url: leftPresignedUrl } });
            availableImages.push('left');
        }

        if (rightPresignedUrl) {
            imageContent.push({ type: 'image_url', image_url: { url: rightPresignedUrl } });
            availableImages.push('right');
        }

        // Fetch user profile for personalized analysis
        const userProfile = await getUserOnboardingProfile(userId ?? null, sessionId ?? null);
        const profileContext = formatProfileContext(userProfile);

        const completion = await openai.chat.completions.create({
            model: OPENAI_MODEL,
            messages: [
                { role: 'system', content: buildPrompt() },
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

        try {
            return JSON.parse(content);
        } catch {
            return { raw: content };
        }
    }

    private static async analyzeProgressOptimized(
        presignedUrls: { front: string; left: string | null; right: string | null },
        currentLandmarks: object,
        initialAnalysis: any,
        initialScore: number,
        weeklyPlan: any[],
        daysElapsed: number,
        userId: string,
        answerId: string,
        planType: string
    ) {
        const imageContent: any[] = [];
        const availableImages: string[] = [];

        imageContent.push({ type: 'image_url', image_url: { url: presignedUrls.front } });
        availableImages.push('front');

        if (presignedUrls.left) {
            imageContent.push({ type: 'image_url', image_url: { url: presignedUrls.left } });
            availableImages.push('left');
        }

        if (presignedUrls.right) {
            imageContent.push({ type: 'image_url', image_url: { url: presignedUrls.right } });
            availableImages.push('right');
        }

        const weeksElapsed = Math.floor(daysElapsed / 7);
        const currentWeekPlan = weeklyPlan[Math.min(weeksElapsed, weeklyPlan.length - 1)];

        // Fetch user profile for personalized progress tracking
        const userProfile = await getUserOnboardingProfile(userId, null);
        const profileContext = formatProfileContext(userProfile);

        const completion = await openai.chat.completions.create({
            model: OPENAI_MODEL,
            messages: [
                { role: 'system', content: buildProgressPrompt() },
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
                                `Current week plan: ${JSON.stringify(currentWeekPlan)}\n` +
                                `User Plan Type: ${planType}`
                        }
                    ]
                }
            ],
            response_format: { type: 'json_object' }
        });

        const content = completion.choices?.[0]?.message?.content ?? '';
        let parsed: any;

        try {
            parsed = JSON.parse(content);
        } catch {
            parsed = { raw: content };
        }

        let annotatedImageUrl: string | null = null;
        let svgOverlays: any[] = [];

        if (parsed.current_issues && parsed.current_issues.length > 0 && presignedUrls.front) {
            try {
                const annotationResult = await this.generateAnnotatedImageBackground(
                    presignedUrls.front,
                    parsed.current_issues,
                    userId,
                    answerId
                );
                if (annotationResult) {
                    annotatedImageUrl = annotationResult.annotatedImageUrl;
                    svgOverlays = annotationResult.svgOverlays || [];
                    // Update issues with correct MediaPipe landmarks if provided
                    if (annotationResult.issues) {
                        parsed.current_issues = annotationResult.issues;
                    }
                }
            } catch (err) {
                console.error('Annotation failed:', err);
            }
        }

        return { ...parsed, annotatedImageUrl, svgOverlays };
    }

    private static async generateAnnotatedImageBackground(
        imageUrl: string,
        issues: any[],
        userId: string,
        answerId: string
    ): Promise<{ annotatedImageUrl: string | null; svgOverlays: any[]; issues?: any[] } | null> {
        try {
            const microserviceUrl = process.env.LANDMARK_URL || process.env.FACIAL_LANDMARKS_API_URL || 'http://localhost:8000';

            const annotationResponse = await axios.post(`${microserviceUrl}/api/v1/annotate-issues-from-url`, {
                image_url: imageUrl,
                issues: issues
            });

            if (annotationResponse.data.status === 'success' && annotationResponse.data.annotated_image) {
                const uploadResult = await uploadImageToS3({
                    imageBase64: annotationResponse.data.annotated_image,
                    prefix: 'annotated-issues-progress'
                });

                await prisma.facialLandmarks.update({
                    where: { answerId },
                    data: {
                        annotatedImageUrl: uploadResult.url
                    }
                });

                console.log(`[Background] Annotated image updated for answer ${answerId}`);

                return {
                    annotatedImageUrl: uploadResult.url,
                    svgOverlays: annotationResponse.data.svg_overlays || [],
                    issues: annotationResponse.data.issues
                };
            }
            return null;
        } catch (annotationError) {
            console.error('Failed to generate annotated image in background:', annotationError);
            return null;
        }
    }

    /**
     * Compare two weekly plans to determine if they've changed significantly.
     * Returns true if the plans are meaningfully different.
     */
    private static hasSignificantPlanChange(oldPlan: any[], newPlan: any[]): boolean {
        // If lengths are different, it's a significant change
        if (oldPlan.length !== newPlan.length) {
            return true;
        }

        // If either plan is empty, no significant change
        if (oldPlan.length === 0 || newPlan.length === 0) {
            return false;
        }

        // Compare week-by-week previews using simple text similarity
        let matchingWeeks = 0;
        for (let i = 0; i < oldPlan.length; i++) {
            const oldPreview = (oldPlan[i]?.preview || '').toLowerCase().trim();
            const newPreview = (newPlan[i]?.preview || '').toLowerCase().trim();

            // Calculate simple word overlap similarity
            const oldWords = new Set(oldPreview.split(/\s+/).filter((w: string) => w.length > 3));
            const newWords = new Set(newPreview.split(/\s+/).filter((w: string) => w.length > 3));

            if (oldWords.size === 0 && newWords.size === 0) {
                matchingWeeks++;
                continue;
            }

            let overlap = 0;
            oldWords.forEach(word => {
                if (newWords.has(word)) overlap++;
            });

            const similarity = overlap / Math.max(oldWords.size, newWords.size, 1);

            // 70% word overlap = similar enough
            if (similarity >= 0.7) {
                matchingWeeks++;
            }
        }

        // If less than 75% of weeks match, it's a significant change
        const matchRatio = matchingWeeks / oldPlan.length;
        return matchRatio < 0.75;
    }
}

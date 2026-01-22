import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { getTaskProgress } from './tasks';
import { maybePresignUrl, deleteFileFromUrl } from '../lib/s3';
import axios from 'axios';
import { PROFILE_QUESTIONS, PROFILE_SCREEN_ID, getProfileQuestion, validateProfileQuestionValue, mapOptionsWithLabels, formatOptionLabel } from '../lib/profileQuestions';
import { VALID_QUESTION_IDS, getExpectedType, getValidValues, formatLabel, getQuestionText } from '../utils/validation';

function formatAnalysisIssues(analysis: any): any {
    if (!analysis || typeof analysis !== 'object') return analysis;

    const formatted = { ...analysis };

    if (Array.isArray(formatted.issues)) {
        formatted.issues = formatted.issues.map((issue: any) => ({
            ...issue,
            type_label: formatOptionLabel(issue.type || ''),
            region_label: formatOptionLabel(issue.region || ''),
            severity_label: formatOptionLabel(issue.severity || '')
        }));
    }

    if (Array.isArray(formatted.remaining_issues)) {
        formatted.remaining_issues = formatted.remaining_issues.map((issue: any) => ({
            ...issue,
            type_label: formatOptionLabel(issue.type || ''),
            region_label: formatOptionLabel(issue.region || ''),
            severity_label: formatOptionLabel(issue.severity || '')
        }));
    }

    if (Array.isArray(formatted.issues_improved)) {
        formatted.issues_improved = formatted.issues_improved.map((issue: any) => ({
            ...issue,
            issue_type_label: formatOptionLabel(issue.issue_type || ''),
            initial_severity_label: formatOptionLabel(issue.initial_severity || ''),
            current_severity_label: formatOptionLabel(issue.current_severity || '')
        }));
    }

    return formatted;
}

export class ProfileService {
    static async getProfile(userId: string) {
        const user = await prisma.user.findUnique({
            where: { userId },
            select: {
                userId: true,
                name: true,
                phoneNumber: true,
                dateOfBirth: true,
                email: true,
                ssoProvider: true,
                planType: true,
                latitude: true,
                longitude: true,
                locationUpdatedAt: true,
                createdAt: true,
                updatedAt: true
            }
        });

        if (!user) {
            throw { status: 404, message: 'User not found' };
        }

        let profileImage: string | undefined;
        const frontFaceAnswer = await prisma.onboardingAnswer.findFirst({
            where: {
                userId,
                questionId: 'q_face_photo_front',
                status: 'answered'
            },
            orderBy: { savedAt: 'desc' }
        });

        if (frontFaceAnswer && frontFaceAnswer.value) {
            const value = frontFaceAnswer.value as any;
            if (value.image_url) {
                profileImage = await maybePresignUrl(value.image_url, 86400);
            }
        }

        const genderAnswer = await prisma.onboardingAnswer.findFirst({
            where: {
                userId,
                questionId: 'q_profile_gender',
                status: 'answered'
            },
            orderBy: { savedAt: 'desc' }
        });
        const gender = genderAnswer?.value as string | undefined;

        const totalProducts = await prisma.product.count({
            where: { userId }
        });

        let skinScore: number | null = null;
        let scoreChange: number = 0;

        const landmarks = await prisma.facialLandmarks.findMany({
            where: {
                userId,
                status: 'COMPLETED',
                score: { not: null }
            },
            orderBy: { createdAt: 'desc' },
            take: 2,
            select: { score: true }
        });

        if (landmarks.length > 0) {
            skinScore = landmarks[0].score;
            if (landmarks.length > 1 && landmarks[0].score !== null && landmarks[1].score !== null) {
                scoreChange = landmarks[0].score - landmarks[1].score;
            }
        }

        let tasksScore: number | null = null;
        let tasksCount = { completed: 0, total: 0 };

        try {
            const taskProgress = await getTaskProgress(userId);
            tasksScore = taskProgress.overallScore;
            tasksCount = {
                completed: taskProgress.totalTasksCompleted,
                total: taskProgress.totalTasksPossible
            };
        } catch (error) {
            console.log('No task progress found for user:', userId);
        }

        return {
            user_id: user.userId,
            name: user.name,
            phone_number: user.phoneNumber,
            date_of_birth: user.dateOfBirth?.toISOString(),
            profile_image: profileImage,
            email: user.email,
            sso_provider: user.ssoProvider,
            location: user.latitude !== null && user.latitude !== undefined && user.longitude !== null && user.longitude !== undefined
                ? {
                    latitude: user.latitude,
                    longitude: user.longitude,
                    updated_at: user.locationUpdatedAt?.toISOString() ?? null,
                }
                : null,
            gender,
            skin_score: skinScore,
            score_change: scoreChange,
            tasks_score: tasksScore,
            tasks_count: tasksCount,
            plan_details: {
                type: user.planType
            },
            total_products_in_use: totalProducts,
            created_at: user.createdAt.toISOString(),
            updated_at: user.updatedAt.toISOString()
        };
    }

    static async getAnalysis(userId: string) {
        const facialLandmarks = await prisma.facialLandmarks.findMany({
            where: { userId },
            include: {
                answer: {
                    select: {
                        questionId: true,
                        screenId: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const user = await prisma.user.findUnique({
            where: { userId },
            select: { planType: true }
        });

        return {
            user_id: userId,
            analysis: await Promise.all(facialLandmarks.map(async (landmark) => {
                let weeklyPlan = landmark.weeklyPlan ?
                    (typeof landmark.weeklyPlan === 'string' ? JSON.parse(landmark.weeklyPlan) : landmark.weeklyPlan)
                    : null;

                if (user?.planType === 'WEEKLY' && Array.isArray(weeklyPlan)) {
                    weeklyPlan = weeklyPlan.map((week: any, index: number) => {
                        if (index === 0) return week; // Week 1 is always visible
                        return {
                            ...week,
                            preview: "Upgrade to Monthly to unlock this week's plan",
                            locked: true
                        };
                    });
                }

                let analysisData = landmark.analysis ?
                    (typeof landmark.analysis === 'string' ? JSON.parse(landmark.analysis) : landmark.analysis)
                    : null;

                // Format issues with labels
                analysisData = formatAnalysisIssues(analysisData);

                // Remove duplicated fields from analysis to avoid duplication at top level
                if (analysisData) {
                    const { care_plan_4_weeks, score, ...restAnalysis } = analysisData;
                    analysisData = restAnalysis;
                }

                // Always return a viewable front image URL (presigned) for the frontend.
                let frontProfileUrl: string | null = null;
                try {
                    const frontFaceAnswer = await prisma.onboardingAnswer.findUnique({
                        where: { answerId: landmark.answerId },
                        select: { value: true }
                    });
                    const value = frontFaceAnswer?.value as any;
                    if (value?.image_url) {
                        frontProfileUrl = await maybePresignUrl(value.image_url, 86400);
                    }
                } catch {
                    // ignore
                }

                // svg overlays:
                // - PROGRESS: can be returned/stored elsewhere; if present in analysis JSON, surface it.
                // - INITIAL: DO NOT store svg overlays; compute on-demand here when asked.
                let svgOverlays: any[] | null = (analysisData as any)?.svg_overlays ?? null;
                if (landmark.analysisType === 'INITIAL') {
                    svgOverlays = null; // ensure we don't rely on persisted svg overlays for INITIAL
                    const issues = (analysisData as any)?.issues;
                    if (frontProfileUrl && Array.isArray(issues) && issues.length > 0) {
                        try {
                            const microserviceUrl =
                                process.env.LANDMARK_URL ||
                                process.env.FACIAL_LANDMARKS_API_URL ||
                                'http://localhost:8000';

                            const annotationResponse = await axios.post(`${microserviceUrl}/api/v1/annotate-issues-from-url`, {
                                image_url: frontProfileUrl,
                                issues
                            });

                            if (annotationResponse.data?.status === 'success') {
                                svgOverlays = annotationResponse.data.svg_overlays || [];
                                // Use updated issues (microservice may adjust landmarks)
                                if (annotationResponse.data.issues) {
                                    (analysisData as any).issues = annotationResponse.data.issues;
                                }
                            }
                        } catch (e) {
                            // if this fails, keep svgOverlays null
                        }
                    }
                }

                // Remove any embedded svg_overlays from analysis payload to avoid duplication,
                // while still returning svg_overlays at top-level.
                if (analysisData && (analysisData as any).svg_overlays) {
                    const { svg_overlays, ...rest } = analysisData as any;
                    analysisData = rest;
                }

                return {
                    answer_id: landmark.answerId,
                    question_id: landmark.answer.questionId,
                    screen_id: landmark.answer.screenId,
                    analysis: analysisData,
                    score: landmark.score,
                    weekly_plan: weeklyPlan,
                    analysis_type: landmark.analysisType,
                    plan_start_date: landmark.planStartDate?.toISOString(),
                    plan_end_date: landmark.planEndDate?.toISOString(),
                    status: landmark.status,
                    processed_at: landmark.processedAt?.toISOString(),
                    created_at: landmark.createdAt.toISOString(),
                    error: landmark.error,
                    annotated_image_url: landmark.annotatedImageUrl ? await maybePresignUrl(landmark.annotatedImageUrl, 86400) : null,
                    svg_overlays: svgOverlays,
                    front_profile_url: frontProfileUrl
                };
            }))
        };
    }

    static async getLandmarks(userId: string) {
        const facialLandmarks = await prisma.facialLandmarks.findMany({
            where: { userId },
            include: {
                answer: {
                    select: {
                        questionId: true,
                        screenId: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        return {
            user_id: userId,
            landmarks: facialLandmarks.map(landmark => ({
                answer_id: landmark.answerId,
                question_id: landmark.answer.questionId,
                screen_id: landmark.answer.screenId,
                landmarks: landmark.landmarks,
                status: landmark.status,
                processed_at: landmark.processedAt?.toISOString(),
                created_at: landmark.createdAt.toISOString(),
                error: landmark.error
            }))
        };
    }

    static async getAnnotatedImage(userId: string) {
        const latestLandmark = await prisma.facialLandmarks.findFirst({
            where: {
                userId,
                annotatedImageUrl: { not: null }
            },
            orderBy: { createdAt: 'desc' }
        });

        if (!latestLandmark || !latestLandmark.annotatedImageUrl) {
            throw { status: 404, message: 'No annotated image found' };
        }

        const presignedUrl = await maybePresignUrl(latestLandmark.annotatedImageUrl, 86400);

        return {
            user_id: userId,
            annotated_image_url: presignedUrl,
            created_at: latestLandmark.createdAt
        };
    }

    static async updateProfile(userId: string, data: { name?: string; phone_number?: string }) {
        const existingUser = await prisma.user.findUnique({
            where: { userId }
        });

        if (!existingUser) {
            throw { status: 404, message: 'User not found' };
        }

        const updateData: any = {};

        if (data.name !== undefined && data.name !== null) {
            updateData.name = data.name;
        }

        if (data.phone_number !== undefined && data.phone_number !== null) {
            updateData.phoneNumber = data.phone_number;
        }

        if (Object.keys(updateData).length === 0) {
            throw {
                status: 400,
                message: 'At least one field (name or phone_number) must be provided with a valid value'
            };
        }

        const updatedUser = await prisma.user.update({
            where: { userId },
            data: updateData,
            select: {
                userId: true,
                name: true,
                phoneNumber: true,
                dateOfBirth: true,
                email: true,
                ssoProvider: true,
                createdAt: true,
                updatedAt: true
            }
        });

        let profileImage: string | undefined;
        const frontFaceAnswer = await prisma.onboardingAnswer.findFirst({
            where: {
                userId,
                questionId: 'q_face_photo_front',
                status: 'answered'
            },
            orderBy: { savedAt: 'desc' }
        });

        if (frontFaceAnswer && frontFaceAnswer.value) {
            const value = frontFaceAnswer.value as any;
            if (value.image_url) {
                profileImage = await maybePresignUrl(value.image_url, 86400);
            }
        }

        let skinScore: number | null = null;
        const latestAnalysis = await prisma.facialLandmarks.findFirst({
            where: {
                userId,
                status: 'COMPLETED',
                score: { not: null }
            },
            orderBy: { createdAt: 'desc' },
            select: { score: true }
        });

        if (latestAnalysis) {
            skinScore = latestAnalysis.score;
        }

        let tasksScore: number | null = null;
        try {
            const taskProgress = await getTaskProgress(userId);
            tasksScore = taskProgress.overallScore;
        } catch (error) {
            console.log('No task progress found for user:', userId);
        }

        return {
            user_id: updatedUser.userId,
            name: updatedUser.name,
            phone_number: updatedUser.phoneNumber,
            date_of_birth: updatedUser.dateOfBirth?.toISOString(),
            profile_image: profileImage,
            email: updatedUser.email,
            sso_provider: updatedUser.ssoProvider,
            skin_score: skinScore,
            tasks_score: tasksScore,
            created_at: updatedUser.createdAt.toISOString(),
            updated_at: updatedUser.updatedAt.toISOString(),
            updated: true
        };
    }

    static async updateLocation(userId: string, data: { latitude: number; longitude: number }) {
        const updatedUser = await prisma.user.update({
            where: { userId },
            data: {
                latitude: data.latitude,
                longitude: data.longitude,
                locationUpdatedAt: new Date(),
            },
            select: {
                userId: true,
                latitude: true,
                longitude: true,
                locationUpdatedAt: true,
            }
        });

        return {
            user_id: updatedUser.userId,
            latitude: updatedUser.latitude,
            longitude: updatedUser.longitude,
            updated_at: updatedUser.locationUpdatedAt?.toISOString() ?? null,
        };
    }

    static async updateConsent(userId: string, hasConsented: boolean) {
        const updatedUser = await prisma.user.update({
            where: { userId },
            data: { hasConsented },
            select: {
                userId: true,
                hasConsented: true,
                updatedAt: true
            }
        });

        return {
            user_id: updatedUser.userId,
            has_consented: updatedUser.hasConsented,
            updated_at: updatedUser.updatedAt.toISOString(),
            updated: true
        };
    }

    static async deleteProfile(userId: string) {
        const user = await prisma.user.findUnique({
            where: { userId }
        });

        if (!user) {
            throw { status: 404, message: 'User not found' };
        }

        // Soft delete: just set deletedAt
        await prisma.user.update({
            where: { userId },
            data: { deletedAt: new Date() }
        });

        return {
            user_id: userId,
            deleted: true,
            soft_deletion: true,
            deleted_at: new Date().toISOString()
        };
    }

    static async cleanupDeletedUsers() {
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

        const usersToDelete = await prisma.user.findMany({
            where: {
                deletedAt: {
                    lt: sixtyDaysAgo
                }
            },
            select: { userId: true }
        });

        console.log(`Found ${usersToDelete.length} users ensuring hard deletion.`);

        for (const user of usersToDelete) {
            const userId = user.userId;
            console.log(`Processing hard deletion for user: ${userId}`);

            const imagesToDelete: string[] = [];

            try {
                const landmarks = await prisma.facialLandmarks.findMany({
                    where: { userId, annotatedImageUrl: { not: null } },
                    select: { annotatedImageUrl: true }
                });
                landmarks.forEach(l => {
                    if (l.annotatedImageUrl) imagesToDelete.push(l.annotatedImageUrl);
                });

                const answers = await prisma.onboardingAnswer.findMany({
                    where: { userId, status: 'answered' },
                    select: { value: true }
                });

                answers.forEach(ans => {
                    const val = ans.value as any;
                    if (val && typeof val === 'object' && val.image_url && typeof val.image_url === 'string') {
                        imagesToDelete.push(val.image_url);
                    }
                });

                const uniqueImages = [...new Set(imagesToDelete)];
                if (uniqueImages.length > 0) {
                    await Promise.allSettled(uniqueImages.map(async (url) => {
                        try {
                            await deleteFileFromUrl(url);
                        } catch (error) {
                            console.error(`Failed to delete S3 image: ${url}`, error);
                        }
                    }));
                }
            } catch (error) {
                console.error(`Error identifying/deleting S3 images for user ${userId}:`, error);
            }

            // Hard delete from DB
            try {
                await prisma.$transaction([
                    prisma.refreshToken.deleteMany({ where: { userId } }),
                    prisma.product.deleteMany({ where: { userId } }),
                    prisma.facialLandmarks.deleteMany({ where: { userId } }),
                    prisma.onboardingAnswer.deleteMany({ where: { userId } }),
                    prisma.onboardingSession.deleteMany({ where: { userId } }),
                    prisma.user.delete({ where: { userId } })
                ]);
                console.log(`Hard deleted user: ${userId}`);
            } catch (error) {
                console.error(`Failed to hard delete user ${userId} from DB:`, error);
            }
        }
    }

    static async getOnboardingStatus(userId: string) {
        const onboardingSession = await prisma.onboardingSession.findUnique({
            where: { userId }
        });

        let onboardingStatus = 'not_started';
        let answersCount = 0;
        let createdAt: string | null = null;
        let updatedAt: string | null = null;
        let completedAt: string | null = null;

        if (onboardingSession) {
            onboardingStatus = onboardingSession.status;
            createdAt = onboardingSession.createdAt.toISOString();
            updatedAt = onboardingSession.updatedAt.toISOString();

            if (onboardingSession.status === 'completed') {
                completedAt = onboardingSession.updatedAt.toISOString();
            }

            const answers = await prisma.onboardingAnswer.count({
                where: {
                    userId,
                    status: 'answered'
                }
            });
            answersCount = answers;
        }

        return {
            user_id: userId,
            onboarding_status: onboardingStatus,
            answers_count: answersCount,
            created_at: createdAt,
            updated_at: updatedAt,
            completed_at: completedAt
        };
    }

    static async getWeeklyPlan(userId: string) {
        const facialLandmark = await prisma.facialLandmarks.findFirst({
            where: {
                userId,
                status: 'COMPLETED',
                weeklyPlan: { not: Prisma.DbNull }
            },
            orderBy: { createdAt: 'desc' }
        });

        if (!facialLandmark) {
            throw { status: 404, message: 'No weekly plan found' };
        }

        let tasksScore = 0;
        let tasksMissing: any[] = [];
        let tasksCompleted: any[] = [];

        if (facialLandmark.planStartDate) {
            const today = new Date();
            const planStart = facialLandmark.planStartDate;
            const daysSinceStart = Math.floor((today.getTime() - planStart.getTime()) / (1000 * 60 * 60 * 24));
            const currentWeek = Math.min(Math.floor(daysSinceStart / 7) + 1, 4);

            const weekTasks = await prisma.task.findMany({
                where: {
                    userId,
                    week: currentWeek,
                    isActive: true
                }
            });

            const weekStart = new Date(planStart);
            weekStart.setDate(weekStart.getDate() + (currentWeek - 1) * 7);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);

            const weekCompletions = await prisma.taskCompletion.findMany({
                where: {
                    userId,
                    taskId: { in: weekTasks.map(t => t.id) },
                    completedAt: {
                        gte: weekStart,
                        lte: weekEnd
                    }
                }
            });

            const completedTaskIds = new Set(weekCompletions.map(c => c.taskId));

            let totalWeight = 0;
            let weightedScore = 0;

            weekTasks.forEach(task => {
                const weight = task.priority === 'critical' ? 3 : task.priority === 'important' ? 2 : 1;
                totalWeight += weight;

                const isCompleted = completedTaskIds.has(task.id);
                if (isCompleted) {
                    weightedScore += weight * 100;
                    tasksCompleted.push({
                        id: task.id,
                        title: task.title,
                        category: task.category,
                        priority: task.priority
                    });
                } else {
                    tasksMissing.push({
                        id: task.id,
                        title: task.title,
                        category: task.category,
                        priority: task.priority
                    });
                }
            });

            tasksScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;
        }

        let improvements: string[] = [];
        if (facialLandmark.analysisType === 'PROGRESS') {
            const analysis = facialLandmark.analysis ?
                (typeof facialLandmark.analysis === 'string' ? JSON.parse(facialLandmark.analysis) : facialLandmark.analysis) as any
                : null;

            if (analysis && analysis.visual_improvements) {
                improvements = analysis.visual_improvements;
            }
        }

        return {
            user_id: userId,
            analysis_type: facialLandmark.analysisType,
            skin_score: facialLandmark.score,
            tasks_score: tasksScore,
            tasks_missing: tasksMissing,
            improvements: improvements,
            plan_start_date: facialLandmark.planStartDate?.toISOString(),
            plan_end_date: facialLandmark.planEndDate?.toISOString(),
            created_at: facialLandmark.createdAt.toISOString(),
        };
    }

    static async getQuestions(userId: string) {
        const savedAnswers = await prisma.onboardingAnswer.findMany({
            where: {
                userId,
                screenId: PROFILE_SCREEN_ID,
            },
            orderBy: { savedAt: 'desc' },
        });

        const answerMap = new Map();
        savedAnswers.forEach(answer => {
            if (!answerMap.has(answer.questionId)) {
                answerMap.set(answer.questionId, answer);
            }
        });

        const questions = PROFILE_QUESTIONS.map(question => {
            const savedAnswer = answerMap.get(question.question_id);

            const questionResponse: any = {
                question_id: question.question_id,
                question_text: question.question_text,
                type: question.type,
                status: savedAnswer ? savedAnswer.status : 'new',
                value: savedAnswer ? savedAnswer.value : null,
            };

            if (question.type === 'single' && question.options) {
                questionResponse.options = mapOptionsWithLabels(question.options);
            } else if (question.type === 'slider') {
                questionResponse.min_value = question.min_value;
                questionResponse.max_value = question.max_value;
                questionResponse.default_value = question.default_value;
            }

            if (savedAnswer) {
                questionResponse.saved_at = savedAnswer.savedAt.toISOString();
            }

            return questionResponse;
        });

        answerMap.forEach((answer, questionId) => {
            const isPredefined = PROFILE_QUESTIONS.some(q => q.question_id === questionId);
            if (!isPredefined) {
                questions.push({
                    question_id: questionId,
                    question_text: questionId,
                    type: answer.type,
                    status: answer.status,
                    value: answer.value,
                    saved_at: answer.savedAt.toISOString(),
                });
            }
        });

        return {
            user_id: userId,
            questions,
        };
    }

    static async saveAnswers(userId: string, answers: any[]) {
        // Ensure user exists before saving answers
        const user = await prisma.user.findUnique({
            where: { userId }
        });

        if (!user) {
            throw { status: 404, message: 'User not found' };
        }

        const savedAnswers = [];
        const now = new Date();

        for (const answer of answers) {
            let { question_id, value, status } = answer;

            const question = getProfileQuestion(question_id);

            if (question && question.type === 'slider' && typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '') {
                value = Number(value);
            }

            if (status === 'answered' && value !== null && question) {
                const isValid = validateProfileQuestionValue(question_id, value);
                if (!isValid) {
                    throw {
                        status: 400,
                        message: `Invalid value for question ${question_id}`,
                        details: {
                            question_id,
                            value,
                            expected_type: question.type,
                            ...(question.type === 'single' && { valid_options: question.options }),
                            ...(question.type === 'slider' && {
                                min_value: question.min_value,
                                max_value: question.max_value
                            })
                        }
                    };
                }
            }

            if (status === 'answered' && value !== null && !question) {
                if (typeof value !== 'string' && typeof value !== 'number') {
                    throw {
                        status: 400,
                        message: `Invalid value type for question ${question_id}. Must be string or number.`,
                        details: {
                            question_id,
                            value,
                            received_type: typeof value
                        }
                    };
                }
            }

            const answerId = `ans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            let answerType: 'single' | 'slider' | 'derived';
            if (question) {
                answerType = question.type === 'single' ? 'single' : 'slider';
            } else {
                answerType = 'derived';
            }

            const existingAnswer = await prisma.onboardingAnswer.findFirst({
                where: {
                    userId,
                    questionId: question_id,
                    screenId: PROFILE_SCREEN_ID,
                },
                orderBy: { savedAt: 'desc' },
            });

            if (existingAnswer) {
                await prisma.onboardingAnswer.update({
                    where: { answerId: existingAnswer.answerId },
                    data: {
                        value: value as any,
                        status: status as any,
                        savedAt: now,
                    },
                });

                savedAnswers.push({
                    question_id,
                    question_text: question?.question_text || question_id,
                    saved: true,
                    saved_at: now.toISOString(),
                });
            } else {
                // Create new answer
                await prisma.onboardingAnswer.create({
                    data: {
                        answerId,
                        userId,
                        screenId: PROFILE_SCREEN_ID,
                        questionId: question_id,
                        type: answerType,
                        value: value as any,
                        status: status as any,
                        savedAt: now,
                    },
                });

                savedAnswers.push({
                    question_id,
                    question_text: question?.question_text || question_id,
                    saved: true,
                    saved_at: now.toISOString(),
                });
            }
        }

        return {
            user_id: userId,
            saved: true,
            answers: savedAnswers,
        };
    }

    static async addCustomQuestion(userId: string, questionData: {
        question_id: string;
        question_text: string;
        type: 'single' | 'slider';
        options?: string[];
        min_value?: number;
        max_value?: number;
        default_value?: number;
    }) {
        const user = await prisma.user.findUnique({
            where: { userId }
        });

        if (!user) {
            throw { status: 404, message: 'User not found' };
        }

        const existingQuestion = await prisma.onboardingAnswer.findFirst({
            where: {
                userId,
                questionId: questionData.question_id,
                screenId: PROFILE_SCREEN_ID,
            }
        });

        if (existingQuestion) {
            throw {
                status: 409,
                message: `Question with ID ${questionData.question_id} already exists`,
            };
        }

        const answerId = `ans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date();

        await prisma.onboardingAnswer.create({
            data: {
                answerId,
                userId,
                screenId: PROFILE_SCREEN_ID,
                questionId: questionData.question_id,
                type: questionData.type,
                value: Prisma.JsonNull,
                status: 'skipped',
                savedAt: now,
            },
        });

        return {
            user_id: userId,
            question_id: questionData.question_id,
            question_text: questionData.question_text,
            type: questionData.type,
            ...(questionData.type === 'single' && { options: questionData.options }),
            ...(questionData.type === 'slider' && {
                min_value: questionData.min_value,
                max_value: questionData.max_value,
                default_value: questionData.default_value,
            }),
            status: 'skipped',
            created_at: now.toISOString(),
        };
    }

    static async getOnboardingAnswers(userId: string) {
        const user = await prisma.user.findUnique({
            where: { userId }
        });

        if (!user) {
            throw { status: 404, message: 'User not found' };
        }

        const answers = await prisma.onboardingAnswer.findMany({
            where: {
                userId,
                screenId: { not: PROFILE_SCREEN_ID }
            },
            orderBy: { savedAt: 'desc' }
        });

        const answerMap = new Map();
        answers.forEach(answer => {
            if (!answerMap.has(answer.questionId)) {
                answerMap.set(answer.questionId, answer);
            }
        });

        const formattedAnswers = Array.from(answerMap.values()).map(answer => {
            const questionType = getExpectedType(answer.questionId);
            const validValues = getValidValues(answer.questionId);
            const questionText = getQuestionText(answer.questionId);

            const response: any = {
                question_id: answer.questionId,
                question_text: questionText,
                type: answer.type,
                status: answer.status,
                saved_at: answer.savedAt.toISOString()
            };

            // Format value with labels
            if (answer.type === 'single' && typeof answer.value === 'string') {
                response.value = {
                    value: answer.value,
                    label: formatLabel(answer.value)
                };
            } else if (answer.type === 'multi' && Array.isArray(answer.value)) {
                response.value = answer.value.map((val: string) => ({
                    value: val,
                    label: formatLabel(val)
                }));
            } else if (answer.type === 'image' && typeof answer.value === 'object' && answer.value !== null) {
                response.value = answer.value;
            } else {
                response.value = answer.value;
            }

            // Add options with labels for single/multi choice questions
            if ((answer.type === 'single' || answer.type === 'multi') && validValues) {
                response.options = validValues.map(option => ({
                    value: option,
                    label: formatLabel(option)
                }));
            }

            return response;
        });

        return {
            user_id: userId,
            answers: formattedAnswers
        };
    }
}

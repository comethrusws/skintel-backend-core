import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { getTaskProgress } from './tasks';
import { maybePresignUrl } from '../lib/s3';
import { PROFILE_QUESTIONS, PROFILE_SCREEN_ID, getProfileQuestion, validateProfileQuestionValue } from '../lib/profileQuestions';

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

        return {
            user_id: userId,
            analysis: facialLandmarks.map(landmark => ({
                answer_id: landmark.answerId,
                question_id: landmark.answer.questionId,
                screen_id: landmark.answer.screenId,
                analysis: landmark.analysis ?
                    (typeof landmark.analysis === 'string' ? JSON.parse(landmark.analysis) : landmark.analysis)
                    : null,
                score: landmark.score,
                weekly_plan: landmark.weeklyPlan ?
                    (typeof landmark.weeklyPlan === 'string' ? JSON.parse(landmark.weeklyPlan) : landmark.weeklyPlan)
                    : null,
                analysis_type: landmark.analysisType,
                plan_start_date: landmark.planStartDate?.toISOString(),
                plan_end_date: landmark.planEndDate?.toISOString(),
                status: landmark.status,
                processed_at: landmark.processedAt?.toISOString(),
                created_at: landmark.createdAt.toISOString(),
                error: landmark.error
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

        if (data.name !== undefined) {
            updateData.name = data.name;
        }

        if (data.phone_number !== undefined) {
            updateData.phoneNumber = data.phone_number;
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

    static async deleteProfile(userId: string) {
        const user = await prisma.user.findUnique({
            where: { userId }
        });

        if (!user) {
            throw { status: 404, message: 'User not found' };
        }

        await prisma.$transaction([
            prisma.refreshToken.deleteMany({
                where: { userId }
            }),
            prisma.product.deleteMany({
                where: { userId }
            }),
            prisma.facialLandmarks.deleteMany({
                where: { userId }
            }),
            prisma.onboardingAnswer.deleteMany({
                where: { userId }
            }),
            prisma.onboardingSession.deleteMany({
                where: { userId }
            }),
            prisma.user.delete({
                where: { userId }
            })
        ]);

        return {
            user_id: userId,
            deleted: true,
            deleted_at: new Date().toISOString()
        };
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
                questionResponse.options = question.options;
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
        const savedAnswers = [];
        const now = new Date();

        for (const answer of answers) {
            const { question_id, value, status } = answer;

            const question = getProfileQuestion(question_id);

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
}

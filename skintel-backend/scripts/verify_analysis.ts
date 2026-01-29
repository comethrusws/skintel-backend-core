
import { PrismaClient } from '@prisma/client';
import { maybePresignUrl } from '../src/lib/s3';

const prisma = new PrismaClient();

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log('Starting verification report generation...');

    // header
    console.log([
        'User ID',
        'Email',
        'Analysis Date',
        'Issue Type',
        'Severity',
        'Region',
        'Front Image',
        'Left Image',
        'Right Image',
        'Annotated Image'
    ].join('\t'));

    const completedAnalyses = await prisma.facialLandmarks.findMany({
        where: {
            status: 'COMPLETED'
        },
        include: {
            user: true,
            answer: true
        },
        orderBy: {
            createdAt: 'desc'
        }
    });

    for (const analysis of completedAnalyses) {
        // 1. Get User Images
        const userImages = await prisma.onboardingAnswer.findMany({
            where: {
                userId: analysis.userId || analysis.answer?.userId, // fallback
                questionId: { in: ['q_face_photo_front', 'q_face_photo_left', 'q_face_photo_right'] }
            }
        });

        let frontUrl = '';
        let leftUrl = '';
        let rightUrl = '';

        for (const imgAnswer of userImages) {
            const val = imgAnswer.value as any;
            const rawUrl = val.image_url || ((val.image_id) ? `http://localhost:3000/images/${val.image_id}` : ''); // simple fallback


            let signedUrl = rawUrl;
            if (rawUrl) {
                try {
                    signedUrl = await maybePresignUrl(rawUrl, 3600 * 24); // 24 hours validity for the report
                } catch (e) {
                    // ignore
                }
            }

            if (imgAnswer.questionId === 'q_face_photo_front') frontUrl = signedUrl;
            if (imgAnswer.questionId === 'q_face_photo_left') leftUrl = signedUrl;
            if (imgAnswer.questionId === 'q_face_photo_right') rightUrl = signedUrl;
        }

        // 2. Parse Analysis Issues
        const analysisJson = analysis.analysis as any;
        const issues = analysisJson?.issues || [];

        // Annotated Image
        let annotatedUrl = analysis.annotatedImageUrl || '';
        if (annotatedUrl) {
            try {
                annotatedUrl = await maybePresignUrl(annotatedUrl, 3600 * 24);
            } catch (e) { }
        }


        if (issues.length === 0) {
            // Output a row even if no issues, just to show we analyzed it? or maybe just skip?
            // Requirement says "Complete list of skin issues... for each user"
            // If a user has NO issues, we should probably still list them once to show they were checked?
            // But the previous SQL query did `CROSS JOIN` which implies only rows with issues.
            // Let's stick to listing issues. If no issues, maybe one row with "No Issues"?
            // Let's output one row per issue.
            // If no issues, we print one row with empty issue fields to represent the user was analyzed.
            console.log([
                analysis.userId,
                analysis.user?.email || 'N/A',
                analysis.createdAt.toISOString(),
                'NO_ISSUES_DETECTED',
                'N/A',
                'N/A',
                frontUrl,
                leftUrl,
                rightUrl,
                annotatedUrl
            ].join('\t'));
        } else {
            for (const issue of issues) {
                console.log([
                    analysis.userId,
                    analysis.user?.email || 'N/A',
                    analysis.createdAt.toISOString(),
                    issue.type,
                    issue.severity,
                    issue.region,
                    frontUrl,
                    leftUrl,
                    rightUrl,
                    annotatedUrl
                ].join('\t'));
            }
        }

        // throttle slightly to not hammer S3 presign too fast if thousands of rows
        await delay(10);
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

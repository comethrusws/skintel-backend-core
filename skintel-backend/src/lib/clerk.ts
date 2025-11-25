import { createClerkClient, verifyToken } from '@clerk/express';

const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!clerkSecretKey) {
    throw new Error('CLERK_SECRET_KEY is not defined in environment variables');
}

export const clerk = createClerkClient({
    secretKey: clerkSecretKey,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});

export interface ClerkUserInfo {
    clerkUserId: string;
    sessionId: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    provider: string;
}

export async function verifyClerkSessionToken(sessionToken: string): Promise<ClerkUserInfo | null> {
    try {
        const payload = await verifyToken(sessionToken, {
            secretKey: clerkSecretKey,
        });

        if (!payload || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
            return null;
        }

        const user = await clerk.users.getUser(payload.sub);

        if (!user) {
            return null;
        }

        const primaryEmail = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
        const externalAccounts = user.externalAccounts || [];

        let provider = 'clerk';
        if (externalAccounts.length > 0) {
            const primaryAccount = externalAccounts[0];
            provider = `clerk_${primaryAccount.provider}`;
        }

        return {
            clerkUserId: user.id,
            sessionId: payload.sid,
            email: primaryEmail?.emailAddress || null,
            firstName: user.firstName || null,
            lastName: user.lastName || null,
            provider,
        };
    } catch (error) {
        console.error('Clerk session verification error:', error);
        return null;
    }
}

export async function getClerkUserById(clerkUserId: string) {
    try {
        return await clerk.users.getUser(clerkUserId);
    } catch (error) {
        console.error('Error fetching Clerk user:', error);
        return null;
    }
}

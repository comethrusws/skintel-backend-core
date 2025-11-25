import { createClerkClient } from '@clerk/express';

if (!process.env.CLERK_SECRET_KEY) {
    throw new Error('CLERK_SECRET_KEY is not defined in environment variables');
}

export const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
});

export interface ClerkUserInfo {
    clerkUserId: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    provider: string;
}

export async function verifyClerkSessionToken(sessionToken: string): Promise<ClerkUserInfo | null> {
    try {
        const session = await clerk.sessions.getSession(sessionToken);

        if (!session || !session.userId) {
            return null;
        }

        const userId = session.userId;
        const user = await clerk.users.getUser(userId);

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
            email: primaryEmail?.emailAddress || null,
            firstName: user.firstName || null,
            lastName: user.lastName || null,
            provider: provider,
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

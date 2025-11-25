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
        const sessionId = extractSessionIdFromToken(sessionToken);
        if (!sessionId) {
            return null;
        }

        const session = await clerk.sessions.verifySession(sessionId, sessionToken);
        if (!session || !session.userId) {
            return null;
        }

        const user = await clerk.users.getUser(session.userId);
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

function extractSessionIdFromToken(token: string): string | null {
    try {
        const [, payload] = token.split('.');
        if (!payload) {
            return null;
        }

        const normalizedPayload = normalizeBase64Url(payload);
        const decoded = Buffer.from(normalizedPayload, 'base64').toString('utf8');
        const claims = JSON.parse(decoded);
        return claims?.sid || null;
    } catch (error) {
        console.error('Failed to extract Clerk session ID from token:', error);
        return null;
    }
}

function normalizeBase64Url(input: string): string {
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const paddingNeeded = base64.length % 4 === 0 ? 0 : 4 - (base64.length % 4);
    return base64 + '='.repeat(paddingNeeded);
}

export async function getClerkUserById(clerkUserId: string) {
    try {
        return await clerk.users.getUser(clerkUserId);
    } catch (error) {
        console.error('Error fetching Clerk user:', error);
        return null;
    }
}

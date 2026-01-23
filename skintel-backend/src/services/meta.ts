import { Content, CustomData, EventRequest, ServerEvent, UserData, FacebookAdsApi } from 'facebook-nodejs-business-sdk';
import crypto from 'crypto';

const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PIXEL_ID = process.env.META_PIXEL_ID;
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE;

// Initialize the API if token exists
const api = ACCESS_TOKEN ? FacebookAdsApi.init(ACCESS_TOKEN) : null;
if (api) {
    api.setDebug(process.env.NODE_ENV === 'development');
}

export type MetaEventName =
    | 'CompleteRegistration'
    | 'Purchase'
    | 'StartTrial'
    | 'Subscribe'
    | 'ViewContent'
    | 'AddPaymentInfo'
    | 'InitiateCheckout'
    | string; // Allow custom strings for custom events like "onboarding_step"

export interface MetaUserData {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string; // YYYYMMDD
    city?: string;
    state?: string;
    zip?: string;
    country?: string; // ISO 2-letter
    externalId?: string;
    clientIp?: string;
    clientUserAgent?: string;
    fbc?: string; // Click ID from cookie
    fbp?: string; // Browser ID from cookie
}

export interface MetaCustomData {
    value?: number;
    currency?: string;
    contentName?: string;
    contentIds?: string[];
    contentType?: string;
    orderId?: string;
    status?: string;
    predictedLtv?: number;
    [key: string]: any;
}

export class MetaConversionService {
    /**
     * Hash user data using SHA-256 (required by Meta)
     */
    private static hash(data: string): string {
        return crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');
    }

    /**
     * Send an event to Meta Conversions API
     */
    static async sendEvent(
        eventName: MetaEventName,
        userData: MetaUserData,
        customData?: MetaCustomData,
        eventSourceUrl?: string,
        actionSource: 'website' | 'app' | 'physical_store' | 'system_generated' | 'email' | 'other' = 'website'
    ): Promise<boolean> {
        if (!ACCESS_TOKEN || !PIXEL_ID) {
            console.warn('[MetaCAPI] Missing configuration (META_ACCESS_TOKEN or META_PIXEL_ID). Event skipped.');
            return false;
        }

        try {
            const currentTimestamp = Math.floor(new Date().getTime() / 1000);

            const user = new UserData();

            if (userData.clientIp) user.setClientIpAddress(userData.clientIp);
            if (userData.clientUserAgent) user.setClientUserAgent(userData.clientUserAgent);

            if (userData.email) user.setEmail(this.hash(userData.email));
            if (userData.phone) user.setPhone(this.hash(userData.phone));
            if (userData.firstName) user.setFirstName(this.hash(userData.firstName));
            if (userData.lastName) user.setLastName(this.hash(userData.lastName));
            if (userData.externalId) user.setExternalId(this.hash(userData.externalId));
            if (userData.fbc) user.setFbc(userData.fbc);
            if (userData.fbp) user.setFbp(userData.fbp);
            if (userData.country) user.setCountry(this.hash(userData.country));

            const custom = new CustomData();
            if (customData) {
                if (customData.value) custom.setValue(customData.value);
                if (customData.currency) custom.setCurrency(customData.currency);
                if (customData.contentName) custom.setContentName(customData.contentName);
                if (customData.contentIds) custom.setContentIds(customData.contentIds);
                if (customData.contentType) custom.setContentType(customData.contentType);
                if (customData.orderId) custom.setOrderId(customData.orderId);
                if (customData.status) custom.setStatus(customData.status);

                // Add any other custom properties
                Object.keys(customData).forEach(key => {
                    if (!['value', 'currency', 'contentName', 'contentIds', 'contentType', 'orderId', 'status'].includes(key)) {
                        // Custom data properties can be added via custom properties if needed, 
                        // but strictly typed CustomData object is preferred. 
                        // For custom properties not in the typed class, we might need a workaround or just stick to standard fields.
                        // The SDK supports custom properties via `addProperty` on CustomData if needed, 
                        // but let's stick to standard fields for now to avoid validation errors.
                        (custom as any)._data[key] = customData[key];
                    }
                });
            }

            const serverEvent = new ServerEvent()
                .setEventName(eventName)
                .setEventTime(currentTimestamp)
                .setUserData(user)
                .setCustomData(custom)
                .setActionSource(actionSource);

            if (eventSourceUrl) {
                serverEvent.setEventSourceUrl(eventSourceUrl);
            }

            const eventsData = [serverEvent];
            const eventRequest = new EventRequest(ACCESS_TOKEN, PIXEL_ID).setEvents(eventsData);

            if (TEST_EVENT_CODE) {
                eventRequest.setTestEventCode(TEST_EVENT_CODE);
                console.log(`[MetaCAPI] Using Test Event Code: ${TEST_EVENT_CODE}`);
            }

            const response = await eventRequest.execute();

            console.log(`[MetaCAPI] Event '${eventName}' sent successfully. Trace ID: ${response.fbtrace_id}`);
            return true;

        } catch (error: any) {
            console.error('[MetaCAPI] Failed to send event:', error.response ? error.response.data : error.message);
            // We do NOT throw here to prevent breaking the main application flow
            return false;
        }
    }
}

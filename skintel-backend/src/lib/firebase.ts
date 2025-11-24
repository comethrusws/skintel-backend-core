import admin from 'firebase-admin';

if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
        });
        console.log('Firebase Admin initialized successfully');
    } catch (error) {
        console.error('Firebase Admin initialization failed:', error);
    }
}

export const firebaseAdmin = admin;

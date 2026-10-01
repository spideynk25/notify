const express = require('express');
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

// Load service account json or fallback to environment variable
let serviceAccount;
try {
    serviceAccount = require("./serviceAccountKey.json");
} catch (e) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        } catch (jsonErr) {
            console.error("Could not parse FIREBASE_SERVICE_ACCOUNT environment variable:", jsonErr);
        }
    } else {
        console.error("Could not load serviceAccountKey.json and no FIREBASE_SERVICE_ACCOUNT env var:", e);
    }
}

if (!admin.apps.length && serviceAccount) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const app = express();

app.use(bodyParser.json());

// Health check endpoint
app.get("/", (req, res) => {
    res.status(200).send("Worship Chat Notification Server is healthy");
});

// Helper: ensure all data values are strings (FCM requirement)
function sanitizeData(data) {
    if (!data || typeof data !== 'object') return {};
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
        sanitized[key] = String(value ?? '');
    }
    return sanitized;
}

app.post("/send-single", async (req, res) => {
    const { title, body, token, data, tag } = req.body;
    console.log("send-single received:", { title, body, tag, hasToken: !!token });

    if (!title || !body) {
        return res.status(400).send("Title and body are required");
    }

    if (!token) {
        return res.status(400).send("No device token provided");
    }

    const notifTag = tag || (data && (data.tag || data.groupId || data.senderUid));

    // Data payload enables background handler to build rich notifications on Android with actions & grouping
    const payloadData = sanitizeData({
        ...(data || {}),
        title: title,
        body: body,
        tag: notifTag ? String(notifTag) : '',
    });

    // Pure data payload for Android (high priority) triggers FirebaseMessaging.onBackgroundMessage
    // so FlutterLocalNotificationsPlugin builds custom tiles with "Mark as read", "Reply", and MessagingStyleInformation.
    // iOS receives standard APNs alert payload.
    const message = {
        token: token,
        data: payloadData,
        android: {
            priority: 'high',
        },
        apns: {
            payload: {
                aps: {
                    alert: {
                        title: title,
                        body: body,
                    },
                    sound: 'default',
                    contentAvailable: true,
                    badge: 1,
                },
            },
        },
    };

    try {
        const response = await admin.messaging().send(message);
        console.log("Notification sent successfully:", response);
        return res.status(200).send("Notification sent successfully");
    } catch (e) {
        console.error("Error sending notification:", e);
        return res.status(500).send("Error sending notification");
    }
});

app.post("/send-multiple", async (req, res) => {
    const { title, body, tokens, data, tag } = req.body;
    console.log("send-multiple received:", { title, body, tag, tokenCount: tokens?.length });

    if (!title || !body) {
        return res.status(400).send("Title and body are required");
    }

    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
        return res.status(400).send("A list of device tokens is required");
    }

    const notifTag = tag || (data && (data.tag || data.groupId || data.senderUid));

    const payloadData = sanitizeData({
        ...(data || {}),
        title: title,
        body: body,
        tag: notifTag ? String(notifTag) : '',
    });

    const message = {
        tokens: tokens,
        data: payloadData,
        android: {
            priority: 'high',
        },
        apns: {
            payload: {
                aps: {
                    alert: {
                        title: title,
                        body: body,
                    },
                    sound: 'default',
                    contentAvailable: true,
                    badge: 1,
                },
            },
        },
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(message);
        console.log("Successfully sent messages:", response.successCount);
        console.log("Failed messages:", response.failureCount);

        return res.status(200).send({
            success: response.successCount,
            failure: response.failureCount,
            responses: response.responses
        });
    } catch (e) {
        console.error("Error sending notifications:", e);
        return res.status(500).send("Error sending notifications");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
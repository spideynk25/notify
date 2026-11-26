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

    // Dual payload: standard notification for instant system tray alert on Android & iOS,
    // plus data payload for rich background handling, inline actions & deep linking.
    const message = {
        token: token,
        notification: {
            title: title,
            body: body,
        },
        data: payloadData,
        android: {
            priority: 'high',
            notification: {
                channelId: 'high_importance_channel',
                clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                sound: 'default',
                tag: notifTag ? String(notifTag) : undefined,
            },
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
        notification: {
            title: title,
            body: body,
        },
        data: payloadData,
        android: {
            priority: 'high',
            notification: {
                channelId: 'high_importance_channel',
                clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                sound: 'default',
                tag: notifTag ? String(notifTag) : undefined,
            },
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

app.post("/notify-update", async (req, res) => {
    const { versionName, versionCode, releaseNotes, forceUpdate } = req.body || {};
    const cleanVersion = String(versionName || "").replace(/^v/i, "").trim();
    const buildNum = String(versionCode || "").trim();

    if (!cleanVersion && !buildNum) {
        return res.status(400).send("versionName or versionCode is required");
    }

    const displayVersion = cleanVersion || `b${buildNum}`;
    const isForced = forceUpdate === true || forceUpdate === "true";
    const title = isForced
        ? `⚡ Required Update: Worship Chat v${displayVersion}`
        : `✨ Worship Chat v${displayVersion} Available`;

    const summary = String(releaseNotes || "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !/^sha256\s*:/i.test(line))
        .slice(0, 2)
        .join(" • ");
    const body = summary
        ? (summary.length > 140 ? summary.slice(0, 137) + "..." : summary)
        : `Tap to download and install Build ${buildNum || "latest"}.`;

    const payloadData = sanitizeData({
        type: "app_update",
        versionName: displayVersion,
        versionCode: buildNum,
        releaseNotes: String(releaseNotes || "").trim(),
        forceUpdate: isForced ? "true" : "false",
        title,
        body,
    });

    const message = {
        topic: "app_updates",
        notification: {
            title,
            body,
        },
        data: payloadData,
        android: {
            priority: "high",
            notification: {
                channelId: "app_updates_channel",
                clickAction: "FLUTTER_NOTIFICATION_CLICK",
                sound: "default",
                tag: "app_update",
            },
        },
    };

    try {
        const response = await admin.messaging().send(message);
        console.log("Update topic notification sent:", response);
        return res.status(200).send({ messageId: response });
    } catch (e) {
        console.error("Error sending update notification:", e);
        return res.status(500).send("Error sending update notification");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

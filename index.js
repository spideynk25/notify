const express = require('express')
const bodyParser = require("body-parser")
const admin = require("firebase-admin")

//load service account json
const serviceAccount = require("./serviceAccountKey.json")

//initialize firebase admin with the service account
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
})

const app = express();

app.use(bodyParser.json())

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
    const { title, body, token, data } = req.body
    console.log(req.body);

    if (!title || !body) {
        return res.status(400).send("Title and body are required")
    }

    if (!token) {
        return res.status(400).send("No device token stored. Call /store-single-token first")
    }

    //create the message object for send()
    const message = {
        token: token,
        notification: {
            title: title,
            body: body,
        },
        // Data payload enables tap-to-navigate in Flutter
        data: sanitizeData(data),
        android: {
            priority: 'high',
            notification: {
                clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                sound: 'default',
            },
        },
        apns: {
            payload: {
                aps: {
                    sound: 'default',
                    contentAvailable: true,
                },
            },
        },
    };

    try {
        const response = await admin.messaging().send(message)
        console.log("Notification sent Successfully:", response);
        return res.status(200).send("Notification sent successfully")
    } catch (e) {
        console.error("Error sending notification", e);
        return res.status(500).send("Error sending notification")
    }
})

app.post("/send-multiple", async (req, res) => {
    const { title, body, tokens, data } = req.body;

    if (!title || !body) {
        return res.status(400).send("Title and body are required");
    }

    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
        return res.status(400).send("A list of device tokens is required");
    }

    const message = {
        notification: {
            title: title,
            body: body,
        },
        // Data payload enables tap-to-navigate in Flutter
        data: sanitizeData(data),
        android: {
            priority: 'high',
            notification: {
                clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                sound: 'default',
            },
        },
        apns: {
            payload: {
                aps: {
                    sound: 'default',
                    contentAvailable: true,
                },
            },
        },
        tokens: tokens, // Array of registration tokens
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
        console.error("Error sending notifications", e);
        return res.status(500).send("Error sending notifications");
    }
});



// start the server

const PORT = 3000
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);

})
# ALFM Fund Tracker — Setup Guide

## Prerequisites

- Node.js 20+
- npm 9+
- A Google account (for Firebase + Gmail)
- Firebase CLI: `npm install -g firebase-tools`

---

## Step 1 — Create a Firebase Project

1. Go to [https://console.firebase.google.com/](https://console.firebase.google.com/)
2. Click **Add project** → give it a name (e.g. `alfm-tracker`)
3. Disable Google Analytics if you don't need it → **Create project**

---

## Step 2 — Enable Firestore

1. In the Firebase console, go to **Build → Firestore Database**
2. Click **Create database**
3. Choose **Start in production mode** (rules are already written in `firestore.rules`)
4. Select a region (e.g. `us-central1`) → **Enable**

---

## Step 3 — Enable Firebase Functions

1. Go to **Build → Functions** in the Firebase console
2. Click **Get started** (you may need to upgrade to the Blaze plan — pay-as-you-go)
3. Blaze plan is required for external network calls (scraping) and Cloud Functions v2

---

## Step 4 — Get Your Firebase Config

1. Go to **Project Settings** (gear icon) → **General** tab
2. Scroll to **Your apps** → click **Add app** → choose **Web** (`</>`)
3. Register the app (name it "alfm-web") → copy the config object

---

## Step 5 — Configure Environment Variables (React app)

1. Copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```

2. Fill in `.env` with your Firebase config values:
   ```
   VITE_FIREBASE_API_KEY=AIzaSy...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
   VITE_FIREBASE_APP_ID=1:123:web:abc123
   ```

---

## Step 6 — Update .firebaserc

Open `.firebaserc` and replace `YOUR_PROJECT_ID` with your actual Firebase project ID:

```json
{
  "projects": {
    "default": "your-actual-project-id"
  }
}
```

---

## Step 7 — Install Dependencies

**React app (root directory):**
```bash
npm install
```

**Cloud Functions:**
```bash
cd functions
npm install
cd ..
```

---

## Step 8 — Set Up Gmail App Password

To send emails, you need a Gmail App Password (not your regular password):

1. Go to [https://myaccount.google.com/security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** if not already enabled
3. Go to [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
4. Select app: **Mail**, device: **Other** → name it "ALFM Tracker"
5. Copy the 16-character app password

---

## Step 9 — Set Gmail Secrets in Firebase Functions

Firebase Functions v2 uses Secrets Manager. Set your Gmail credentials:

```bash
# Login to Firebase first
firebase login

# Set secrets (you'll be prompted to enter values)
firebase functions:secrets:set GMAIL_USER
# Enter: your-gmail@gmail.com

firebase functions:secrets:set GMAIL_PASS
# Enter: your-16-char-app-password
```

---

## Step 10 — Deploy to Firebase

```bash
# Build the React app
npm run build

# Deploy everything (hosting + functions + firestore rules)
firebase deploy
```

Or deploy separately:
```bash
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

---

## Step 11 — Seed Initial Data

After deploying, call the `seedInitialData` HTTP function once to populate Firestore:

```bash
# Get your functions URL from the deploy output, or find it in Firebase Console
# It will look like: https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/seedInitialData

curl -X POST https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/seedInitialData
```

Or just visit the URL in your browser (GET request also works).

You should see a JSON response:
```json
{
  "message": "Seed complete",
  "navpuSeeded": 91,
  "navpuSkipped": 0,
  "positionSeeded": true,
  "configSeeded": true,
  "errors": []
}
```

---

## Step 12 — Verify the Dashboard

Visit your Firebase Hosting URL (shown in deploy output):
```
https://YOUR_PROJECT_ID.web.app
```

You should see:
- The NAVPU chart with 91 days of historical data
- Your position (4,684.51 units @ ₱45.48)
- The dividend cycle card
- Today's signal (if it's already been generated)

---

## Daily Schedule

The `dailyNavpuCheck` function runs automatically at **4:00 PM PH time (8:00 AM UTC)** every day.

It will:
1. Scrape the latest NAVPU from alfmmutualfunds.com (or BPI fallback)
2. Run the signal analysis
3. Store results in Firestore
4. Send an email to `jancarloonce11@gmail.com`

---

## Manual Signal Trigger (Testing)

To test the signal manually without waiting for the schedule, you can call the function directly from the Firebase Console:

1. Go to **Functions** in Firebase Console
2. Click on `dailyNavpuCheck` → **Logs** to monitor

Or use the Firebase emulator locally:
```bash
firebase emulators:start --only functions,firestore
```

---

## Local Development

```bash
# Run React dev server
npm run dev

# The app will be at http://localhost:5173
# Note: You still need a real Firebase project for Firestore/Functions
```

---

## Troubleshooting

### Scraper fails
- The ALFM/BPI websites may block automated scraping. If NAVPU is consistently null, you may need to manually enter the NAVPU through the Firebase Console.
- Check the function logs: Firebase Console → Functions → Logs

### Email not sending
- Verify Gmail app password is correct: `firebase functions:secrets:access GMAIL_PASS`
- Make sure 2-Step Verification is enabled on your Gmail account
- Check spam folder

### Functions deploy fails
- Make sure you're on the Blaze (pay-as-you-go) plan
- Node 20 is required — check `functions/package.json` engines field

### CORS errors in browser
- The `recordBuy` function uses `onCall` which handles CORS automatically
- If you see CORS errors, make sure you're using the Firebase SDK's `httpsCallable`, not a direct HTTP call

---

## File Structure

```
alfm-app/
├── src/
│   ├── App.jsx                 # Main dashboard
│   ├── lib/firebase.js         # Firebase SDK init
│   └── components/
│       ├── SignalCard.jsx       # Today's buy signal
│       ├── PositionCard.jsx     # Your position + P&L
│       ├── NavpuCard.jsx        # NAVPU + tier reference
│       ├── DividendCard.jsx     # Dividend cycle tracker
│       ├── NavChart.jsx         # 90-day NAVPU chart
│       ├── BuyLog.jsx           # Buy history table
│       └── BuyModal.jsx         # Record a buy
└── functions/
    ├── index.js                # Cloud Functions (scheduled + callable)
    ├── signalEngine.js         # Pure signal analysis logic
    ├── scraper.js              # Puppeteer-based NAVPU scraper
    └── emailer.js              # Nodemailer email sender
```

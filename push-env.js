const { execSync } = require('child_process');

const envVars = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaSyBN5lkkZfnB0hh2IvKSmhm2FeBZj1YQZnw",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "hyrox-13021.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "hyrox-13021",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "hyrox-13021.firebasestorage.app",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "413830974817",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:413830974817:web:e2d83c79e70650b46d8920"
};

for (const [key, value] of Object.entries(envVars)) {
  try {
    console.log(`Adding ${key}...`);
    // Need --type config for NEXT_PUBLIC_ variables
    execSync(`npx vercel env add ${key} production,preview,development --type config`, { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  } catch (e) {
    console.error(`Failed to add ${key}`);
  }
}

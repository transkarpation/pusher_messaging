import { generateVAPIDKeys } from "web-push";

// A VAPID key pair for Web Push; put the lines into apps/server/.env.
const { publicKey, privateKey } = generateVAPIDKeys();
console.log(`WEB_PUSH_PUBLIC_KEY=${publicKey}\nWEB_PUSH_PRIVATE_KEY=${privateKey}`);

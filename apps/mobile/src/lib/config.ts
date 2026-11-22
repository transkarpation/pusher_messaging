import { Platform } from "react-native";

/**
 * Address of the API server (the Express app from apps/server), set with EXPO_PUBLIC_API_URL
 * in apps/mobile/.env. Without it: localhost, which the Android emulator reaches as 10.0.2.2.
 * On a physical phone use the computer's LAN address, e.g. http://192.168.1.20:3000.
 */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000")
).replace(/\/+$/, "");

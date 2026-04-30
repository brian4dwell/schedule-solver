import { z } from "zod";

const relativeApiBaseUrlSchema = z.string().regex(/^\/[^/].*$/);
const apiBaseUrlSchema = z.union([z.url(), relativeApiBaseUrlSchema]);

const webEnvironmentSchema = z.object({
  INTERNAL_API_BASE_URL: z.url().default("http://127.0.0.1:8000"),
  NEXT_PUBLIC_API_BASE_URL: apiBaseUrlSchema.default("/api"),
});

const webEnvironment = webEnvironmentSchema.parse({
  INTERNAL_API_BASE_URL: process.env.INTERNAL_API_BASE_URL,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});

const isServerRuntime = typeof window === "undefined";
const serverApiBaseUrl = webEnvironment.INTERNAL_API_BASE_URL;
const browserApiBaseUrl = webEnvironment.NEXT_PUBLIC_API_BASE_URL;
const apiBaseUrl = isServerRuntime ? serverApiBaseUrl : browserApiBaseUrl;

export const nextPublicApiBaseUrl = apiBaseUrl;

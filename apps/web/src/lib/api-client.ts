import { createPublicApiClient } from "@queueflow/api-client";

// Falls back to the local dev API — every deployed environment must set
// this explicitly (see .env.example).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

export const publicApi = createPublicApiClient(API_URL);

import { createPublicApiClient } from "@queueflow/api-client";
import { apiBaseUrl } from "./api-url";

export const publicApi = createPublicApiClient(apiBaseUrl());

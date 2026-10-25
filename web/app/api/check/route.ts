import { createUploadHandler } from "../../../lib/check-upload";

export const runtime = "nodejs";
export const maxDuration = 120;
export const POST = createUploadHandler();

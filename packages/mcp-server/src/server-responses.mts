import { z } from "zod";

export const optionalStringArraySchema = z.array(z.string()).optional();

export function renderJson(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

export function renderErrorMessage(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true
  };
}

export function renderUnknownError(error: unknown) {
  return renderErrorMessage(error instanceof Error ? error.message : String(error));
}

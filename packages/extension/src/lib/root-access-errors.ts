const FILE_REFERENCE_LOST_MARKERS = [
  "the requested file could not be read",
  "permission problems that have occurred after a reference to a file was acquired"
];

export const ROOT_ACCESS_RECONNECT_ERROR =
  "Root directory access changed. Reconnect the root directory in Settings, then start the session again.";

export function getUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRootFileReferenceLostError(error: unknown): boolean {
  const message = getUnknownErrorMessage(error).toLowerCase();
  return FILE_REFERENCE_LOST_MARKERS.some((marker) => message.includes(marker));
}

export function normalizeRootAccessErrorMessage(error: unknown): string {
  return isRootFileReferenceLostError(error)
    ? ROOT_ACCESS_RECONNECT_ERROR
    : getUnknownErrorMessage(error);
}

export function isRootAccessUnavailableMessage(message: string): boolean {
  return (
    message === "No root directory selected." ||
    message === "Root directory access is not granted." ||
    message === ROOT_ACCESS_RECONNECT_ERROR ||
    isRootFileReferenceLostError(message)
  );
}

export function isRootAccessUnavailableError(error: unknown): boolean {
  return isRootAccessUnavailableMessage(getUnknownErrorMessage(error));
}

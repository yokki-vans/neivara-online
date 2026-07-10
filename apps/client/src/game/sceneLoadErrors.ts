function isSceneDisposalMessage(value: unknown): boolean {
  return typeof value === "string" && /\bscene\b.*\bdisposed\b/iu.test(value);
}

/** Babylon may reject pending GLB work after React StrictMode disposes its first scene. */
export function isSceneDisposalError(error: unknown): boolean {
  if (isSceneDisposalMessage(error)) return true;
  if (!(error instanceof Error)) return false;
  if (isSceneDisposalMessage(error.message)) return true;
  return "cause" in error && isSceneDisposalError(error.cause);
}

/** Only teardown-triggered disposal is expected; active-scene and unrelated errors stay visible. */
export function shouldIgnoreDisposedSceneLoad(error: unknown, teardownStarted: boolean): boolean {
  return teardownStarted && isSceneDisposalError(error);
}

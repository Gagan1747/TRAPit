export async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    console.error("Unexpected API response", { status: response.status, contentType, url: response.url });
    if (response.status === 413) throw new Error("The upload exceeds the server's request limit. Reduce the image size or contact support.");
    if (response.redirected || response.status === 401 || response.status === 403) throw new Error("Your session may have expired. Sign in again before retrying.");
    throw new Error(`The server returned an unexpected response (${response.status}). Your changes were not confirmed. Please retry.`);
  }
  const payload: T & { error?: string } = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

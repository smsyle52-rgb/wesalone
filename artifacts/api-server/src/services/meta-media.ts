const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v22.0";

function metaAccessToken(): string {
  const token = process.env.META_SYSTEM_USER_TOKEN ?? process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN_UNAVAILABLE");
  return token;
}

export async function fetchMetaMediaStream(mediaId: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
  const token = metaAccessToken();
  const metaResponse = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(mediaId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!metaResponse.ok) {
    throw new Error(`META_MEDIA_LOOKUP_FAILED:${metaResponse.status}`);
  }

  const metaPayload = (await metaResponse.json()) as { url?: string; mime_type?: string };
  const mediaUrl = typeof metaPayload.url === "string" ? metaPayload.url : null;
  if (!mediaUrl) throw new Error("META_MEDIA_URL_MISSING");

  const mediaResponse = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!mediaResponse.ok || !mediaResponse.body) {
    throw new Error(`META_MEDIA_DOWNLOAD_FAILED:${mediaResponse.status}`);
  }

  const contentType =
    mediaResponse.headers.get("content-type") ??
    (typeof metaPayload.mime_type === "string" ? metaPayload.mime_type : "application/octet-stream");

  return { body: mediaResponse.body, contentType };
}

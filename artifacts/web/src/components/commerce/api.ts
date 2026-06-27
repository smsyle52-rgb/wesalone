const API = `${import.meta.env.BASE_URL}api`;

export async function commerceApi(path: string, options?: RequestInit) {
  const response = await fetch(`${API}/${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "تعذر تنفيذ العملية");
  return body;
}

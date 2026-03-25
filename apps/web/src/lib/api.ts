const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
export { API_URL };

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown, message?: string) {
    super(message ?? `API request failed with status ${status}`);
    this.status = status;
    this.payload = payload;
  }
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const cookies = document.cookie.split(";").map((value) => value.trim());
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) {
    return null;
  }
  return decodeURIComponent(cookie.split("=").slice(1).join("="));
}

export function getCsrfToken(): string | null {
  return getCookie("govori_csrf");
}

export async function apiFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    withCsrf?: boolean;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers ?? {}),
  };

  const withCsrf =
    options.withCsrf ??
    ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
  if (withCsrf) {
    const token = getCsrfToken();
    if (token) {
      headers["x-csrf-token"] = token;
    }
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload,
      typeof payload === "string" ? payload : undefined,
    );
  }

  return payload as T;
}

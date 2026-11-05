const BASE: string = import.meta.env.VITE_API_URL ?? "/api";
const TOKEN_KEY = "star_token";

/** Токен сесії. Обгортка try/catch — сховище може бути недоступним */
export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* сховище недоступне */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* сховище недоступне */
    }
  },
};

export interface FieldError {
  rule_id: string | null;
  field: string | null;
  message: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  errors: FieldError[];
  data: Record<string, unknown>;
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = data.code as string | undefined;
    this.errors = (data.errors as FieldError[]) ?? [];
    this.data = data;
  }
  /** Помилки валідації (422) за назвою поля */
  byField(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.errors) {
      const key = e.field ?? "_";
      if (!out[key]) out[key] = e.rule_id ? `${e.message} (${e.rule_id})` : e.message;
    }
    return out;
  }
}

type Options = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit };

export const userTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Єдина точка виклику бекенда: додає токен, часовий пояс, JSON і розбирає помилки */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { json, ...init } = options;
  const headers = new Headers(init.headers);

  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Timezone", userTimezone());

  let body = init.body;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers, body });
  } catch {
    throw new ApiError(0, "Сервер недоступний. Перевірте з'єднання й спробуйте ще раз", { code: "NETWORK" });
  }

  if (!res.ok) {
    let message = res.statusText || "Помилка запиту";
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
      if (typeof data.message === "string") message = data.message;
    } catch {
      /* тіло відповіді не JSON */
    }
    if (res.status === 401 && token) {
      // Сесію завершено або відкликано — повідомляємо AuthContext
      window.dispatchEvent(new Event("star:unauthorized"));
    }
    throw new ApiError(res.status, message, data);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Абсолютна адреса файлу з API (знімки, аватарки) */
export const fileUrl = (path: string) => (path.startsWith("/api") ? BASE.replace(/\/api$/, "") + path : path);

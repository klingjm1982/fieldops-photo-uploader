export type ServiceChannelEnvironment = "sandbox" | "production";

export type ServiceChannelWorkOrder = Record<string, unknown> & {
  Id?: number;
  id?: number;
  TrackingNumber?: string | number;
  trackingNumber?: string | number;
  LocationId?: number;
  ProviderId?: number;
  SubscriberId?: number;
  Attachments?: Array<Record<string, unknown>>;
};

export type ServiceChannelAttachmentResult = {
  Attachments?: Array<{
    Id?: number | null;
    Name?: string;
    Path?: string;
    Description?: string;
    Uri?: string;
  }>;
  Warning?: string;
};

type TokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
};

type CachedToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

let tokenCache: CachedToken | null = null;

function envName(): ServiceChannelEnvironment {
  return process.env.SERVICECHANNEL_ENV === "production" ? "production" : "sandbox";
}

export function serviceChannelApiBase() {
  return envName() === "production"
    ? "https://api.servicechannel.com/v3"
    : "https://sb2api.servicechannel.com/v3";
}

function serviceChannelLoginBase() {
  return envName() === "production"
    ? "https://login.servicechannel.com"
    : "https://sb2login.servicechannel.com";
}

export function serviceChannelUploadsEnabled() {
  return process.env.SERVICECHANNEL_ALLOW_UPLOADS === "true";
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function basicAuthorization() {
  const clientId = required("SERVICECHANNEL_CLIENT_ID");
  const clientSecret = required("SERVICECHANNEL_CLIENT_SECRET");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

async function requestToken(body: URLSearchParams): Promise<CachedToken> {
  const response = await fetch(`${serviceChannelLoginBase()}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthorization(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const text = await response.text();
  let json: TokenResponse | Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // Keep raw response in the error below.
  }

  if (!response.ok || !("access_token" in json) || !json.access_token) {
    throw new Error(`ServiceChannel OAuth failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const expiresIn = Number(json.expires_in ?? 600);
  const token = {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: Date.now() + Math.max(30, expiresIn - 30) * 1000,
  };
  tokenCache = token;
  return token;
}

export async function getServiceChannelAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.accessToken;

  const configuredRefreshToken = process.env.SERVICECHANNEL_REFRESH_TOKEN?.trim();
  const refreshToken = tokenCache?.refreshToken || configuredRefreshToken;
  if (refreshToken) {
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      return (await requestToken(body)).accessToken;
    } catch (error) {
      console.warn("ServiceChannel refresh-token auth failed; trying username/password if configured.", error);
    }
  }

  const username = required("SERVICECHANNEL_USERNAME");
  const password = required("SERVICECHANNEL_PASSWORD");
  const body = new URLSearchParams({ username, password, grant_type: "password" });
  return (await requestToken(body)).accessToken;
}

async function scFetch(path: string, init: RequestInit = {}) {
  const token = await getServiceChannelAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${serviceChannelApiBase()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

async function parseJsonOrText(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function getServiceChannelWorkOrder(workOrderId: string | number) {
  const response = await scFetch(`/workorders/${encodeURIComponent(String(workOrderId))}`);
  const body = await parseJsonOrText(response);
  if (!response.ok) {
    throw new Error(`ServiceChannel WO lookup failed (${response.status}): ${JSON.stringify(body).slice(0, 600)}`);
  }
  return body as ServiceChannelWorkOrder;
}

export async function getServiceChannelWorkOrderAttachments(workOrderId: string | number) {
  const response = await scFetch(
    `/odata/workorders(${encodeURIComponent(String(workOrderId))})/attachments`
  );
  const body = await parseJsonOrText(response);
  if (!response.ok) {
    throw new Error(
      `ServiceChannel attachment verification failed (${response.status}): ${JSON.stringify(body).slice(0, 600)}`
    );
  }
  return body;
}

export async function uploadServiceChannelWorkOrderAttachment(params: {
  workOrderId: string | number;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  if (!serviceChannelUploadsEnabled()) {
    throw new Error(
      "ServiceChannel uploads are disabled. Set SERVICECHANNEL_ALLOW_UPLOADS=true only after sandbox validation."
    );
  }

  const form = new FormData();
  const blob = new Blob([params.bytes], { type: params.mimeType || "application/octet-stream" });
  form.append("file", blob, params.filename);

  const response = await scFetch(
    `/workorders/${encodeURIComponent(String(params.workOrderId))}/attachments`,
    { method: "POST", body: form }
  );
  const body = await parseJsonOrText(response);
  if (!response.ok) {
    throw new Error(
      `ServiceChannel attachment upload failed (${response.status}): ${JSON.stringify(body).slice(0, 600)}`
    );
  }
  return body as ServiceChannelAttachmentResult;
}

export function serviceChannelRuntimeInfo() {
  return {
    environment: envName(),
    apiBase: serviceChannelApiBase(),
    uploadsEnabled: serviceChannelUploadsEnabled(),
    credentialsConfigured: Boolean(
      process.env.SERVICECHANNEL_CLIENT_ID &&
        process.env.SERVICECHANNEL_CLIENT_SECRET &&
        (process.env.SERVICECHANNEL_REFRESH_TOKEN ||
          (process.env.SERVICECHANNEL_USERNAME && process.env.SERVICECHANNEL_PASSWORD))
    ),
  };
}

import * as core from '@actions/core';
import type {
  ImportPreviewOrResult,
  ImportRequirementsResponse,
  ProjectVersionSummary,
  SolutionReleasePreview,
  SolutionReleaseResult,
} from './types';

export class TrayApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'TrayApiError';
  }
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface TrayClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Thin HTTP client for the Tray.ai Projects + Solutions APIs.
 */
export class TrayClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: TrayClientOptions) {
    if (!opts.token) {
      throw new Error('TrayClient requires a non-empty API token.');
    }
    if (!opts.baseUrl) {
      throw new Error('TrayClient requires a non-empty base URL.');
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 500;
    this.sleep = opts.sleep ?? defaultSleep;
    core.setSecret(this.token);
  }

  listVersions(projectId: string): Promise<{ elements?: ProjectVersionSummary[] }> {
    return this.request('GET', `/core/v1/projects/${projectId}/versions`) as Promise<{
      elements?: ProjectVersionSummary[];
    }>;
  }

  async exportVersion(projectId: string, versionNumber: string): Promise<unknown> {
    const path = `/core/v1/projects/${projectId}/versions/${encodeURIComponent(versionNumber)}/export`;
    const raw = await this.requestRaw('GET', path);
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return raw;
      }
    }
    return raw;
  }

  getImportRequirements(projectId: string, body: unknown): Promise<ImportRequirementsResponse> {
    return this.request(
      'POST',
      `/core/v1/projects/${projectId}/imports/requirements`,
      body,
    ) as Promise<ImportRequirementsResponse>;
  }

  previewImport(projectId: string, body: unknown): Promise<ImportPreviewOrResult> {
    return this.request(
      'POST',
      `/core/v1/projects/${projectId}/imports/previews`,
      body,
    ) as Promise<ImportPreviewOrResult>;
  }

  importProject(projectId: string, body: unknown): Promise<ImportPreviewOrResult> {
    return this.request(
      'POST',
      `/core/v1/projects/${projectId}/imports`,
      body,
    ) as Promise<ImportPreviewOrResult>;
  }

  createVersion(
    projectId: string,
    versionNumber: string,
    body: { title: string; description: string },
  ): Promise<{ versionNumber: string }> {
    const path = `/core/v1/projects/${projectId}/versions/${encodeURIComponent(versionNumber)}`;
    return this.request('POST', path, body) as Promise<{ versionNumber: string }>;
  }

  previewSolutionRelease(solutionId: string): Promise<SolutionReleasePreview> {
    return this.request(
      'POST',
      `/core/v1/solutions/${solutionId}/releases/previews`,
    ) as Promise<SolutionReleasePreview>;
  }

  publishSolution(solutionId: string): Promise<SolutionReleaseResult> {
    return this.request(
      'POST',
      `/core/v1/solutions/${solutionId}/releases`,
    ) as Promise<SolutionReleaseResult>;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const raw = await this.requestRaw(method, path, body);
    if (raw === undefined || raw === null || raw === '') {
      return {};
    }
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        throw new TrayApiError(
          `Failed to parse JSON response from ${method} ${path}.`,
          200,
          path,
          raw,
        );
      }
    }
    return raw;
  }

  private async requestRaw(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      'User-Agent': 'tray-sdlc-action',
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let attempt = 0;
    let lastError: Error | undefined;
    while (attempt <= this.maxRetries) {
      try {
        core.debug(`[trayClient] ${method} ${path} (attempt ${attempt + 1})`);
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body: payload,
        });
        if (!response.ok) {
          const text = await safeReadText(response);
          if (RETRYABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
            const delay = this.computeDelay(attempt, response.headers.get('retry-after'));
            core.warning(
              `[trayClient] ${method} ${path} failed with ${response.status}; retrying in ${delay}ms.`,
            );
            await this.sleep(delay);
            attempt += 1;
            continue;
          }
          const parsed = parseErrorBody(text);
          const msg =
            parsed && typeof parsed === 'object' && parsed !== null && 'message' in parsed
              ? String((parsed as { message: unknown }).message)
              : '';
          throw new TrayApiError(
            `Tray API ${method} ${path} failed with status ${response.status}${msg ? `: ${msg}` : ''}`,
            response.status,
            path,
            parsed,
          );
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (response.status === 204) {
          return undefined;
        }
        const text = await response.text();
        if (!text) {
          return undefined;
        }
        if (contentType.includes('application/json')) {
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return text;
          }
        }
        return text;
      } catch (err) {
        if (err instanceof TrayApiError) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt >= this.maxRetries) {
          break;
        }
        const delay = this.computeDelay(attempt, null);
        core.warning(
          `[trayClient] ${method} ${path} threw ${lastError.message}; retrying in ${delay}ms.`,
        );
        await this.sleep(delay);
        attempt += 1;
      }
    }
    throw new TrayApiError(
      `Tray API ${method} ${path} failed after ${this.maxRetries + 1} attempts: ${lastError?.message ?? 'unknown error'}`,
      0,
      path,
      undefined,
    );
  }

  private computeDelay(attempt: number, retryAfterHeader: string | null): number {
    if (retryAfterHeader) {
      const seconds = Number(retryAfterHeader);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 30_000);
      }
    }
    const exp = Math.min(this.retryBaseDelayMs * 2 ** attempt, 10_000);
    const jitter = Math.floor(Math.random() * 100);
    return exp + jitter;
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function parseErrorBody(text: string): unknown {
  if (!text) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return text;
  } catch {
    return text;
  }
}

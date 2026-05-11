import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import * as YAML from 'yaml';
import type {
  AuthMapping,
  ConnectorOrServiceMapping,
  DeploymentConfig,
  DeploymentScope,
} from './types';

const DEFAULT_BASE_URL = 'https://api.tray.io';
const DEFAULT_CONFIG_PATH = '.tray/deployment.yml';

export interface ActionEnvironment {
  getInput: (name: string) => string;
  getBooleanInput: (name: string) => boolean;
  readFile: (filePath: string) => string;
  fileExists: (filePath: string) => boolean;
  workspace: string;
  log: (message: string) => void;
}

export const realEnvironment: ActionEnvironment = {
  getInput: (name) => core.getInput(name) ?? '',
  getBooleanInput: (name) => {
    const raw = core.getInput(name);
    if (!raw) {
      return false;
    }
    return /^(true|1|yes|on)$/i.test(raw.trim());
  },
  readFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
  fileExists: (filePath) => fs.existsSync(filePath),
  workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
  log: (message) => core.info(message),
};

export interface ResolvedApiCredentials {
  sourceToken: string;
  destinationToken: string;
}

/**
 * Resolves bearer tokens for source vs destination Tray workspaces.
 * Each side uses source-api-token / destination-api-token when set, otherwise api-token.
 */
export function resolveApiCredentials(env: ActionEnvironment): ResolvedApiCredentials {
  const common = env.getInput('api-token').trim();
  const sourceToken = env.getInput('source-api-token').trim() || common;
  const destinationToken = env.getInput('destination-api-token').trim() || common;
  if (!sourceToken || !destinationToken) {
    throw new Error(
      'Missing Tray API credentials. Set api-token (used for both workspaces when workspace-specific tokens are omitted), ' +
        'or set source-api-token and destination-api-token for cross-workspace promotion, ' +
        'or combine api-token with one of source-api-token / destination-api-token so both resolve to a non-empty token.',
    );
  }
  return { sourceToken, destinationToken };
}

export function loadConfig(env: ActionEnvironment = realEnvironment): DeploymentConfig {
  const jsonOverrides = parseConfigJson(env.getInput('config-json'));
  const configPathInput = env.getInput('config-path');
  const configPath = configPathInput === '' ? DEFAULT_CONFIG_PATH : configPathInput;
  const fileConfig = configPath ? loadConfigFile(env, configPath) : {};
  const apiBaseUrl =
    pick(
      env.getInput('api-base-url'),
      jsonOverrides.apiBaseUrl,
      fileConfig.apiBaseUrl,
      DEFAULT_BASE_URL,
    ) ?? DEFAULT_BASE_URL;
  const sourceProjectId = requireValue(
    pick(
      env.getInput('source-project-id'),
      jsonOverrides.sourceProjectId,
      fileConfig.sourceProjectId,
      '',
    ),
    'source-project-id',
  );
  const destinationProjectId = requireValue(
    pick(
      env.getInput('destination-project-id'),
      jsonOverrides.destinationProjectId,
      fileConfig.destinationProjectId,
      '',
    ),
    'destination-project-id',
  );
  const sourceVersion = pick(
    env.getInput('source-version'),
    jsonOverrides.sourceVersion,
    fileConfig.sourceVersion,
    'latest',
  );
  const destinationVersion = pick(
    env.getInput('destination-version'),
    jsonOverrides.destinationVersion,
    fileConfig.destinationVersion,
    '',
  );
  const versionTitle = pick(
    env.getInput('version-title'),
    jsonOverrides.versionTitle,
    fileConfig.versionTitle,
    '',
  );
  const versionDescription = pick(
    env.getInput('version-description'),
    jsonOverrides.versionDescription,
    fileConfig.versionDescription,
    '',
  );
  const scope = normalizeScope(
    pick(env.getInput('scope'), jsonOverrides.scope, fileConfig.scope, 'platform-only'),
  );
  const solutionId = pick(
    env.getInput('solution-id'),
    jsonOverrides.solutionId,
    fileConfig.solutionId,
    '',
  );
  if (scope === 'platform-and-solutions' && !solutionId) {
    throw new Error(
      'scope is "platform-and-solutions" but no solution-id was provided (set the input or solutionId in the config file).',
    );
  }
  const authMappings = parseAuthMappings(
    env.getInput('auth-mappings'),
    jsonOverrides.authMappings,
    fileConfig.authMappings,
  );
  const configOverrides = parseConfigOverrides(
    env.getInput('config-overrides'),
    jsonOverrides.configOverrides,
    fileConfig.configOverrides,
  );
  const connectorMappings = parseMappingArray(
    env.getInput('connector-mappings'),
    jsonOverrides.connectorMappings,
    fileConfig.connectorMappings,
    'connector-mappings',
  );
  const serviceMappings = parseMappingArray(
    env.getInput('service-mappings'),
    jsonOverrides.serviceMappings,
    fileConfig.serviceMappings,
    'service-mappings',
  );
  const failOnBreakingChanges = pickBoolean(
    env,
    'fail-on-breaking-changes',
    jsonOverrides.failOnBreakingChanges,
    fileConfig.failOnBreakingChanges,
    true,
  );
  const dryRun = pickBoolean(env, 'dry-run', jsonOverrides.dryRun, fileConfig.dryRun, false);
  const skipRequirementsCheck = pickBoolean(
    env,
    'skip-requirements-check',
    jsonOverrides.skipRequirementsCheck,
    fileConfig.skipRequirementsCheck,
    false,
  );
  return {
    apiBaseUrl,
    configPath,
    sourceProjectId,
    destinationProjectId,
    sourceVersion,
    destinationVersion,
    versionTitle,
    versionDescription,
    scope,
    solutionId,
    authMappings,
    configOverrides,
    connectorMappings,
    serviceMappings,
    failOnBreakingChanges,
    dryRun,
    skipRequirementsCheck,
  };
}

function loadConfigFile(env: ActionEnvironment, configPath: string): Record<string, unknown> {
  const absolute = path.isAbsolute(configPath) ? configPath : path.join(env.workspace, configPath);
  if (!env.fileExists(absolute)) {
    env.log(`No deployment config file found at ${absolute}; using inputs only.`);
    return {};
  }
  env.log(`Loading deployment config from ${absolute}.`);
  const contents = env.readFile(absolute);
  const ext = path.extname(absolute).toLowerCase();
  try {
    if (ext === '.json') {
      return JSON.parse(contents) as Record<string, unknown>;
    }
    return (YAML.parse(contents) as Record<string, unknown>) ?? {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse deployment config at ${absolute}: ${message}`);
  }
}

function requireValue(value: string, name: string): string {
  if (!value) {
    throw new Error(
      `Missing required value "${name}". Set it as an action input or in the deployment config file.`,
    );
  }
  return value;
}

function pick(input: string, jsonValue: unknown, fileValue: unknown, fallback: string): string {
  if (input !== undefined && input !== '') {
    return input;
  }
  if (jsonValue !== undefined && jsonValue !== null) {
    return String(jsonValue);
  }
  if (fileValue !== undefined && fileValue !== null) {
    return String(fileValue);
  }
  return fallback;
}

function pickBoolean(
  env: ActionEnvironment,
  name: string,
  jsonValue: unknown,
  fileValue: unknown,
  fallback: boolean,
): boolean {
  const raw = env.getInput(name);
  if (raw !== '') {
    return /^(true|1|yes|on)$/i.test(raw.trim());
  }
  if (typeof jsonValue === 'boolean') {
    return jsonValue;
  }
  if (typeof fileValue === 'boolean') {
    return fileValue;
  }
  return fallback;
}

function normalizeScope(value: string): DeploymentScope {
  const v = value.trim().toLowerCase();
  if (v === 'platform-and-solutions' || v === 'platform+solutions' || v === 'solutions') {
    return 'platform-and-solutions';
  }
  if (v === '' || v === 'platform' || v === 'platform-only') {
    return 'platform-only';
  }
  throw new Error(
    `Unknown scope "${value}". Expected "platform-only" or "platform-and-solutions".`,
  );
}

function parseAuthMappings(input: string, jsonValue: unknown, fileValue: unknown): AuthMapping[] {
  if (input) {
    const parsed = tryParseJson(input, 'auth-mappings');
    if (!Array.isArray(parsed)) {
      throw new Error('auth-mappings must be a JSON array.');
    }
    return parsed.map((entry, idx) => validateAuthMapping(entry, idx));
  }
  if (Array.isArray(jsonValue)) {
    return jsonValue.map((entry, idx) => validateAuthMapping(entry, idx));
  }
  if (Array.isArray(fileValue)) {
    return fileValue.map((entry, idx) => validateAuthMapping(entry, idx));
  }
  return [];
}

function validateAuthMapping(entry: unknown, idx: number): AuthMapping {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`auth-mappings[${idx}] must be an object.`);
  }
  const e = entry as Record<string, unknown>;
  if (typeof e.authExportId !== 'string' || !e.authExportId) {
    throw new Error(`auth-mappings[${idx}].authExportId is required.`);
  }
  if (typeof e.authenticationId !== 'string' || !e.authenticationId) {
    throw new Error(`auth-mappings[${idx}].authenticationId is required.`);
  }
  return { authExportId: e.authExportId, authenticationId: e.authenticationId };
}

function parseConfigOverrides(
  input: string,
  jsonValue: unknown,
  fileValue: unknown,
): Record<string, unknown> {
  if (input) {
    const parsed = tryParseJson(input, 'config-overrides');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config-overrides must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  }
  if (jsonValue && typeof jsonValue === 'object' && !Array.isArray(jsonValue)) {
    return jsonValue as Record<string, unknown>;
  }
  if (fileValue && typeof fileValue === 'object' && !Array.isArray(fileValue)) {
    return fileValue as Record<string, unknown>;
  }
  return {};
}

function parseMappingArray(
  input: string,
  jsonValue: unknown,
  fileValue: unknown,
  name: string,
): ConnectorOrServiceMapping[] {
  if (input) {
    const parsed = tryParseJson(input, name);
    if (!Array.isArray(parsed)) {
      throw new Error(`${name} must be a JSON array.`);
    }
    return parsed.map((entry, idx) => validateMapping(entry, idx, name));
  }
  if (Array.isArray(jsonValue)) {
    return jsonValue.map((entry, idx) => validateMapping(entry, idx, name));
  }
  if (Array.isArray(fileValue)) {
    return fileValue.map((entry, idx) => validateMapping(entry, idx, name));
  }
  return [];
}

function validateMapping(entry: unknown, idx: number, name: string): ConnectorOrServiceMapping {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`${name}[${idx}] must be an object.`);
  }
  const e = entry as Record<string, unknown>;
  const from = e.from;
  const to = e.to;
  if (!from || !to || typeof from !== 'object' || typeof to !== 'object') {
    throw new Error(`${name}[${idx}] requires both "from" and "to".`);
  }
  const f = from as Record<string, unknown>;
  const t = to as Record<string, unknown>;
  if (typeof f.name !== 'string' || typeof f.version !== 'string') {
    throw new Error(`${name}[${idx}].from must have string name and version.`);
  }
  if (typeof t.name !== 'string' || typeof t.version !== 'string') {
    throw new Error(`${name}[${idx}].to must have string name and version.`);
  }
  return {
    from: { name: f.name, version: f.version },
    to: { name: t.name, version: t.version },
  };
}

function tryParseJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse ${name} as JSON: ${message}`);
  }
}

interface ConfigJsonOverrides {
  apiBaseUrl?: string;
  sourceProjectId?: string;
  destinationProjectId?: string;
  sourceVersion?: string;
  destinationVersion?: string;
  versionTitle?: string;
  versionDescription?: string;
  scope?: string;
  solutionId?: string;
  authMappings?: unknown;
  configOverrides?: unknown;
  connectorMappings?: unknown;
  serviceMappings?: unknown;
  failOnBreakingChanges?: boolean;
  dryRun?: boolean;
  skipRequirementsCheck?: boolean;
}

function parseConfigJson(value: string): ConfigJsonOverrides {
  if (!value) {
    return {};
  }
  const parsed = tryParseJson(value, 'config-json');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('config-json must be a JSON object.');
  }
  const obj = parsed as Record<string, unknown>;
  const forbidden = ['apiToken', 'sourceApiToken', 'destinationApiToken'];
  for (const key of forbidden) {
    if (key in obj) {
      throw new Error(
        `Do not include ${key} in config-json. Pass tokens via action inputs instead.`,
      );
    }
  }
  return parsed as ConfigJsonOverrides;
}

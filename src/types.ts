export type DeploymentScope = 'platform-only' | 'platform-and-solutions';

export interface AuthMapping {
  authExportId: string;
  authenticationId: string;
}

export interface ConnectorOrServiceMapping {
  from: { name: string; version: string };
  to: { name: string; version: string };
}

export interface ProjectVersionSummary {
  versionNumber: string;
  created?: string;
}

export interface AuthenticationsRequirement {
  authExportId: string;
  service?: { name: string; version: string };
  resolvedAuthentication?: { id: string };
  scopes?: string[];
}

export interface ImportRequirementsResponse {
  unresolvedAuthentications?: boolean;
  newConfigKeys?: boolean;
  authenticationsRequirements?: AuthenticationsRequirement[];
}

export interface ProjectImpact {
  config?: { created?: unknown[]; updated?: unknown[]; removed?: unknown[] };
  workflows?: {
    created?: { name: string }[];
    updated?: { name: string }[];
    removed?: { name: string }[];
  };
}

export interface SolutionImpact {
  changeType?: string;
  breakingChanges?: boolean;
  requiresNewUserInput?: boolean;
  requiresNewSystemInput?: boolean;
}

export interface ImportPreviewOrResult {
  importMetadata?: unknown;
  projectImpact?: ProjectImpact;
  solutionImpact?: SolutionImpact;
}

export interface SolutionReleasePreview {
  breakingChanges?: boolean;
  requiresNewUserInput?: boolean;
  requiresNewSystemInput?: boolean;
}

export interface SolutionReleaseResult {
  releaseId?: string;
  breakingChanges?: boolean;
}

export interface PipelineResult {
  sourceVersionNumber: string;
  destinationVersionNumber: string;
  importMetadata?: unknown;
  projectImpact?: ProjectImpact;
  solutionImpact?: SolutionImpact;
  releaseId?: string | undefined;
  dryRun: boolean;
}

export interface DeploymentConfig {
  apiBaseUrl: string;
  configPath: string;
  sourceProjectId: string;
  destinationProjectId: string;
  sourceVersion: string;
  destinationVersion: string;
  versionTitle: string;
  versionDescription: string;
  scope: DeploymentScope;
  solutionId: string;
  authMappings: AuthMapping[];
  configOverrides: Record<string, unknown>;
  connectorMappings: ConnectorOrServiceMapping[];
  serviceMappings: ConnectorOrServiceMapping[];
  failOnBreakingChanges: boolean;
  dryRun: boolean;
  skipRequirementsCheck: boolean;
}

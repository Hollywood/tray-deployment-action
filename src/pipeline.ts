import * as core from '@actions/core';
import type { TrayClient } from './trayClient';
import type {
  DeploymentConfig,
  ImportRequirementsResponse,
  PipelineResult,
  ProjectVersionSummary,
} from './types';
import { writeSummary } from './summary';

export interface PipelineLogger {
  info: (m: string) => void;
  warning: (m: string) => void;
  error: (m: string) => void;
  startGroup: (name: string) => void;
  endGroup: () => void;
}

const defaultLogger: PipelineLogger = {
  info: (m) => core.info(m),
  warning: (m) => core.warning(m),
  error: (m) => core.error(m),
  startGroup: (name) => core.startGroup(name),
  endGroup: () => core.endGroup(),
};

/**
 * Runs the Tray.ai SDLC promotion pipeline.
 * Source workspace calls use `sourceClient`; destination (import, version, solution) use `destinationClient`.
 */
export async function runPipeline(
  sourceClient: TrayClient,
  destinationClient: TrayClient,
  config: DeploymentConfig,
  logger: PipelineLogger = defaultLogger,
): Promise<PipelineResult> {
  const resolvedSourceVersion = await resolveSourceVersion(sourceClient, config, logger);
  logger.startGroup(`Export source version ${resolvedSourceVersion}`);
  const exportedProjectJson = await sourceClient.exportVersion(
    config.sourceProjectId,
    resolvedSourceVersion,
  );
  logger.info(`Exported version ${resolvedSourceVersion} from ${config.sourceProjectId}.`);
  logger.endGroup();
  let requirements: ImportRequirementsResponse | undefined;
  if (!config.skipRequirementsCheck) {
    logger.startGroup('Check import requirements');
    requirements = await destinationClient.getImportRequirements(config.destinationProjectId, {
      exportedProjectJson,
      connectorMapping: config.connectorMappings,
      serviceMapping: config.serviceMappings,
    });
    verifyAuthMappings(requirements, config, logger);
    logger.endGroup();
  } else {
    logger.info('Skipping import requirements check (skip-requirements-check=true).');
  }
  const importPayload = {
    authenticationResolution: config.authMappings,
    configOverride: config.configOverrides,
    exportedProjectJson,
    connectorMapping: config.connectorMappings,
    serviceMapping: config.serviceMappings,
  };
  logger.startGroup('Preview import');
  const preview = await destinationClient.previewImport(config.destinationProjectId, importPayload);
  reportImpact('preview', preview, logger);
  if (config.failOnBreakingChanges && preview.solutionImpact?.breakingChanges) {
    throw new Error(
      'Import preview reported breaking solution changes; aborting because fail-on-breaking-changes=true.',
    );
  }
  logger.endGroup();
  if (config.dryRun) {
    logger.warning(
      'dry-run=true: stopping after preview. No import or version creation performed.',
    );
    await writeSummary({
      sourceProjectId: config.sourceProjectId,
      destinationProjectId: config.destinationProjectId,
      resolvedSourceVersion,
      scope: config.scope,
      dryRun: true,
      requirements,
      preview,
    });
    return {
      sourceVersionNumber: resolvedSourceVersion,
      destinationVersionNumber: '',
      importMetadata: preview.importMetadata,
      projectImpact: preview.projectImpact,
      solutionImpact: preview.solutionImpact,
      dryRun: true,
    };
  }
  logger.startGroup('Import project');
  const importResult = await destinationClient.importProject(
    config.destinationProjectId,
    importPayload,
  );
  reportImpact('import', importResult, logger);
  logger.endGroup();
  const destinationVersion = config.destinationVersion || resolvedSourceVersion;
  logger.startGroup(`Create destination version ${destinationVersion}`);
  const createdVersion = await destinationClient.createVersion(
    config.destinationProjectId,
    destinationVersion,
    {
      title: config.versionTitle || `Promoted from source version ${resolvedSourceVersion}`,
      description:
        config.versionDescription ||
        `Created by tray-sdlc-action from project ${config.sourceProjectId} version ${resolvedSourceVersion}.`,
    },
  );
  logger.info(
    `Created destination version ${createdVersion.versionNumber} in ${config.destinationProjectId}.`,
  );
  logger.endGroup();
  let solutionPreview;
  let solutionRelease;
  if (config.scope === 'platform-and-solutions' && config.solutionId) {
    logger.startGroup('Solution publish preview');
    solutionPreview = await destinationClient.previewSolutionRelease(config.solutionId);
    logger.info(
      `Solution preview: breakingChanges=${solutionPreview.breakingChanges} requiresNewUserInput=${solutionPreview.requiresNewUserInput}`,
    );
    if (config.failOnBreakingChanges && solutionPreview.breakingChanges) {
      throw new Error(
        'Solution publish preview reported breaking changes; aborting because fail-on-breaking-changes=true. ' +
          'The project import has already been applied; consider rolling back manually.',
      );
    }
    logger.endGroup();
    logger.startGroup('Publish solution');
    solutionRelease = await destinationClient.publishSolution(config.solutionId);
    logger.info(`Published solution release ${solutionRelease.releaseId ?? '(no id returned)'}.`);
    logger.endGroup();
  }
  await writeSummary({
    sourceProjectId: config.sourceProjectId,
    destinationProjectId: config.destinationProjectId,
    resolvedSourceVersion,
    destinationVersion: createdVersion.versionNumber,
    scope: config.scope,
    dryRun: false,
    requirements,
    preview,
    importResult,
    solutionPreview,
    solutionRelease,
  });
  return {
    sourceVersionNumber: resolvedSourceVersion,
    destinationVersionNumber: createdVersion.versionNumber,
    importMetadata: importResult.importMetadata,
    projectImpact: importResult.projectImpact,
    solutionImpact: importResult.solutionImpact,
    releaseId: solutionRelease?.releaseId,
    dryRun: false,
  };
}

async function resolveSourceVersion(
  sourceClient: TrayClient,
  config: DeploymentConfig,
  logger: PipelineLogger,
): Promise<string> {
  const requested = (config.sourceVersion || 'latest').trim();
  if (requested && requested.toLowerCase() !== 'latest') {
    logger.info(`Using requested source version ${requested}.`);
    return requested;
  }
  logger.startGroup('Resolve latest source version');
  const list = await sourceClient.listVersions(config.sourceProjectId);
  const elements = list.elements ?? [];
  if (elements.length === 0) {
    throw new Error(
      `No versions found for source project ${config.sourceProjectId}. Create a version in the source workspace before running this action.`,
    );
  }
  const latest = pickLatest(elements);
  logger.info(
    `Resolved latest source version: ${latest.versionNumber} (created ${latest.created ?? 'unknown'}).`,
  );
  logger.endGroup();
  return latest.versionNumber;
}

/**
 * Picks the newest version. Prefers `created` ISO timestamps when available.
 */
export function pickLatest(elements: ProjectVersionSummary[]): ProjectVersionSummary {
  if (elements.length === 1) {
    return elements[0];
  }
  const withDates = elements.filter((e) => Boolean(e.created));
  if (withDates.length === elements.length) {
    return [...elements].sort(
      (a, b) => Date.parse(b.created ?? '') - Date.parse(a.created ?? ''),
    )[0];
  }
  const numeric = elements.every((e) => /^\d+$/.test(e.versionNumber));
  if (numeric) {
    return [...elements].sort((a, b) => Number(b.versionNumber) - Number(a.versionNumber))[0];
  }
  return elements[elements.length - 1] as ProjectVersionSummary;
}

function verifyAuthMappings(
  requirements: ImportRequirementsResponse,
  config: DeploymentConfig,
  logger: PipelineLogger,
): void {
  const provided = new Set(config.authMappings.map((m) => m.authExportId));
  const required = (requirements.authenticationsRequirements ?? [])
    .filter((r) => !r.resolvedAuthentication)
    .map((r) => r.authExportId);
  const missing = required.filter((id) => !provided.has(id));
  if (requirements.unresolvedAuthentications && missing.length > 0) {
    throw new Error(
      `Import requirements report unresolved authentications. Missing auth-mappings entries for: ${missing
        .map((m) => `"${m}"`)
        .join(', ')}.`,
    );
  }
  if (requirements.unresolvedAuthentications) {
    logger.warning(
      'unresolvedAuthentications=true but all required authExportIds are covered by auth-mappings.',
    );
  }
  if (requirements.newConfigKeys) {
    logger.info(
      'Import requirements report new config keys. Ensure config-overrides covers any required values.',
    );
  }
}

function reportImpact(
  stage: string,
  result: { projectImpact?: unknown; solutionImpact?: unknown },
  logger: PipelineLogger,
): void {
  const project = result.projectImpact as
    | {
        config?: { created?: unknown[]; updated?: unknown[]; removed?: unknown[] };
        workflows?: { created?: unknown[]; updated?: unknown[]; removed?: unknown[] };
      }
    | undefined;
  if (project) {
    const cfg = project.config ?? {};
    const wf = project.workflows ?? {};
    logger.info(
      `[${stage}] project impact: workflows created=${len(wf.created)} updated=${len(wf.updated)} removed=${len(wf.removed)}; ` +
        `config created=${len(cfg.created)} updated=${len(cfg.updated)} removed=${len(cfg.removed)}.`,
    );
  }
  const solution = result.solutionImpact as
    | { changeType?: string; breakingChanges?: boolean; requiresNewUserInput?: boolean }
    | undefined;
  if (solution) {
    logger.info(
      `[${stage}] solution impact: changeType=${solution.changeType ?? 'unknown'} ` +
        `breakingChanges=${Boolean(solution.breakingChanges)} ` +
        `requiresNewUserInput=${Boolean(solution.requiresNewUserInput)}.`,
    );
  }
}

function len(arr: unknown): number {
  return Array.isArray(arr) ? arr.length : 0;
}

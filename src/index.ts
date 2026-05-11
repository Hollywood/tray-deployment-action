import * as core from '@actions/core';
import { loadConfig, realEnvironment, resolveApiCredentials } from './config';
import { runPipeline } from './pipeline';
import { TrayApiError, TrayClient } from './trayClient';

async function run(): Promise<void> {
  try {
    const { sourceToken, destinationToken } = resolveApiCredentials(realEnvironment);
    const config = loadConfig();
    core.info(
      `Tray SDLC: promoting project ${config.sourceProjectId} -> ${config.destinationProjectId} ` +
        `(version=${config.sourceVersion}, scope=${config.scope}, dryRun=${config.dryRun}).`,
    );
    const sourceClient = new TrayClient({
      baseUrl: config.apiBaseUrl,
      token: sourceToken,
    });
    const destinationClient = new TrayClient({
      baseUrl: config.apiBaseUrl,
      token: destinationToken,
    });
    const result = await runPipeline(sourceClient, destinationClient, config);
    core.setOutput('source-version-number', result.sourceVersionNumber);
    core.setOutput('destination-version-number', result.destinationVersionNumber);
    core.setOutput(
      'import-metadata-json',
      result.importMetadata ? JSON.stringify(result.importMetadata) : '',
    );
    core.setOutput(
      'project-impact-json',
      result.projectImpact ? JSON.stringify(result.projectImpact) : '',
    );
    core.setOutput(
      'solution-impact-json',
      result.solutionImpact ? JSON.stringify(result.solutionImpact) : '',
    );
    core.setOutput('release-id', result.releaseId ?? '');
    if (result.dryRun) {
      core.info('Dry run completed successfully.');
    } else {
      core.info(
        `Deployment completed: source ${result.sourceVersionNumber} -> destination ${result.destinationVersionNumber}.`,
      );
    }
  } catch (err) {
    if (err instanceof TrayApiError) {
      core.setFailed(
        `Tray API error (${err.status}) on ${err.endpoint}: ${err.message}` +
          (err.body ? ` | body: ${JSON.stringify(err.body)}` : ''),
      );
      return;
    }
    if (err instanceof Error) {
      core.setFailed(err.message);
      if (err.stack) {
        core.debug(err.stack);
      }
      return;
    }
    core.setFailed(`Unknown error: ${String(err)}`);
  }
}

void run();

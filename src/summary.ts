import * as core from '@actions/core';
import type {
  ImportPreviewOrResult,
  ImportRequirementsResponse,
  SolutionReleasePreview,
  SolutionReleaseResult,
} from './types';

export interface SummaryInputs {
  sourceProjectId: string;
  destinationProjectId: string;
  resolvedSourceVersion: string;
  destinationVersion?: string;
  scope: string;
  dryRun: boolean;
  requirements?: ImportRequirementsResponse;
  preview?: ImportPreviewOrResult;
  importResult?: ImportPreviewOrResult;
  solutionPreview?: SolutionReleasePreview;
  solutionRelease?: SolutionReleaseResult;
}

/**
 * Renders a Markdown job summary documenting what the pipeline did.
 */
export async function writeSummary(inputs: SummaryInputs): Promise<void> {
  const md = renderMarkdown(inputs);
  core.info(stripMarkdown(md));
  if (!process.env.GITHUB_STEP_SUMMARY) {
    return;
  }
  try {
    await core.summary.addRaw(md, true).write();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.warning(`Failed to write job summary: ${message}`);
  }
}

function renderMarkdown(inputs: SummaryInputs): string {
  const lines: string[] = [];
  lines.push('## Tray.ai SDLC deployment');
  lines.push('');
  lines.push(`- **Mode**: ${inputs.dryRun ? 'dry run (preview only)' : 'live deployment'}`);
  lines.push(`- **Scope**: \`${inputs.scope}\``);
  lines.push(
    `- **Source project**: \`${inputs.sourceProjectId}\` @ \`${inputs.resolvedSourceVersion}\``,
  );
  lines.push(
    `- **Destination project**: \`${inputs.destinationProjectId}\`` +
      (inputs.destinationVersion ? ` @ \`${inputs.destinationVersion}\`` : ''),
  );
  lines.push('');
  if (inputs.requirements) {
    lines.push('### Import requirements');
    lines.push(
      `- Unresolved authentications: \`${Boolean(inputs.requirements.unresolvedAuthentications)}\``,
    );
    lines.push(`- New config keys: \`${Boolean(inputs.requirements.newConfigKeys)}\``);
    const reqs = inputs.requirements.authenticationsRequirements ?? [];
    if (reqs.length > 0) {
      lines.push('');
      lines.push('| authExportId | service | resolved | scopes |');
      lines.push('| --- | --- | --- | --- |');
      for (const r of reqs) {
        const service = r.service ? `${r.service.name}@${r.service.version}` : '-';
        const resolved = r.resolvedAuthentication?.id ?? '-';
        const scopes = (r.scopes ?? []).join(', ') || '-';
        lines.push(`| \`${r.authExportId}\` | ${service} | \`${resolved}\` | ${scopes} |`);
      }
    }
    lines.push('');
  }
  const impactSource = inputs.importResult ?? inputs.preview;
  if (impactSource?.projectImpact) {
    lines.push('### Project impact');
    lines.push(...renderProjectImpact(impactSource.projectImpact));
    lines.push('');
  }
  if (impactSource?.solutionImpact) {
    lines.push('### Solution impact');
    lines.push(...renderSolutionImpact(impactSource.solutionImpact));
    lines.push('');
  }
  if (inputs.solutionPreview) {
    lines.push('### Solution publish preview');
    lines.push(`- Breaking changes: \`${Boolean(inputs.solutionPreview.breakingChanges)}\``);
    lines.push(
      `- Requires new user input: \`${Boolean(inputs.solutionPreview.requiresNewUserInput)}\``,
    );
    lines.push(
      `- Requires new system input: \`${Boolean(inputs.solutionPreview.requiresNewSystemInput)}\``,
    );
    lines.push('');
  }
  if (inputs.solutionRelease?.releaseId) {
    lines.push('### Solution release');
    lines.push(`- Release ID: \`${inputs.solutionRelease.releaseId}\``);
    lines.push(`- Breaking changes: \`${Boolean(inputs.solutionRelease.breakingChanges)}\``);
    lines.push('');
  }
  return lines.join('\n');
}

function renderProjectImpact(
  impact: NonNullable<ImportPreviewOrResult['projectImpact']>,
): string[] {
  const lines: string[] = [];
  const cfg = impact.config ?? {};
  const wf = impact.workflows ?? {};
  lines.push('| Category | Created | Updated | Removed |');
  lines.push('| --- | ---: | ---: | ---: |');
  lines.push(`| Config | ${count(cfg.created)} | ${count(cfg.updated)} | ${count(cfg.removed)} |`);
  lines.push(`| Workflows | ${count(wf.created)} | ${count(wf.updated)} | ${count(wf.removed)} |`);
  if ((wf.created ?? []).length || (wf.updated ?? []).length || (wf.removed ?? []).length) {
    lines.push('');
    lines.push('Workflow changes:');
    for (const w of wf.created ?? []) {
      lines.push(`- created: ${w.name}`);
    }
    for (const w of wf.updated ?? []) {
      lines.push(`- updated: ${w.name}`);
    }
    for (const w of wf.removed ?? []) {
      lines.push(`- removed: ${w.name}`);
    }
  }
  return lines;
}

function renderSolutionImpact(
  impact: NonNullable<ImportPreviewOrResult['solutionImpact']>,
): string[] {
  const lines: string[] = [];
  lines.push(`- Change type: \`${impact.changeType ?? 'unknown'}\``);
  lines.push(`- Breaking changes: \`${Boolean(impact.breakingChanges)}\``);
  lines.push(`- Requires new user input: \`${Boolean(impact.requiresNewUserInput)}\``);
  lines.push(`- Requires new system input: \`${Boolean(impact.requiresNewSystemInput)}\``);
  return lines;
}

function count(arr: unknown): number {
  return Array.isArray(arr) ? arr.length : 0;
}

function stripMarkdown(md: string): string {
  return md.replace(/[`*]/g, '');
}

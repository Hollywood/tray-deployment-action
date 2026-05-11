import { describe, expect, it } from 'vitest';
import { resolveApiCredentials, type ActionEnvironment } from './config';

function makeEnv(inputs: Record<string, string>): ActionEnvironment {
  return {
    getInput: (name) => inputs[name] ?? '',
    getBooleanInput: () => false,
    readFile: () => '',
    fileExists: () => false,
    workspace: '/tmp',
    log: () => {},
  };
}

describe('resolveApiCredentials', () => {
  it('uses api-token for both sides when workspace tokens are omitted', () => {
    const env = makeEnv({ 'api-token': 'common-secret' });
    expect(resolveApiCredentials(env)).toEqual({
      sourceToken: 'common-secret',
      destinationToken: 'common-secret',
    });
  });

  it('uses separate tokens for cross-workspace promotion', () => {
    const env = makeEnv({
      'api-token': '',
      'source-api-token': 'src-token',
      'destination-api-token': 'dst-token',
    });
    expect(resolveApiCredentials(env)).toEqual({
      sourceToken: 'src-token',
      destinationToken: 'dst-token',
    });
  });

  it('falls back to api-token per side when only one workspace token is set', () => {
    const env = makeEnv({
      'api-token': 'common',
      'destination-api-token': 'dst-only',
    });
    expect(resolveApiCredentials(env)).toEqual({
      sourceToken: 'common',
      destinationToken: 'dst-only',
    });
  });

  it('throws when no token can be resolved for a side', () => {
    const env = makeEnv({ 'api-token': '', 'source-api-token': 'only-src' });
    expect(() => resolveApiCredentials(env)).toThrow(/Missing Tray API credentials/);
  });
});

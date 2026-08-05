/**
 * projectRootSearch.test.ts
 * Tests for project root discovery and access-denial reporting.
 *
 * The permission-denial cases are a regression guard for the July 2026 outage:
 * the root probe used fs.existsSync, which collapses every errno to `false`. A TCC
 * folder-service denial therefore looked identical to an absent package.json, the
 * upward walk exhausted its depth limit, and findProjectRoot — called at module top
 * level by index.ts — threw "Project root not found within 10 directory levels".
 * That message names neither the cause nor the fix, so the server presented as an
 * unexplained "Server disconnected" startup crash.
 */

import fs from 'node:fs';
import {
  type AccessDenial,
  describeAccessDenial,
  locateProjectRoot,
} from './projectRootSearch.js';

jest.mock('node:fs');

const mockReadFileSync = fs.readFileSync as jest.MockedFunction<
  typeof fs.readFileSync
>;

/** Builds the errno-bearing error Node throws for a refused read. */
function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: refused`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

const GATED_START = '/Users/x/Documents/apple-mcp/src/utils';

describe('locateProjectRoot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the directory holding this project package.json', () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ name: 'apple-events-mcp' }),
    );

    expect(locateProjectRoot(GATED_START)).toBe(GATED_START);
  });

  it('walks upward past directories with no package.json', () => {
    mockReadFileSync
      .mockImplementationOnce(() => {
        throw errnoError('ENOENT');
      })
      .mockImplementationOnce(() => {
        throw errnoError('ENOENT');
      })
      .mockReturnValue(JSON.stringify({ name: 'apple-events-mcp' }));

    expect(locateProjectRoot(GATED_START)).toBe('/Users/x/Documents/apple-mcp');
  });

  it('walks upward past a package.json belonging to another project', () => {
    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify({ name: 'some-other-package' }))
      .mockReturnValue(JSON.stringify({ name: 'apple-events-mcp' }));

    expect(locateProjectRoot(GATED_START)).toBe(
      '/Users/x/Documents/apple-mcp/src',
    );
  });

  it('treats a malformed package.json as another project and keeps walking', () => {
    mockReadFileSync
      .mockReturnValueOnce('{ not json')
      .mockReturnValue(JSON.stringify({ name: 'apple-events-mcp' }));

    expect(locateProjectRoot(GATED_START)).toBe(
      '/Users/x/Documents/apple-mcp/src',
    );
  });

  it('records EPERM denials instead of discarding the reason', () => {
    mockReadFileSync.mockImplementation(() => {
      throw errnoError('EPERM');
    });
    const denials: AccessDenial[] = [];

    expect(locateProjectRoot(GATED_START, 10, denials)).toBeUndefined();
    expect(denials.length).toBeGreaterThan(0);
    expect(denials[0].code).toBe('EPERM');
    expect(denials[0].path).toContain('package.json');
  });

  it('records EACCES denials too', () => {
    mockReadFileSync.mockImplementation(() => {
      throw errnoError('EACCES');
    });
    const denials: AccessDenial[] = [];

    locateProjectRoot(GATED_START, 10, denials);
    expect(denials[0].code).toBe('EACCES');
  });

  it('does not record a plain missing file as a denial', () => {
    mockReadFileSync.mockImplementation(() => {
      throw errnoError('ENOENT');
    });
    const denials: AccessDenial[] = [];

    expect(locateProjectRoot(GATED_START, 10, denials)).toBeUndefined();
    expect(denials).toHaveLength(0);
  });

  it('stops at the filesystem root rather than looping', () => {
    mockReadFileSync.mockImplementation(() => {
      throw errnoError('ENOENT');
    });

    expect(locateProjectRoot('/', 10)).toBeUndefined();
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });
});

describe('describeAccessDenial', () => {
  const denial = (code: string): AccessDenial => ({
    path: '/Users/x/Documents/apple-mcp/package.json',
    code,
  });

  it('names the TCC folder service and the real fix', () => {
    const message = describeAccessDenial(denial('EPERM'), GATED_START);

    expect(message).toContain('EPERM');
    expect(message).toContain('~/Documents');
    expect(message).toContain('claude_desktop_config.json');
  });

  it('does not blame Full Disk Access for a folder-service denial', () => {
    // FDA does not satisfy SystemPolicyDocumentsFolder for a spawned child, so the
    // message must say so rather than sending the user to that toggle.
    expect(describeAccessDenial(denial('EPERM'), GATED_START)).toContain(
      'Full Disk Access does NOT lift this',
    );
  });

  it.each(['Documents', 'Desktop', 'Downloads'])(
    'recognizes ~/%s as TCC-gated',
    (folder) => {
      const message = describeAccessDenial(
        denial('EPERM'),
        `/Users/x/${folder}/apple-mcp/src/utils`,
      );
      expect(message).toContain(`~/${folder}`);
    },
  );

  it('omits relocation advice outside the gated folders', () => {
    const message = describeAccessDenial(
      denial('EPERM'),
      '/Users/x/Developer/apple-mcp/src/utils',
    );

    expect(message).toContain('privacy layer');
    expect(message).not.toContain('~/Documents');
  });

  it('distinguishes an ordinary file-mode denial from a TCC denial', () => {
    const message = describeAccessDenial(denial('EACCES'), GATED_START);

    expect(message).toContain('EACCES');
    expect(message).toContain('ownership and mode');
    expect(message).not.toContain('Full Disk Access');
  });

  it('does not match a directory merely named like a gated folder', () => {
    const message = describeAccessDenial(
      denial('EPERM'),
      '/Users/x/MyDocuments/apple-mcp',
    );

    expect(message).not.toContain('~/MyDocuments');
    expect(message).toContain('privacy layer');
  });
});

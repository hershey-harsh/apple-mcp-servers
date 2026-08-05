/**
 * projectRootSearch.ts
 * Pure project-root discovery: given a starting directory, walk upward looking for
 * this project's package.json.
 *
 * Deliberately free of `import.meta` so it can be unit-tested — projectUtils.ts owns
 * the environment-specific "where is this module" question, which cannot be loaded
 * under the CJS test transform.
 */

import fs from 'node:fs';
import path from 'node:path';
import { FILE_SYSTEM } from './constants.js';

/**
 * Home subfolders gated by their own TCC service (SystemPolicyDocumentsFolder and
 * friends). A denial under one of these is a folder-service denial — and critically,
 * Full Disk Access on the host app does NOT satisfy it for a spawned child process,
 * so "grant FDA" is the wrong remedy to report.
 */
const TCC_GATED_FOLDERS = ['Documents', 'Desktop', 'Downloads'] as const;

/**
 * Errnos meaning "this path may exist, but the OS refused to let us look".
 * EPERM is the TCC denial; EACCES is an ordinary file-mode problem.
 */
const PERMISSION_ERROR_CODES = new Set(['EPERM', 'EACCES']);

/** A read the OS refused during the upward walk. */
export interface AccessDenial {
  path: string;
  code: string;
}

/**
 * Walks upward from `startDir` looking for this project's package.json.
 *
 * @returns The project root when found, otherwise `undefined`. Any refused reads are
 * appended to `denials` so the caller can distinguish "not there" from "not allowed".
 */
export function locateProjectRoot(
  startDir: string,
  maxDepth = FILE_SYSTEM.MAX_DIRECTORY_SEARCH_DEPTH,
  denials: AccessDenial[] = [],
): string | undefined {
  let currentDir = startDir;
  let depth = 0;

  while (depth < maxDepth) {
    if (isCorrectProjectRoot(currentDir, denials)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break; // Reached filesystem root
    }

    currentDir = parentDir;
    depth++;
  }

  return undefined;
}

/**
 * Checks if a directory contains the correct package.json for this project.
 * Records refused reads in `denials` rather than discarding the reason.
 */
function isCorrectProjectRoot(dir: string, denials: AccessDenial[]): boolean {
  const packageJsonPath = path.join(dir, FILE_SYSTEM.PACKAGE_JSON_FILENAME);

  // Read directly rather than probing with existsSync first: existsSync collapses
  // every errno to `false`, so a TCC denial becomes indistinguishable from an absent
  // file and the real cause is lost before it can be reported.
  let packageContent: string;
  try {
    packageContent = fs.readFileSync(packageJsonPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && PERMISSION_ERROR_CODES.has(code)) {
      // Keep walking — an ancestor may still be readable — but remember why this
      // level failed so the caller can report it if the search comes up empty.
      denials.push({ path: packageJsonPath, code });
    }
    return false;
  }

  try {
    return JSON.parse(packageContent).name === 'apple-events-mcp';
  } catch {
    // Malformed package.json belongs to some other project; keep searching upward.
    return false;
  }
}

/**
 * Turns a refused read into a message that names the actual cause and the actual fix.
 */
export function describeAccessDenial(
  denial: AccessDenial,
  startDir: string,
): string {
  const gated = TCC_GATED_FOLDERS.find((folder) =>
    startDir.split(path.sep).includes(folder),
  );

  if (denial.code === 'EPERM' && gated) {
    return (
      `Permission denied reading ${denial.path} (EPERM). This server is installed ` +
      `under ~/${gated}, which macOS protects with its own TCC service. Granting ` +
      `Full Disk Access does NOT lift this for a spawned server process — move the ` +
      `repository outside ~/Documents, ~/Desktop and ~/Downloads (for example to ` +
      `~/Developer), then update the path in claude_desktop_config.json.`
    );
  }

  if (denial.code === 'EPERM') {
    return (
      `Permission denied reading ${denial.path} (EPERM). macOS refused this read at ` +
      `the privacy layer rather than the filesystem layer. Check that the app ` +
      `launching this server has access to the folder the repository lives in.`
    );
  }

  return (
    `Permission denied reading ${denial.path} (${denial.code}). Check filesystem ` +
    `ownership and mode on the repository directory.`
  );
}

/**
 * projectUtils.ts
 * Shared utilities for project-related operations
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILE_SYSTEM } from './constants.js';
import {
  type AccessDenial,
  describeAccessDenial,
  locateProjectRoot,
} from './projectRootSearch.js';

/**
 * Finds the project root directory by looking for package.json
 * @param maxDepth - Maximum directory levels to traverse upward
 * @returns Project root directory path
 * @throws Error if project root cannot be found
 */
export function findProjectRoot(
  maxDepth = FILE_SYSTEM.MAX_DIRECTORY_SEARCH_DEPTH,
): string {
  // Derive the starting directory from the current module's location for robustness.
  const currentDir = getCurrentModuleDir();
  const denials: AccessDenial[] = [];
  const root = locateProjectRoot(currentDir, maxDepth, denials);

  if (root) {
    return root;
  }

  // A permission denial and a genuinely absent package.json both end the walk with
  // no root, but they are completely different problems with completely different
  // fixes. Reporting the generic message for a denial is what made a repo-wide TCC
  // outage present as an unexplained startup crash — this function runs at module
  // load time, so the failure surfaces to the user as "Server disconnected".
  if (denials.length > 0) {
    throw new Error(describeAccessDenial(denials[0], currentDir));
  }

  throw new Error(`Project root not found within ${maxDepth} directory levels`);
}

/**
 * Get the current module's directory
 * Handles both production and test environments
 */
function getCurrentModuleDir(): string {
  if (process.env.NODE_ENV === 'test') {
    return path.join(process.cwd(), 'src', 'utils');
  }

  // In production, use import.meta.url
  // This line is excluded from coverage due to Jest ESM limitations
  /* istanbul ignore next */
  return path.dirname(fileURLToPath(import.meta.url));
}

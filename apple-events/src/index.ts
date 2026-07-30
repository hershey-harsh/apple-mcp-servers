#!/usr/bin/env node

/**
 * index.ts
 * Entry point for the Apple Reminders MCP server
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './server/server.js';
import { findProjectRoot } from './utils/projectUtils.js';

// Find project root and load package.json
const projectRoot = findProjectRoot();
let packageJson: { name: string; version: string };
try {
  packageJson = JSON.parse(
    readFileSync(join(projectRoot, 'package.json'), 'utf-8'),
  );
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(`Failed to parse package.json: ${detail}`);
}

// Server configuration
const SERVER_CONFIG = {
  name: packageJson.name,
  version: packageJson.version,
};

// Start the application
startServer(SERVER_CONFIG).catch(() => {
  process.exit(1);
});

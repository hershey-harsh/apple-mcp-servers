/**
 * Mock implementation of cliExecutor for testing
 */

export const executeCli = jest.fn();
export const escapeAppleScriptString = jest.fn((value: string) => value);
export const runAppleScript = jest.fn();

/**
 * server/promptAbstractions.test.ts
 * Tests for shared prompt abstraction functions
 */

describe('Constraint Consistency', () => {
  it('should provide confidence constraints', () => {
    const { CONFIDENCE_CONSTRAINTS } =
      require('./promptAbstractions.js') as typeof import('./promptAbstractions.js');
    expect(CONFIDENCE_CONSTRAINTS).toContain(
      'Assess confidence for each action (high >80%, medium 60-80%, low <60%).',
    );
  });

  it('should provide note formatting constraints', () => {
    const { NOTE_FORMATTING_CONSTRAINTS } =
      require('./promptAbstractions.js') as typeof import('./promptAbstractions.js');
    expect(
      NOTE_FORMATTING_CONSTRAINTS.some(
        (c: string) => c.includes('plain text') || c.includes('No markdown'),
      ),
    ).toBe(true);
    expect(
      NOTE_FORMATTING_CONSTRAINTS.some((c: string) =>
        c.includes('priority/urgency'),
      ),
    ).toBe(true);
    expect(
      NOTE_FORMATTING_CONSTRAINTS.some((c: string) =>
        c.includes('Only include Note:'),
      ),
    ).toBe(true);
    expect(
      NOTE_FORMATTING_CONSTRAINTS.some((c: string) =>
        c.includes('Only include Note: or Duration:'),
      ),
    ).toBe(true);
  });

  it('should provide batching constraints', () => {
    const { BATCHING_CONSTRAINTS } =
      require('./promptAbstractions.js') as typeof import('./promptAbstractions.js');
    expect(
      BATCHING_CONSTRAINTS.some((c: string) =>
        c.includes('idempotency checks'),
      ),
    ).toBe(true);
  });

  it('should describe focus sprint time blocks and anchoring', () => {
    const { TIME_BLOCK_CREATION_CONSTRAINTS } =
      require('./promptAbstractions.js') as typeof import('./promptAbstractions.js');
    // Focus Sprint naming has been removed in the refactoring
    // Check for anchoring guidance instead
    expect(
      TIME_BLOCK_CREATION_CONSTRAINTS.some((c: string) =>
        c.includes('Anchor start time to due time'),
      ),
    ).toBe(true);
  });

  it('should keep deep work anchoring guidance with short-burst carve out', () => {
    const { DEEP_WORK_CONSTRAINTS } =
      require('./promptAbstractions.js') as typeof import('./promptAbstractions.js');
    // Tasks <60 minutes guidance removed (moved to TIME_BLOCK_CREATION_CONSTRAINTS)
    // Check for anchoring guidance
    expect(
      DEEP_WORK_CONSTRAINTS.some((c: string) =>
        c.includes('anchor start time to due time'),
      ),
    ).toBe(true);
  });

  it('should provide shallow tasks constraints', () => {
    const { SHALLOW_TASKS_CONSTRAINTS } =
      require('./promptAbstractions.js') as typeof import('./promptAbstractions.js');
    expect(SHALLOW_TASKS_CONSTRAINTS.length).toBeGreaterThan(0);
    expect(
      SHALLOW_TASKS_CONSTRAINTS.some((c: string) =>
        c.includes('Shallow tasks time block guidelines'),
      ),
    ).toBe(true);
    expect(
      SHALLOW_TASKS_CONSTRAINTS.some((c: string) =>
        c.includes('Duration: 15-60 minutes'),
      ),
    ).toBe(true);
  });

  it('should provide daily capacity constraints with implicit buffer time', () => {
    const { DAILY_CAPACITY_CONSTRAINTS } =
      require('./promptAbstractions.js') as typeof import('./promptAbstractions.js');
    expect(DAILY_CAPACITY_CONSTRAINTS.length).toBeGreaterThan(0);
    expect(
      DAILY_CAPACITY_CONSTRAINTS.some((c: string) =>
        c.includes('Daily capacity limits and workload balancing'),
      ),
    ).toBe(true);
    expect(
      DAILY_CAPACITY_CONSTRAINTS.some((c: string) =>
        c.includes('Deep Work maximum: 4 hours per day'),
      ),
    ).toBe(true);
    expect(
      DAILY_CAPACITY_CONSTRAINTS.some((c: string) => c.includes('~20% buffer')),
    ).toBe(true);
  });
});

import { combineTagsAndNotes } from './tagUtils.js';

describe('tagUtils', () => {
  describe('combineTagsAndNotes', () => {
    it('deduplicates tags after normalization', () => {
      const result = combineTagsAndNotes(['Work', '#work'], 'Hello');
      expect(result).toBe('[#work]\nHello');
    });

    it('does not duplicate existing normalized tags', () => {
      const result = combineTagsAndNotes(['Work'], '[#work] Hello');
      expect(result).toBe('[#work]\nHello');
    });
  });
});

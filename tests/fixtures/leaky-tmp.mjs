// A test file that leaks a temp folder on purpose (#131): scripts/test.mjs must clean it up.
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('leaks a temp folder', () => {
  const d = mkdtempSync(join(tmpdir(), 'ac-leak-'));
  writeFileSync(join(d, 'f.txt'), 'x');
});

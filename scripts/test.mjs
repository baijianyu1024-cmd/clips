import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const tests = (await readdir('tests/extension')).filter(file => file.endsWith('.test.mjs')).sort().map(file => `tests/extension/${file}`);
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

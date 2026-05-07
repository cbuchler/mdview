import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

interface PackageJson {
  version?: string;
}

const packageJsonPath = path.resolve(fileURLToPath(new URL('../package.json', import.meta.url)));
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson;

export const VERSION = packageJson.version ?? '0.0.0';

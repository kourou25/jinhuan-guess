import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const dependencyRoot=process.env.GUESS_TOOLCHAIN_ROOT||fileURLToPath(new URL('../app/node_modules',import.meta.url));
export const requireTool=createRequire(resolve(dependencyRoot,'../package.json'));

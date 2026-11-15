// Whether a module is the script the runtime was asked to run, rather than one imported by another
// module (an opencode plugin imports the hook scripts for their exported checks). Compared by real
// path, since a hook may be invoked through a symlink.
//
// It never throws: opencode's compiled Bun binary reports a virtual argv[1] (`/$bunfs/root/src/index.js`)
// that realpath cannot resolve, and a throw at import time makes the importing plugin load nothing, so
// its guard is silently gone.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function invokedDirectly(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

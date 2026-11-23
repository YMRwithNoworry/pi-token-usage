import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const hostModules = process.env.PI_TEST_NODE_MODULES;
if (hostModules) {
  const parentURL = pathToFileURL(join(dirname(resolve(hostModules)), "package.json")).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@earendil-works/pi-coding-agent" || specifier === "@earendil-works/pi-tui") {
        return nextResolve(specifier, { ...context, parentURL });
      }
      return nextResolve(specifier, context);
    },
  });
}

// Copies config/pipelines.jsonc to <T3 home>/userdata/pipelines.json, where the server hot-reloads it.
// Usage: node scripts/install-pipelines.ts [--home <dir>]   (default: $T3CODE_HOME, else ~/.t3)
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Plain CLI script; Effect's FileSystem/Path are for service code, not one-shot installers.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const homeFlag = process.argv.indexOf("--home");
const home =
  homeFlag === -1
    ? (process.env.T3CODE_HOME ?? NodePath.join(NodeOS.homedir(), ".t3"))
    : NodePath.resolve(process.argv[homeFlag + 1] ?? "");
const source = NodePath.join(import.meta.dirname, "..", "config", "pipelines.jsonc");
const target = NodePath.join(home, "userdata", "pipelines.json");

const hadTarget = NodeFS.existsSync(target);
if (hadTarget && NodeFS.readFileSync(target, "utf8") === NodeFS.readFileSync(source, "utf8")) {
  console.log(`${target} is already up to date.`);
  process.exit(0);
}
NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
// The settings editor saves to the target too, so keep what was there.
if (hadTarget) NodeFS.copyFileSync(target, `${target}.bak`);
NodeFS.copyFileSync(source, target);
console.log(`Installed ${target}${hadTarget ? ` (previous copy: ${target}.bak)` : ""}.`);

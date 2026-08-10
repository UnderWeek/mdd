# @underweek/mdd

`mdd` is a direct Minecraft mod manager for Windows. It writes downloaded `.jar` files to the current `%APPDATA%\\.minecraft\\mods` folder; it is not a launcher and does not create profiles.

## Install

Requirements: Windows and Node.js 18 or newer.

```powershell
npm install -g @underweek/mdd
```

Then configure the Minecraft version and loader once:

```powershell
mdd version 1.21.11
mdd loader fabric
```

## Development

```powershell
npm install
npm run check
node src/cli.js version 1.21.11
node src/cli.js loader fabric
node src/cli.js search "Mouse Tweaks"
node src/cli.js check
```

## CLI

```text
mdd version 1.21.11
mdd loader fabric
mdd search "Mouse Tweaks"
mdd search "Mouse Tweaks" --plain
mdd install "Mouse Tweaks"
mdd install mousetweaks appleskin betterf3
mdd install "Mouse Tweaks" --no-dependencies
mdd list
mdd remove "Mouse Tweaks"
mdd check
mdd check --strict
```

Modrinth is used as the initial source because it exposes project/version metadata, loader filters, dependency metadata, hashes, and direct file URLs. The package verifies the SHA-1 reported by Modrinth before placing a file in `mods`.

`mdd install` accepts multiple mod names or slugs in one command. They are installed sequentially; shared dependencies are processed only once, and a failed mod does not stop the remaining requested mods.

`mdd search` opens an interactive Windows-terminal selector when attached to a terminal. Use Up/Down and Enter; the selected project's ID, slug, and description are shown below the list. `--plain` keeps a non-interactive aligned output and `--json` remains available for scripts.

`mdd list` uses the same interactive selector for installed mods. It shows eight entries at a time and scrolls with Up/Down; press `/` to filter by name, ID, filename, or version, and Esc to return to the full list. The selected mod's ID, version, file, and type are shown below. Use `mdd list --plain` for one-line output. `mdd remove` deletes the selected mod file directly and does not create a backup.

`mdd check` reads Fabric metadata from installed JARs, understands `provides` aliases and nested Fabric libraries, chooses the dependency-compatible JAR when duplicate IDs exist, and reports the state of the latest `latest.log`. A warning for a shadowed duplicate is not a launch failure. Use `mdd check --strict` when warnings should produce a non-zero exit code.

Set `MDD_MINECRAFT_DIR` or pass `--minecraft-dir` to override the default game directory.

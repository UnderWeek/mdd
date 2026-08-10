# Changelog

## 0.1.1 — 2026-08-10

- Support `mdd install project@version` for exact version requests.
- Match version requests against Modrinth suffixes such as `+mc1.21.11` and loader/version prefixes.
- Clean up stale interrupted download files from `.minecraft/mods`.
- Always clean temporary download files after an install attempt.

## 0.1.0 — 2026-08-10

First public beta release.

- Install Fabric mods and required dependencies from Modrinth.
- Install multiple mods in one command.
- Search Modrinth projects with an interactive Windows-terminal selector.
- Browse and filter installed mods interactively.
- Remove mod JARs without creating backup copies.
- Check Fabric metadata, dependencies, duplicates, conflicts, and the latest Minecraft log.

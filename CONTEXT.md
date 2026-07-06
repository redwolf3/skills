# redwolf3 Skills

A personal collection of agent skills (slash commands and behaviors) for Claude Code and other coding agents.

## Language

**Skill**:
A slash command or agent behavior defined by a `SKILL.md` file. Skills are organized into buckets and installed into agent harnesses via symlinks or the `npx skills@latest` installer.

**Bucket**:
A folder under `skills/` that groups skills by type: `engineering/`, `productivity/`, `misc/`, `personal/`, `in-progress/`, `deprecated/`. Only `engineering/` and `productivity/` are **promoted** (referenced in `README.md` and `plugin.json`).

**Description prefix**:
Every skill in this repo has its description prefixed with `(redwolf3)` to distinguish it from skills sourced from other repos (e.g. `mattpocock/skills`).

## Relationships

- A **Bucket** holds many **Skills**
- A **Skill** belongs to exactly one **Bucket**

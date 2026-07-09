# redwolf3/skills

[![skills.sh](https://skills.sh/b/redwolf3/skills)](https://skills.sh/redwolf3/skills)

My personal collection of Claude Code and agent skills, optimized for my own workflows and maintained across machines.

These skills build on and complement [Matt Pocock's skills](https://github.com/mattpocock/skills), which I find excellent as-is. My own additions are prefixed with `(redwolf3)` in their descriptions so they're easy to distinguish from others'.

## Install / Run

### Via npx (no install required)

```bash
npx redwolf3-skills --help
npx redwolf3-skills --version
npx redwolf3-skills list
```

### Global install

```bash
npm install -g redwolf3-skills
redwolf3-skills --help
```

## Quickstart (30-second setup)

1. Run the skills.sh installer:

```bash
npx skills@latest add redwolf3/skills
```

2. Pick the skills you want and which coding agents to install them on.

3. Done — skills are ready to use.

> **Tip:** To also get Matt Pocock's foundational skills, run:
>
> ```bash
> npx skills@latest add mattpocock/skills
> ```

## Local Development

Clone the repo and install dependencies:

```bash
git clone https://github.com/redwolf3/skills.git
cd skills
npm install
```

To symlink all skills into your local agent harness directories (`~/.claude/skills`, `~/.agents/skills`) so a `git pull` keeps them up to date:

```bash
bash scripts/link-skills.sh
```

To list every skill in the repo:

```bash
bash scripts/list-skills.sh
```

### Running tests

```bash
npm test
```

### Building

```bash
npm run build
```

## Release process

1. Bump the version:

   ```bash
   npm version patch   # or minor / major
   git push --follow-tags
   ```

2. Create a GitHub Release from the new tag (or the tag push itself triggers publish).

3. The [publish workflow](.github/workflows/publish.yml) runs automatically and publishes to npm using the `NPM_TOKEN` repository secret.

### One-time setup (maintainer)

1. Create an npm automation token at <https://www.npmjs.com/settings/~/tokens>.
2. Add it as a repository secret named `NPM_TOKEN` in **Settings → Secrets and variables → Actions**.
3. Verify after the first publish with:
   ```bash
   npm view redwolf3-skills
   npx redwolf3-skills --help
   ```

## Reference

Skills split on one axis — who can invoke them. **User-invoked** skills are reachable only when you type them (e.g. `/hello-world`). **Model-invoked** skills can be invoked by you _or_ reached for automatically by the agent when the task fits.

All skill descriptions in this repo are prefixed with `(redwolf3)` to distinguish them from skills sourced from other repos.

### Productivity

General workflow tools, not code-specific.

**User-invoked**

- **[hello-world](./skills/productivity/hello-world/SKILL.md)** — (redwolf3) A simple Hello World skill to verify that the setup is working correctly.

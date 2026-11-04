# Security

## Vulnerabilities in FiveRunner

Report them privately, with **Report a vulnerability** under the [Security tab](https://github.com/DariusHQ/fiverunner/security) of this repository, rather than in a public issue. Security fixes go to the latest release on npm.

Some things are vulnerabilities, and some are not.

- **Vulnerabilities:**
  - A script of a resource that reaches the host outside what FiveM gives scripts, such as files beyond its resource or a process of the system, in `fiverunner test`, `fiverunner dev`, `fiverunner audit` or `fiverunner mcp`.
  - The dev server serving files outside the project, or answering other hosts than the browser of the machine.
  - Script injection into the dev UI or the playground from the output or the files of a project.
- **Not vulnerabilities:**
  - What a repository that you open in the playground does in the page. The playground runs its scripts and NUI pages as FiveM would, in frames of its own origin, and asks you before it runs anything: run only repositories that you trust.
  - Exploits in resources that FiveRunner runs. These are the resources' own; see below.

## What `fiverunner audit` finds in the resources of others

The audit finds events that trust their clients, such as an event that pays any client what it asks. When it finds one in a resource that someone else wrote:

1. Tell its author privately: through **Report a vulnerability** of their repository, their own security policy, or a private message. Never use a public issue, a Discord channel or a post.
2. Give them time to fix it before anyone talks about it: 30 days, or until they release a fix.
3. Then share it, if you like, without more detail than server owners need to protect their servers.

Do not post the details of exploits in resources of others in the issues of FiveRunner either: they are public. FiveRunner follows the same rules for what it finds itself, and publishes only summaries of fixed findings.

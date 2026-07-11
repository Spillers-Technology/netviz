# Contributing to NetViz

Thanks for helping make local network discovery clearer and more useful. Bug
reports, platform fixes, device classification improvements, documentation,
and focused pull requests are welcome.

## Safety and scope

Only test against networks you own or have explicit permission to scan. NetViz
is a discovery and visualization tool—not a vulnerability scanner, credential
tool, remote shell, or stealth scanner. Changes that cross that boundary will
not be accepted.

## Local checks

```bash
make test          # go test ./...
make lint          # go vet ./...
make build-cli
```

For desktop UI work, follow the Wails setup in the README and include a
before/after screenshot. Test the platform you changed and say which other
platforms you could not verify.

## A useful pull request

Search issues first. Small fixes may go straight to a pull request; discuss
large features first. Keep the diff focused, add tests for scanner or history
behavior, list the commands you ran, and update docs when flags, output, or
packaging changes.

By contributing, you agree that your contribution is licensed under the MIT
license in this repository.

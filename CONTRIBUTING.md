# Contributing

> **Note:** This is an experimental fork of [podman-desktop/extension-bootc](https://github.com/podman-desktop/extension-bootc). If you want to contribute to the official extension, please submit your changes to the [upstream repository](https://github.com/podman-desktop/extension-bootc). Contributions to this fork should be limited to the experimental features listed in the README.

You can use `pnpm watch --extension-folder` from the Podman Desktop directory to automatically rebuild and test the bootc extension:

```sh
git clone https://github.com/podman-desktop/podman-desktop
git clone https://github.com/podman-desktop/extension-bootc
cd podman-desktop
pnpm watch --extension-folder ../extension-bootc/packages/backend
```

### Testing & Developing

Workflow for developing:

```sh
# Bootc root folder:
pnpm watch

# In a separate terminal in the Podman Desktop folder:
pnpm watch --extension-folder ../extension-bootc/packages/backend
```

Workflow for testing and validation checking before PR submission:

```sh
# Tests
pnpm test

# Formatting, linting and typecheck
pnpm format:fix && pnpm lint:fix && pnpm typecheck
```

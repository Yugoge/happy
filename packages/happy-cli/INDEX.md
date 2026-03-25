# happy-cli

*Last updated: 2026-03-24T22:39:53Z*
**Total entries**: 190
**Convention**: kebab

## Tree
```
happy-cli/
├── bin/
│   ├── `happy-dev.mjs` - mjs file
│   ├── `happy-mcp.mjs` - mjs file
│   └── `happy.mjs` - mjs file
├── demo-project/
│   └── `main.go` - go file
├── docs/
│   └── `bug-fix-plan-2025-01-15-athundt.md` - Minimal Fix Plan for Happy-CLI Bugs with TDD
├── scripts/
│   ├── __tests__/
│   │   └── `ripgrep_launcher.test.ts` - ts file
│   ├── `claude_local_launcher.cjs` - cjs file
│   ├── `claude_remote_launcher.cjs` - cjs file
│   ├── `claude_version_utils.cjs` - cjs file
│   ├── `claude_version_utils.test.ts` - ts file
│   ├── `download-tools.sh` - download-tools.sh - fetch difftastic and ripgrep binaries
│   ├── `env-wrapper.cjs` - cjs file
│   ├── `link-dev.cjs` - cjs file
│   ├── `ripgrep_launcher.cjs` - cjs file
│   ├── `session_hook_forwarder.cjs` - cjs file
│   ├── `setup-dev.cjs` - cjs file
│   ├── `test-continue-fix.sh` - Shell script
│   └── `unpack-tools.cjs` - cjs file
├── src/
│   ├── agent/
│   │   ├── acp/
│   │   ├── adapters/
│   │   ├── core/
│   │   ├── factories/
│   │   ├── transport/
│   │   └── `index.ts` - ts file
│   ├── api/
│   │   ├── rpc/
│   │   ├── `api.test.ts` - ts file
│   │   ├── `api.ts` - ts file
│   │   ├── `apiMachine.ts` - ts file
│   │   ├── `apiSession.test.ts` - ts file
│   │   ├── `apiSession.ts` - ts file
│   │   ├── `auth.ts` - ts file
│   │   ├── `encryption.ts` - ts file
│   │   ├── `pushNotifications.ts` - ts file
│   │   ├── `types.ts` - ts file
│   │   └── `webAuth.ts` - ts file
│   ├── claude/
│   │   ├── sdk/
│   │   ├── utils/
│   │   ├── `claudeLocal.test.ts` - ts file
│   │   ├── `claudeLocal.ts` - ts file
│   │   ├── `claudeLocalLauncher.ts` - ts file
│   │   ├── `claudeRemote.ts` - ts file
│   │   ├── `claudeRemoteLauncher.ts` - ts file
│   │   ├── `loop.ts` - ts file
│   │   ├── `registerKillSessionHandler.ts` - ts file
│   │   ├── `runClaude.ts` - ts file
│   │   ├── `session.ts` - ts file
│   │   └── `types.ts` - ts file
│   ├── codex/
│   │   ├── __tests__/
│   │   ├── utils/
│   │   ├── `codexMcpClient.ts` - ts file
│   │   ├── `executionPolicy.ts` - ts file
│   │   ├── `happyMcpStdioBridge.ts` - ts file
│   │   ├── `runCodex.ts` - ts file
│   │   └── `types.ts` - ts file
│   ├── commands/
│   │   ├── connect/
│   │   ├── `auth.ts` - ts file
│   │   ├── `connect.ts` - ts file
│   │   ├── `sandbox.test.ts` - ts file
│   │   └── `sandbox.ts` - ts file
│   ├── daemon/
│   │   ├── mac/
│   │   ├── `CLAUDE.md` - Happy CLI Daemon: Control Flow and Lifecycle
│   │   ├── `controlClient.ts` - ts file
│   │   ├── `controlServer.ts` - ts file
│   │   ├── `daemon.integration.test.ts` - ts file
│   │   ├── `doctor.ts` - ts file
│   │   ├── `install.ts` - ts file
│   │   ├── `run.ts` - ts file
│   │   ├── `types.ts` - ts file
│   │   └── `uninstall.ts` - ts file
│   ├── gemini/
│   │   ├── utils/
│   │   ├── `constants.ts` - ts file
│   │   ├── `runGemini.ts` - ts file
│   │   └── `types.ts` - ts file
│   ├── modules/
│   │   ├── common/
│   │   ├── difftastic/
│   │   ├── proxy/
│   │   ├── ripgrep/
│   │   └── watcher/
│   ├── parsers/
│   │   ├── `specialCommands.test.ts` - ts file
│   │   └── `specialCommands.ts` - ts file
│   ├── sandbox/
│   │   ├── `config.test.ts` - ts file
│   │   ├── `config.ts` - ts file
│   │   ├── `manager.test.ts` - ts file
│   │   ├── `manager.ts` - ts file
│   │   └── `network.integration.test.ts` - ts file
│   ├── sessionProtocol/
│   │   ├── `types.test.ts` - ts file
│   │   └── `types.ts` - ts file
│   ├── ui/
│   │   ├── ink/
│   │   ├── `auth.ts` - ts file
│   │   ├── `doctor.ts` - ts file
│   │   ├── `logger.ts` - ts file
│   │   ├── `messageFormatter.ts` - ts file
│   │   ├── `messageFormatterInk.ts` - ts file
│   │   ├── `qrcode.test.ts` - ts file
│   │   └── `qrcode.ts` - ts file
│   ├── utils/
│   │   ├── __tests__/
│   │   ├── `backupKey.ts` - ts file
│   │   ├── `BasePermissionHandler.ts` - ts file
│   │   ├── `BaseReasoningProcessor.ts` - ts file
│   │   ├── `browser.ts` - ts file
│   │   ├── `caffeinate.ts` - ts file
│   │   ├── `createSessionMetadata.test.ts` - ts file
│   │   ├── `createSessionMetadata.ts` - ts file
│   │   ├── `deriveKey.appspec.ts` - ts file
│   │   ├── `deriveKey.ts` - ts file
│   │   ├── `deterministicJson.test.ts` - ts file
│   │   ├── `deterministicJson.ts` - ts file
│   │   ├── `expandEnvVars.test.ts` - ts file
│   │   ├── `expandEnvVars.ts` - ts file
│   │   ├── `fileAtomic.ts` - ts file
│   │   ├── `future.ts` - ts file
│   │   ├── `hex.ts` - ts file
│   │   ├── `hmac_sha512.test.ts` - ts file
│   │   ├── `hmac_sha512.ts` - ts file
│   │   ├── `lock.ts` - ts file
│   │   ├── `MessageQueue.ts` - ts file
│   │   ├── `MessageQueue2.test.ts` - ts file
│   │   ├── `MessageQueue2.ts` - ts file
│   │   ├── `offlineSessionStub.ts` - ts file
│   │   ├── `pricing.ts` - ts file
│   │   ├── `PushableAsyncIterable.test.ts` - ts file
│   │   ├── `PushableAsyncIterable.ts` - ts file
│   │   ├── `runtime.ts` - ts file
│   │   ├── `sandboxFlags.test.ts` - ts file
│   │   ├── `sandboxFlags.ts` - ts file
│   │   ├── `serverConnectionErrors.test.ts` - ts file
│   │   ├── `serverConnectionErrors.ts` - ts file
│   │   ├── `setupOfflineReconnection.ts` - ts file
│   │   ├── `spawnHappyCLI.ts` - ts file
│   │   ├── `sync.ts` - ts file
│   │   ├── `text.ts` - ts file
│   │   ├── `time.ts` - ts file
│   │   ├── `tmux.test.ts` - ts file
│   │   ├── `tmux.ts` - ts file
│   │   └── `trimIdent.ts` - ts file
│   ├── `configuration.ts` - ts file
│   ├── `index.ts` - ts file
│   ├── `lib.ts` - ts file
│   ├── `persistence.test.ts` - ts file
│   ├── `persistence.ts` - ts file
│   ├── `projectPath.ts` - ts file
│   └── `test-setup.ts` - ts file
├── tools/
│   ├── archives/
│   │   ├── `difftastic-arm64-darwin.tar.gz` - gz file
│   │   ├── `difftastic-arm64-linux.tar.gz` - gz file
│   │   ├── `difftastic-arm64-win32.tar.gz` - gz file
│   │   ├── `difftastic-LICENSE` - unknown file
│   │   ├── `difftastic-x64-darwin.tar.gz` - gz file
│   │   ├── `difftastic-x64-linux.tar.gz` - gz file
│   │   ├── `difftastic-x64-win32.tar.gz` - gz file
│   │   ├── `ripgrep-arm64-darwin.tar.gz` - gz file
│   │   ├── `ripgrep-arm64-linux.tar.gz` - gz file
│   │   ├── `ripgrep-arm64-win32.tar.gz` - gz file
│   │   ├── `ripgrep-LICENSE` - unknown file
│   │   ├── `ripgrep-x64-darwin.tar.gz` - gz file
│   │   ├── `ripgrep-x64-linux.tar.gz` - gz file
│   │   └── `ripgrep-x64-win32.tar.gz` - gz file
│   ├── licenses/
│   │   ├── `difftastic-LICENSE` - unknown file
│   │   └── `ripgrep-LICENSE` - unknown file
│   └── unpacked/
│       ├── `difft` - unknown file
│       ├── `rg` - unknown file
│       └── `ripgrep.node` - node file
├── `CLAUDE.md` - Happy CLI Codebase Overview
├── `CONTRIBUTING.md` - Contributing to Happy CLI
├── `package.json` - json config
├── `roadmap.md` - APi eeror?
├── `tsconfig.json` - json config
└── `vitest.config.ts` - ts file
```

---
*Auto-generated by doc-sync hook.*
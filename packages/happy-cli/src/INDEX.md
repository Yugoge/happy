# src

*Last updated: 2026-05-25T09:14:42Z*
**Total entries**: 285
**Convention**: kebab

## Tree
```
src/
├── agent/
│   ├── acp/
│   │   ├── `acpAgentConfig.test.ts` - ts file
│   │   ├── `acpAgentConfig.ts` - ts file
│   │   ├── `AcpBackend.ts` - ts file
│   │   ├── `AcpSessionManager.test.ts` - ts file
│   │   ├── `AcpSessionManager.ts` - ts file
│   │   ├── `createAcpBackend.ts` - ts file
│   │   ├── `index.ts` - ts file
│   │   ├── `runAcp.test.ts` - ts file
│   │   ├── `runAcp.ts` - ts file
│   │   ├── `sessionConfigMetadata.test.ts` - ts file
│   │   ├── `sessionConfigMetadata.ts` - ts file
│   │   └── `sessionUpdateHandlers.ts` - ts file
│   ├── adapters/
│   │   ├── `index.ts` - ts file
│   │   ├── `MessageAdapter.ts` - ts file
│   │   └── `MobileMessageFormat.ts` - ts file
│   ├── core/
│   │   ├── `AgentBackend.ts` - ts file
│   │   ├── `AgentMessage.ts` - ts file
│   │   ├── `AgentRegistry.ts` - ts file
│   │   └── `index.ts` - ts file
│   ├── factories/
│   │   ├── `gemini.ts` - ts file
│   │   └── `index.ts` - ts file
│   ├── transport/
│   │   ├── handlers/
│   │   ├── `DefaultTransport.ts` - ts file
│   │   ├── `index.ts` - ts file
│   │   └── `TransportHandler.ts` - ts file
│   └── `index.ts` - ts file
├── api/
│   ├── rpc/
│   │   ├── `RpcHandlerManager.ts` - ts file
│   │   └── `types.ts` - ts file
│   ├── `api.test.ts` - ts file
│   ├── `api.ts` - ts file
│   ├── `apiMachine.ts` - ts file
│   ├── `apiSession.test.ts` - ts file
│   ├── `apiSession.ts` - ts file
│   ├── `auth.ts` - ts file
│   ├── `encryption.ts` - ts file
│   ├── `pushNotifications.test.ts` - ts file
│   ├── `pushNotifications.ts` - ts file
│   ├── `types.ts` - ts file
│   └── `webAuth.ts` - ts file
├── claude/
│   ├── sdk/
│   │   ├── `index.ts` - ts file
│   │   ├── `metadataExtractor.ts` - ts file
│   │   ├── `prompts.ts` - ts file
│   │   ├── `query.ts` - ts file
│   │   ├── `stream.ts` - ts file
│   │   ├── `types.ts` - ts file
│   │   └── `utils.ts` - ts file
│   ├── utils/
│   │   ├── __fixtures__/
│   │   ├── `claudeCheckSession.test.ts` - ts file
│   │   ├── `claudeCheckSession.ts` - ts file
│   │   ├── `claudeFindLastSession.test.ts` - ts file
│   │   ├── `claudeFindLastSession.ts` - ts file
│   │   ├── `claudeSettings.test.ts` - ts file
│   │   ├── `claudeSettings.ts` - ts file
│   │   ├── `currentModelCodeEmitter.test.ts` - ts file
│   │   ├── `currentModelCodeEmitter.ts` - ts file
│   │   ├── `fileContentReader.ts` - ts file
│   │   ├── `generateHookSettings.ts` - ts file
│   │   ├── `getToolDescriptor.ts` - ts file
│   │   ├── `getToolName.ts` - ts file
│   │   ├── `OutgoingMessageQueue.ts` - ts file
│   │   ├── `path.test.ts` - ts file
│   │   ├── `path.ts` - ts file
│   │   ├── `permissionHandler.ts` - ts file
│   │   ├── `permissionMode.test.ts` - ts file
│   │   ├── `permissionMode.ts` - ts file
│   │   ├── `questionNotification.test.ts` - ts file
│   │   ├── `questionNotification.ts` - ts file
│   │   ├── `sdkToLogConverter.test.ts` - ts file
│   │   ├── `sdkToLogConverter.ts` - ts file
│   │   ├── `sessionProtocolMapper.test.ts` - ts file
│   │   ├── `sessionProtocolMapper.ts` - ts file
│   │   ├── `sessionScanner.test.ts` - ts file
│   │   ├── `sessionScanner.ts` - ts file
│   │   ├── `startHappyServer.ts` - ts file
│   │   ├── `startHookServer.ts` - ts file
│   │   ├── `stopHookFilter.ts` - ts file
│   │   └── `systemPrompt.ts` - ts file
│   ├── `claude.integration.test.ts` - ts file
│   ├── `claudeLocal.test.ts` - ts file
│   ├── `claudeLocal.ts` - ts file
│   ├── `claudeLocalLauncher.ts` - ts file
│   ├── `claudeRemote.ts` - ts file
│   ├── `claudeRemoteLauncher.ts` - ts file
│   ├── `loop.ts` - ts file
│   ├── `registerKillSessionHandler.ts` - ts file
│   ├── `runClaude.ts` - ts file
│   ├── `session.ts` - ts file
│   └── `types.ts` - ts file
├── codex/
│   ├── __tests__/
│   │   ├── `emitReadyIfIdle.test.ts` - ts file
│   │   ├── `executionPolicy.test.ts` - ts file
│   │   └── `sessionProtocolMapper.test.ts` - ts file
│   ├── utils/
│   │   ├── `diffProcessor.ts` - ts file
│   │   ├── `permissionHandler.ts` - ts file
│   │   ├── `reasoningProcessor.ts` - ts file
│   │   ├── `sessionProtocolMapper.ts` - ts file
│   │   └── `subagentLifecycle.ts` - ts file
│   ├── `cliArgs.test.ts` - ts file
│   ├── `cliArgs.ts` - ts file
│   ├── `codex.integration.test.ts` - ts file
│   ├── `codexAppServerClient.test.ts` - ts file
│   ├── `codexAppServerClient.ts` - ts file
│   ├── `codexAppServerTypes.ts` - ts file
│   ├── `codexMapping.cgroup.test.ts` - ts file
│   ├── `codexMapping.test.ts` - ts file
│   ├── `codexMapping.ts` - ts file
│   ├── `codexMappingDaemon.test.ts` - ts file
│   ├── `codexMappingDaemon.ts` - ts file
│   ├── `executionPolicy.ts` - ts file
│   ├── `happyMcpStdioBridge.ts` - ts file
│   ├── `notifyDaemonOfCodexTid.test.ts` - ts file
│   ├── `notifyDaemonOfCodexTid.ts` - ts file
│   ├── `resumeExistingThread.test.ts` - ts file
│   ├── `resumeExistingThread.ts` - ts file
│   ├── `rolloutHistoryReplay.test.ts` - ts file
│   ├── `rolloutHistoryReplay.ts` - ts file
│   └── `runCodex.ts` - ts file
├── commands/
│   ├── connect/
│   │   ├── `authenticateClaude.ts` - ts file
│   │   ├── `authenticateCodex.ts` - ts file
│   │   ├── `authenticateGemini.ts` - ts file
│   │   ├── `types.ts` - ts file
│   │   └── `utils.ts` - ts file
│   ├── `auth.ts` - ts file
│   ├── `connect.ts` - ts file
│   ├── `sandbox.test.ts` - ts file
│   └── `sandbox.ts` - ts file
├── daemon/
│   ├── mac/
│   │   ├── `install.ts` - ts file
│   │   └── `uninstall.ts` - ts file
│   ├── `CLAUDE.md` - Happy CLI Daemon: Control Flow and Lifecycle
│   ├── `controlClient.ts` - ts file
│   ├── `controlServer.test.ts` - ts file
│   ├── `controlServer.ts` - ts file
│   ├── `daemon.integration.test.ts` - ts file
│   ├── `doctor.ts` - ts file
│   ├── `install.ts` - ts file
│   ├── `run.ts` - ts file
│   ├── `types.ts` - ts file
│   └── `uninstall.ts` - ts file
├── gemini/
│   ├── utils/
│   │   ├── `config.ts` - ts file
│   │   ├── `conversationHistory.ts` - ts file
│   │   ├── `diffProcessor.ts` - ts file
│   │   ├── `optionsParser.ts` - ts file
│   │   ├── `permissionHandler.ts` - ts file
│   │   ├── `promptUtils.ts` - ts file
│   │   └── `reasoningProcessor.ts` - ts file
│   ├── `constants.ts` - ts file
│   ├── `runGemini.ts` - ts file
│   └── `types.ts` - ts file
├── modules/
│   ├── common/
│   │   ├── `pathSecurity.test.ts` - ts file
│   │   ├── `pathSecurity.ts` - ts file
│   │   └── `registerCommonHandlers.ts` - ts file
│   ├── difftastic/
│   │   ├── `index.test.ts` - ts file
│   │   └── `index.ts` - ts file
│   ├── proxy/
│   │   └── `startHTTPDirectProxy.ts` - ts file
│   ├── ripgrep/
│   │   ├── `index.test.ts` - ts file
│   │   └── `index.ts` - ts file
│   └── watcher/
│       ├── `awaitFileExist.ts` - ts file
│       └── `startFileWatcher.ts` - ts file
├── openclaw/
│   ├── `openclaw.integration.test.ts` - ts file
│   ├── `openclawAuth.test.ts` - ts file
│   ├── `openclawAuth.ts` - ts file
│   ├── `OpenClawBackend.ts` - ts file
│   ├── `OpenClawSocket.ts` - ts file
│   ├── `openclawTypes.ts` - ts file
│   └── `runOpenClaw.ts` - ts file
├── parsers/
│   ├── `specialCommands.test.ts` - ts file
│   └── `specialCommands.ts` - ts file
├── resume/
│   ├── `handleResumeCommand.test.ts` - ts file
│   ├── `handleResumeCommand.ts` - ts file
│   ├── `localHappyAgentAuth.ts` - ts file
│   ├── `resolveHappySession.test.ts` - ts file
│   └── `resolveHappySession.ts` - ts file
├── sandbox/
│   ├── `config.test.ts` - ts file
│   ├── `config.ts` - ts file
│   ├── `manager.test.ts` - ts file
│   ├── `manager.ts` - ts file
│   └── `network.integration.test.ts` - ts file
├── sessionProtocol/
│   ├── `types.test.ts` - ts file
│   └── `types.ts` - ts file
├── testing/
│   ├── `currentIntegrationEnv.ts` - ts file
│   ├── `installIntegrationEnvironment.ts` - ts file
│   ├── `integration.setup.authenticated.ts` - ts file
│   ├── `integration.setup.empty.ts` - ts file
│   └── `integrationEnvironment.ts` - ts file
├── ui/
│   ├── ink/
│   │   ├── `AuthSelector.tsx` - tsx file
│   │   ├── `CodexDisplay.tsx` - tsx file
│   │   ├── `DaemonPrompt.tsx` - tsx file
│   │   ├── `GeminiDisplay.tsx` - tsx file
│   │   ├── `messageBuffer.ts` - ts file
│   │   └── `RemoteModeDisplay.tsx` - tsx file
│   ├── `auth.ts` - ts file
│   ├── `doctor.ts` - ts file
│   ├── `logger.ts` - ts file
│   ├── `messageFormatter.ts` - ts file
│   ├── `messageFormatterInk.ts` - ts file
│   ├── `qrcode.test.ts` - ts file
│   └── `qrcode.ts` - ts file
├── utils/
│   ├── __tests__/
│   │   ├── `runtime.test.ts` - ts file
│   │   └── `runtimeIntegration.test.ts` - ts file
│   ├── `atomicWriteJson.test.ts` - ts file
│   ├── `atomicWriteJson.ts` - ts file
│   ├── `backupKey.ts` - ts file
│   ├── `BasePermissionHandler.ts` - ts file
│   ├── `BaseReasoningProcessor.ts` - ts file
│   ├── `browser.ts` - ts file
│   ├── `caffeinate.ts` - ts file
│   ├── `createSessionMetadata.test.ts` - ts file
│   ├── `createSessionMetadata.ts` - ts file
│   ├── `deriveKey.appspec.ts` - ts file
│   ├── `deriveKey.ts` - ts file
│   ├── `detectCLI.ts` - ts file
│   ├── `deterministicJson.test.ts` - ts file
│   ├── `deterministicJson.ts` - ts file
│   ├── `expandEnvVars.test.ts` - ts file
│   ├── `expandEnvVars.ts` - ts file
│   ├── `fileAtomic.ts` - ts file
│   ├── `future.ts` - ts file
│   ├── `hex.ts` - ts file
│   ├── `hmac_sha512.test.ts` - ts file
│   ├── `hmac_sha512.ts` - ts file
│   ├── `lock.ts` - ts file
│   ├── `MessageQueue.ts` - ts file
│   ├── `MessageQueue2.test.ts` - ts file
│   ├── `MessageQueue2.ts` - ts file
│   ├── `offlineSessionStub.ts` - ts file
│   ├── `parseListResponse.test.ts` - ts file
│   ├── `parseListResponse.ts` - ts file
│   ├── `pricing.ts` - ts file
│   ├── `PushableAsyncIterable.test.ts` - ts file
│   ├── `PushableAsyncIterable.ts` - ts file
│   ├── `runtime.ts` - ts file
│   ├── `sandboxFlags.test.ts` - ts file
│   ├── `sandboxFlags.ts` - ts file
│   ├── `serverConnectionErrors.test.ts` - ts file
│   ├── `serverConnectionErrors.ts` - ts file
│   ├── `setupOfflineReconnection.ts` - ts file
│   ├── `spawnHappyCLI.ts` - ts file
│   ├── `sync.ts` - ts file
│   ├── `text.ts` - ts file
│   ├── `time.ts` - ts file
│   ├── `tmux.test.ts` - ts file
│   ├── `tmux.ts` - ts file
│   └── `trimIdent.ts` - ts file
├── `configuration.ts` - ts file
├── `index.ts` - ts file
├── `lib.ts` - ts file
├── `persistence.test.ts` - ts file
├── `persistence.ts` - ts file
├── `projectPath.ts` - ts file
└── `test-setup.ts` - ts file
```

---
*Auto-generated by doc-sync hook.*
# happy-app

*Last updated: 2026-04-08T10:52:17Z*
**Total entries**: 382
**Convention**: kebab

## Tree
```
happy-app/
├── deploy/
│   └── `happy-app.yaml` - yaml config
├── docs/
│   └── marketing/
│       └── `README-creators.md` - Happy Coder Content Creator Brief
├── packages/
│   └── happy-app/
├── patches/
├── plugins/
│   └── `withEinkCompatibility.js` - js file
├── public/
│   ├── `canvaskit.wasm` - wasm file
│   └── `favicon-active.ico` - ico file
├── sources/
│   ├── -session/
│   │   └── `SessionView.tsx` - tsx file
│   ├── app/
│   │   ├── (app)/
│   │   ├── `+html.tsx` - tsx file
│   │   └── `_layout.tsx` - tsx file
│   ├── assets/
│   │   ├── animations/
│   │   ├── fonts/
│   │   └── images/
│   ├── auth/
│   │   ├── `authAccountApprove.ts` - ts file
│   │   ├── `authApprove.ts` - ts file
│   │   ├── `authChallenge.ts` - ts file
│   │   ├── `AuthContext.tsx` - tsx file
│   │   ├── `authGetToken.ts` - ts file
│   │   ├── `authQRStart.ts` - ts file
│   │   ├── `authQRWait.ts` - ts file
│   │   ├── `secretKeyBackup.spec.ts` - ts file
│   │   ├── `secretKeyBackup.ts` - ts file
│   │   └── `tokenStorage.ts` - ts file
│   ├── changelog/
│   │   ├── `changelog.json` - json config
│   │   ├── `index.ts` - ts file
│   │   ├── `parser.ts` - ts file
│   │   ├── `storage.ts` - ts file
│   │   └── `types.ts` - ts file
│   ├── components/
│   │   ├── autocomplete/
│   │   ├── CommandPalette/
│   │   ├── diff/
│   │   ├── markdown/
│   │   ├── navigation/
│   │   ├── qr/
│   │   ├── sidebar/
│   │   ├── tools/
│   │   ├── usage/
│   │   ├── web/
│   │   ├── `ActiveSessionsGroup.tsx` - tsx file
│   │   ├── `ActiveSessionsGroupCompact.tsx` - tsx file
│   │   ├── `AgentContentView.ios.tsx` - tsx file
│   │   ├── `AgentContentView.tsx` - tsx file
│   │   ├── `AgentInput.tsx` - tsx file
│   │   ├── `AgentInputAutocomplete.tsx` - tsx file
│   │   ├── `AgentInputSuggestionView.tsx` - tsx file
│   │   ├── `AttachmentStrip.tsx` - tsx file
│   │   ├── `Avatar.tsx` - tsx file
│   │   ├── `AvatarBrutalist.tsx` - tsx file
│   │   ├── `AvatarGradient.tsx` - tsx file
│   │   ├── `AvatarSkia.tsx` - tsx file
│   │   ├── `AvatarSkia.web.tsx` - tsx file
│   │   ├── `ChatFooter.tsx` - tsx file
│   │   ├── `ChatHeaderView.tsx` - tsx file
│   │   ├── `ChatList.tsx` - tsx file
│   │   ├── `CodeView.tsx` - tsx file
│   │   ├── `CommandView.tsx` - tsx file
│   │   ├── `CompactGitStatus.tsx` - tsx file
│   │   ├── `ConnectButton.tsx` - tsx file
│   │   ├── `Deferred.tsx` - tsx file
│   │   ├── `EmptyMainScreen.tsx` - tsx file
│   │   ├── `EmptyMessages.tsx` - tsx file
│   │   ├── `EmptySessionsTablet.tsx` - tsx file
│   │   ├── `entityColor.ts` - ts file
│   │   ├── `ExternalLink.tsx` - tsx file
│   │   ├── `FAB.tsx` - tsx file
│   │   ├── `FABWide.tsx` - tsx file
│   │   ├── `FeedItemCard.tsx` - tsx file
│   │   ├── `FileIcon.tsx` - tsx file
│   │   ├── `FloatingOverlay.tsx` - tsx file
│   │   ├── `GitStatusBadge.tsx` - tsx file
│   │   ├── `haptics.ts` - ts file
│   │   ├── `haptics.web.ts` - ts file
│   │   ├── `HeaderLogo.tsx` - tsx file
│   │   ├── `HomeHeader.tsx` - tsx file
│   │   ├── `InboxView.tsx` - tsx file
│   │   ├── `Item.tsx` - tsx file
│   │   ├── `ItemGroup.tsx` - tsx file
│   │   ├── `ItemList.tsx` - tsx file
│   │   ├── `layout.ts` - ts file
│   │   ├── `MainView.tsx` - tsx file
│   │   ├── `MessageAttachments.tsx` - tsx file
│   │   ├── `MessageView.tsx` - tsx file
│   │   ├── `modelModeOptions.test.ts` - ts file
│   │   ├── `modelModeOptions.ts` - ts file
│   │   ├── `MultiTextInput.tsx` - tsx file
│   │   ├── `MultiTextInput.web.tsx` - tsx file
│   │   ├── `OAuthView.tsx` - tsx file
│   │   ├── `PermissionModeSelector.tsx` - tsx file
│   │   ├── `PlaceholderContainerView.tsx` - tsx file
│   │   ├── `PlusPlus.tsx` - tsx file
│   │   ├── `PlusPlus.web.tsx` - tsx file
│   │   ├── `ProjectGitStatus.tsx` - tsx file
│   │   ├── `RightSidebar.tsx` - tsx file
│   │   ├── `RoundButton.tsx` - tsx file
│   │   ├── `SearchableListSelector.tsx` - tsx file
│   │   ├── `SessionActionsNativeMenu.android.tsx` - tsx file
│   │   ├── `SessionActionsNativeMenu.ios.tsx` - tsx file
│   │   ├── `SessionActionsNativeMenu.tsx` - tsx file
│   │   ├── `SessionActionsNativeMenu.web.tsx` - tsx file
│   │   ├── `SessionActionsPopover.tsx` - tsx file
│   │   ├── `SessionsList.tsx` - tsx file
│   │   ├── `SessionsListWrapper.tsx` - tsx file
│   │   ├── `SettingsView.tsx` - tsx file
│   │   ├── `SettingsViewWrapper.tsx` - tsx file
│   │   ├── `Shaker.tsx` - tsx file
│   │   ├── `Shaker.web.tsx` - tsx file
│   │   ├── `ShimmerView.tsx` - tsx file
│   │   ├── `SidebarNavigator.tsx` - tsx file
│   │   ├── `SidebarView.tsx` - tsx file
│   │   ├── `SimpleSyntaxHighlighter.tsx` - tsx file
│   │   ├── `StatusBarProvider.tsx` - tsx file
│   │   ├── `StatusDot.tsx` - tsx file
│   │   ├── `StyledText.tsx` - tsx file
│   │   ├── `Switch.tsx` - tsx file
│   │   ├── `TabBar.tsx` - tsx file
│   │   ├── `TransitionStack.tsx` - tsx file
│   │   ├── `UpdateBanner.tsx` - tsx file
│   │   ├── `UserCard.tsx` - tsx file
│   │   ├── `UserSearchResult.tsx` - tsx file
│   │   ├── `VoiceAssistantStatusBar.tsx` - tsx file
│   │   └── `VoiceBars.tsx` - tsx file
│   ├── constants/
│   │   ├── `Languages.ts` - ts file
│   │   └── `Typography.ts` - ts file
│   ├── dev/
│   │   └── `testRunner.ts` - ts file
│   ├── docs/
│   │   └── `autocomplete-text-manipulation.md` - Autocomplete Text Manipulation Documentation
│   ├── encryption/
│   │   ├── `aes.appspec.ts` - ts file
│   │   ├── `aes.ts` - ts file
│   │   ├── `base64.appspec.ts` - ts file
│   │   ├── `base64.native.ts` - ts file
│   │   ├── `base64.ts` - ts file
│   │   ├── `deriveKey.appspec.ts` - ts file
│   │   ├── `deriveKey.ts` - ts file
│   │   ├── `hex.ts` - ts file
│   │   ├── `hmac_sha512.appspec.ts` - ts file
│   │   ├── `hmac_sha512.ts` - ts file
│   │   ├── `libsodium.lib.ts` - ts file
│   │   ├── `libsodium.lib.web.ts` - ts file
│   │   ├── `libsodium.ts` - ts file
│   │   ├── `text.test.ts` - ts file
│   │   └── `text.ts` - ts file
│   ├── hooks/
│   │   ├── `useAsyncCommand.ts` - ts file
│   │   ├── `useAttachments.ts` - ts file
│   │   ├── `useAutocomplete.ts` - ts file
│   │   ├── `useAutocompleteSession.ts` - ts file
│   │   ├── `useChangelog.ts` - ts file
│   │   ├── `useCheckCameraPermissions.ts` - ts file
│   │   ├── `useConnectAccount.ts` - ts file
│   │   ├── `useConnectTerminal.ts` - ts file
│   │   ├── `useDemoMessages.ts` - ts file
│   │   ├── `useDraft.ts` - ts file
│   │   ├── `useElapsedTime.ts` - ts file
│   │   ├── `useGetPath.ts` - ts file
│   │   ├── `useGitStatusFiles.ts` - ts file
│   │   ├── `useGlobalKeyboard.ts` - ts file
│   │   ├── `useHappyAction.ts` - ts file
│   │   ├── `useInboxHasContent.ts` - ts file
│   │   ├── `useMultiClick.ts` - ts file
│   │   ├── `useNativeUpdate.ts` - ts file
│   │   ├── `useNavigateToSession.ts` - ts file
│   │   ├── `useNewSessionDraft.ts` - ts file
│   │   ├── `usePrefetchFileContents.ts` - ts file
│   │   ├── `useSearch.ts` - ts file
│   │   ├── `useSessionQuickActions.ts` - ts file
│   │   ├── `useUpdates.ts` - ts file
│   │   ├── `useVisibleSessionListViewData.ts` - ts file
│   │   └── `useWorktreeCleanup.ts` - ts file
│   ├── modal/
│   │   ├── components/
│   │   ├── `index.ts` - ts file
│   │   ├── `ModalManager.ts` - ts file
│   │   ├── `ModalProvider.tsx` - tsx file
│   │   └── `types.ts` - ts file
│   ├── realtime/
│   │   ├── hooks/
│   │   ├── `realtimeClientTools.ts` - ts file
│   │   ├── `RealtimeProvider.tsx` - tsx file
│   │   ├── `RealtimeProvider.web.tsx` - tsx file
│   │   ├── `RealtimeSession.ts` - ts file
│   │   ├── `RealtimeVoiceSession.tsx` - tsx file
│   │   ├── `RealtimeVoiceSession.web.tsx` - tsx file
│   │   ├── `types.ts` - ts file
│   │   └── `voiceConfig.ts` - ts file
│   ├── scripts/
│   │   ├── `compareTranslations.ts` - ts file
│   │   └── `parseChangelog.ts` - ts file
│   ├── stores/
│   │   ├── `detailViewStore.ts` - ts file
│   │   └── `rightSidebarStore.ts` - ts file
│   ├── sync/
│   │   ├── __testdata__/
│   │   ├── encryption/
│   │   ├── git-parsers/
│   │   ├── prompt/
│   │   ├── reducer/
│   │   ├── revenueCat/
│   │   ├── `apiArtifacts.ts` - ts file
│   │   ├── `apiFeed.ts` - ts file
│   │   ├── `apiFriends.ts` - ts file
│   │   ├── `apiGithub.spec.ts` - ts file
│   │   ├── `apiGithub.ts` - ts file
│   │   ├── `apiKv.ts` - ts file
│   │   ├── `apiPush.ts` - ts file
│   │   ├── `apiServices.ts` - ts file
│   │   ├── `apiSocket.ts` - ts file
│   │   ├── `apiTypes.spec.ts` - ts file
│   │   ├── `apiTypes.ts` - ts file
│   │   ├── `apiUsage.ts` - ts file
│   │   ├── `apiVoice.ts` - ts file
│   │   ├── `appConfig.ts` - ts file
│   │   ├── `artifactTypes.ts` - ts file
│   │   ├── `feedTypes.ts` - ts file
│   │   ├── `friendTypes.ts` - ts file
│   │   ├── `gitStatusFiles.ts` - ts file
│   │   ├── `gitStatusSync.ts` - ts file
│   │   ├── `localSettings.ts` - ts file
│   │   ├── `messageMeta.test.ts` - ts file
│   │   ├── `messageMeta.ts` - ts file
│   │   ├── `modeHacks.test.ts` - ts file
│   │   ├── `modeHacks.ts` - ts file
│   │   ├── `ops.ts` - ts file
│   │   ├── `persistence.ts` - ts file
│   │   ├── `profile.ts` - ts file
│   │   ├── `projectManager.ts` - ts file
│   │   ├── `purchases.ts` - ts file
│   │   ├── `pushRegistration.ts` - ts file
│   │   ├── `serverConfig.ts` - ts file
│   │   ├── `settings.spec.ts` - ts file
│   │   ├── `settings.ts` - ts file
│   │   ├── `storage.ts` - ts file
│   │   ├── `storageTypes.spec.ts` - ts file
│   │   ├── `storageTypes.ts` - ts file
│   │   ├── `suggestionCommands.ts` - ts file
│   │   ├── `suggestionFile.ts` - ts file
│   │   ├── `sync.ts` - ts file
│   │   ├── `typesMessage.ts` - ts file
│   │   ├── `typesMessageMeta.test.ts` - ts file
│   │   ├── `typesMessageMeta.ts` - ts file
│   │   ├── `typesRaw.spec.ts` - ts file
│   │   └── `typesRaw.ts` - ts file
│   ├── text/
│   │   ├── translations/
│   │   ├── `_all.ts` - ts file
│   │   ├── `_default.ts` - ts file
│   │   └── `index.ts` - ts file
│   ├── track/
│   │   ├── `index.ts` - ts file
│   │   ├── `tracking.ts` - ts file
│   │   └── `useTrackScreens.ts` - ts file
│   ├── trash/
│   │   └── `test-session-view.tsx` - tsx file
│   ├── types/
│   │   └── `react-native-webrtc-web-shim.d.ts` - ts file
│   ├── utils/
│   │   ├── web/
│   │   ├── `codexUnifiedDiff.spec.ts` - ts file
│   │   ├── `codexUnifiedDiff.ts` - ts file
│   │   ├── `consoleLogging.ts` - ts file
│   │   ├── `copySessionMetadataToClipboard.ts` - ts file
│   │   ├── `debounce.test.ts` - ts file
│   │   ├── `debounce.ts` - ts file
│   │   ├── `deviceCalculations.test.ts` - ts file
│   │   ├── `deviceCalculations.ts` - ts file
│   │   ├── `errors.ts` - ts file
│   │   ├── `formatPermissionParams.ts` - ts file
│   │   ├── `loadSkia.ts` - ts file
│   │   ├── `loadSkia.web.ts` - ts file
│   │   ├── `lock.ts` - ts file
│   │   ├── `machineUtils.ts` - ts file
│   │   ├── `messageUtils.ts` - ts file
│   │   ├── `microphonePermissions.ts` - ts file
│   │   ├── `notificationRouting.test.ts` - ts file
│   │   ├── `notificationRouting.ts` - ts file
│   │   ├── `oauth.ts` - ts file
│   │   ├── `parseToken.ts` - ts file
│   │   ├── `pathUtils.spec.ts` - ts file
│   │   ├── `pathUtils.ts` - ts file
│   │   ├── `platform.ts` - ts file
│   │   ├── `requestReview.ts` - ts file
│   │   ├── `responsive.ts` - ts file
│   │   ├── `resumeCommand.test.ts` - ts file
│   │   ├── `resumeCommand.ts` - ts file
│   │   ├── `sessionFileLinks.test.ts` - ts file
│   │   ├── `sessionFileLinks.ts` - ts file
│   │   ├── `sessionUtils.ts` - ts file
│   │   ├── `stringUtils.ts` - ts file
│   │   ├── `sync.ts` - ts file
│   │   ├── `time.ts` - ts file
│   │   ├── `toolCommand.test.ts` - ts file
│   │   ├── `toolCommand.ts` - ts file
│   │   ├── `toolComparison.test.ts` - ts file
│   │   ├── `toolComparison.ts` - ts file
│   │   ├── `toolErrorParser.test.ts` - ts file
│   │   ├── `toolErrorParser.ts` - ts file
│   │   ├── `toSnakeCase.test.ts` - ts file
│   │   ├── `toSnakeCase.ts` - ts file
│   │   ├── `trimIdent.ts` - ts file
│   │   ├── `versionUtils.test.ts` - ts file
│   │   ├── `versionUtils.ts` - ts file
│   │   └── `worktree.ts` - ts file
│   ├── `config.ts` - ts file
│   ├── `log.ts` - ts file
│   ├── `theme.css` - css file
│   ├── `theme.dark.json` - json config
│   ├── `theme.figma.json` - json config
│   ├── `theme.gen.ts` - ts file
│   ├── `theme.light.json` - json config
│   ├── `theme.ts` - ts file
│   └── `unistyles.ts` - ts file
├── src-tauri/
│   ├── capabilities/
│   │   └── `default.json` - json config
│   ├── icons/
│   │   ├── android/
│   │   ├── ios/
│   │   ├── `128x128.png` - png file
│   │   ├── `128x128@2x.png` - png file
│   │   ├── `32x32.png` - png file
│   │   ├── `64x64.png` - png file
│   │   ├── `icon.icns` - icns file
│   │   ├── `icon.ico` - ico file
│   │   ├── `icon.png` - png file
│   │   ├── `Square107x107Logo.png` - png file
│   │   ├── `Square142x142Logo.png` - png file
│   │   ├── `Square150x150Logo.png` - png file
│   │   ├── `Square284x284Logo.png` - png file
│   │   ├── `Square30x30Logo.png` - png file
│   │   ├── `Square310x310Logo.png` - png file
│   │   ├── `Square44x44Logo.png` - png file
│   │   ├── `Square71x71Logo.png` - png file
│   │   ├── `Square89x89Logo.png` - png file
│   │   └── `StoreLogo.png` - png file
│   ├── src/
│   │   ├── `lib.rs` - rs file
│   │   └── `main.rs` - rs file
│   ├── `build.rs` - rs file
│   ├── `Cargo.lock` - lock file
│   ├── `Cargo.toml` - toml file
│   ├── `tauri.conf.json` - json config
│   ├── `tauri.dev.conf.json` - json config
│   └── `tauri.preview.conf.json` - json config
├── `app.config.js` - js file
├── `babel.config.js` - js file
├── `CHANGELOG.md` - Changelog
├── `CLAUDE.md` - CLAUDE.md
├── `CONTRIBUTING.md` - Contributing to Happy
├── `eas.json` - json config
├── `expo-env.d.ts` - ts file
├── `google-services.json` - json config
├── `index.ts` - ts file
├── `LICENSE` - unknown file
├── `logo.png` - png file
├── `metro.config.js` - js file
├── `nativewind-env.d.ts` - ts file
├── `package.json` - json config
├── `PRIVACY.md` - Privacy Policy for Happy Coder
├── `release-dev.sh` - Shell script
├── `release-production.sh` - Shell script
├── `release.cjs` - cjs file
├── `Stores.md` - App Store & Google Play Store Information
├── `TERMS.md` - Terms of Use
├── `tsconfig.json` - json config
├── `tsconfig.tsbuildinfo` - tsbuildinfo file
└── `vitest.config.ts` - ts file
```

---
*Auto-generated by doc-sync hook.*
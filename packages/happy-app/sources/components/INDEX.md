# components

*Last updated: 2026-04-06T11:51:37Z*
**Total entries**: 164
**Convention**: kebab

## Tree
```
components/
├── autocomplete/
│   ├── `applySuggestion.test.ts` - ts file
│   ├── `applySuggestion.ts` - ts file
│   ├── `findActiveWord.test.ts` - ts file
│   ├── `findActiveWord.ts` - ts file
│   ├── `suggestions.ts` - ts file
│   ├── `useActiveSuggestions.ts` - ts file
│   └── `useActiveWord.ts` - ts file
├── CommandPalette/
│   ├── `CommandPalette.tsx` - tsx file
│   ├── `CommandPaletteInput.tsx` - tsx file
│   ├── `CommandPaletteItem.tsx` - tsx file
│   ├── `CommandPaletteModal.tsx` - tsx file
│   ├── `CommandPaletteProvider.tsx` - tsx file
│   ├── `CommandPaletteResults.tsx` - tsx file
│   ├── `index.ts` - ts file
│   ├── `types.ts` - ts file
│   └── `useCommandPalette.ts` - ts file
├── diff/
│   ├── `calculateDiff.ts` - ts file
│   └── `DiffView.tsx` - tsx file
├── markdown/
│   ├── `codeDownload.ts` - ts file
│   ├── `LatexRenderer.tsx` - tsx file
│   ├── `linkUtils.test.ts` - ts file
│   ├── `linkUtils.ts` - ts file
│   ├── `MarkdownView.tsx` - tsx file
│   ├── `MermaidRenderer.tsx` - tsx file
│   ├── `parseMarkdown.test.ts` - ts file
│   ├── `parseMarkdown.ts` - ts file
│   ├── `parseMarkdownBlock.ts` - ts file
│   └── `parseMarkdownSpans.ts` - ts file
├── navigation/
│   └── `Header.tsx` - tsx file
├── qr/
│   ├── `index.ts` - ts file
│   ├── `QRCode.tsx` - tsx file
│   ├── `QRCode.web.tsx` - tsx file
│   └── `qrMatrix.ts` - ts file
├── sidebar/
│   ├── `SidebarAgentConversation.tsx` - tsx file
│   ├── `SidebarBashView.tsx` - tsx file
│   ├── `SidebarContentRenderer.tsx` - tsx file
│   ├── `SidebarFileView.tsx` - tsx file
│   └── `SidebarGenericView.tsx` - tsx file
├── tools/
│   ├── views/
│   │   ├── `_all.tsx` - tsx file
│   │   ├── `AskUserQuestionView.tsx` - tsx file
│   │   ├── `BashView.tsx` - tsx file
│   │   ├── `BashViewFull.tsx` - tsx file
│   │   ├── `CodexBashView.tsx` - tsx file
│   │   ├── `CodexDiffView.tsx` - tsx file
│   │   ├── `CodexPatchView.tsx` - tsx file
│   │   ├── `EditView.tsx` - tsx file
│   │   ├── `EditViewFull.tsx` - tsx file
│   │   ├── `ExitPlanToolView.tsx` - tsx file
│   │   ├── `GeminiEditView.tsx` - tsx file
│   │   ├── `GeminiExecuteView.tsx` - tsx file
│   │   ├── `MCPToolView.tsx` - tsx file
│   │   ├── `MultiEditView.tsx` - tsx file
│   │   ├── `MultiEditViewFull.tsx` - tsx file
│   │   ├── `TaskView.tsx` - tsx file
│   │   ├── `TaskViewFull.tsx` - tsx file
│   │   ├── `TodoView.tsx` - tsx file
│   │   └── `WriteView.tsx` - tsx file
│   ├── `knownTools.tsx` - tsx file
│   ├── `PermissionFooter.tsx` - tsx file
│   ├── `ToolDiffView.tsx` - tsx file
│   ├── `ToolError.tsx` - tsx file
│   ├── `ToolFullView.tsx` - tsx file
│   ├── `ToolHeader.tsx` - tsx file
│   ├── `ToolSectionView.tsx` - tsx file
│   ├── `ToolStatusIndicator.tsx` - tsx file
│   └── `ToolView.tsx` - tsx file
├── usage/
│   ├── `UsageBar.tsx` - tsx file
│   ├── `UsageChart.tsx` - tsx file
│   └── `UsagePanel.tsx` - tsx file
├── web/
│   └── `FaviconPermissionIndicator.tsx` - tsx file
├── `ActiveSessionsGroup.tsx` - tsx file
├── `ActiveSessionsGroupCompact.tsx` - tsx file
├── `AgentContentView.ios.tsx` - tsx file
├── `AgentContentView.tsx` - tsx file
├── `AgentInput.tsx` - tsx file
├── `AgentInputAutocomplete.tsx` - tsx file
├── `AgentInputSuggestionView.tsx` - tsx file
├── `AttachmentStrip.tsx` - tsx file
├── `Avatar.tsx` - tsx file
├── `AvatarBrutalist.tsx` - tsx file
├── `AvatarGradient.tsx` - tsx file
├── `AvatarSkia.tsx` - tsx file
├── `AvatarSkia.web.tsx` - tsx file
├── `ChatFooter.tsx` - tsx file
├── `ChatHeaderView.tsx` - tsx file
├── `ChatList.tsx` - tsx file
├── `CodeView.tsx` - tsx file
├── `CommandView.tsx` - tsx file
├── `CompactGitStatus.tsx` - tsx file
├── `ConnectButton.tsx` - tsx file
├── `Deferred.tsx` - tsx file
├── `EmptyMainScreen.tsx` - tsx file
├── `EmptyMessages.tsx` - tsx file
├── `EmptySessionsTablet.tsx` - tsx file
├── `entityColor.ts` - ts file
├── `ExternalLink.tsx` - tsx file
├── `FAB.tsx` - tsx file
├── `FABWide.tsx` - tsx file
├── `FeedItemCard.tsx` - tsx file
├── `FileIcon.tsx` - tsx file
├── `FloatingOverlay.tsx` - tsx file
├── `GitStatusBadge.tsx` - tsx file
├── `haptics.ts` - ts file
├── `haptics.web.ts` - ts file
├── `HeaderLogo.tsx` - tsx file
├── `HomeHeader.tsx` - tsx file
├── `InboxView.tsx` - tsx file
├── `Item.tsx` - tsx file
├── `ItemGroup.tsx` - tsx file
├── `ItemList.tsx` - tsx file
├── `layout.ts` - ts file
├── `MainView.tsx` - tsx file
├── `MessageAttachments.tsx` - tsx file
├── `MessageView.tsx` - tsx file
├── `modelModeOptions.test.ts` - ts file
├── `modelModeOptions.ts` - ts file
├── `MultiTextInput.tsx` - tsx file
├── `MultiTextInput.web.tsx` - tsx file
├── `OAuthView.tsx` - tsx file
├── `PermissionModeSelector.tsx` - tsx file
├── `PlaceholderContainerView.tsx` - tsx file
├── `PlusPlus.tsx` - tsx file
├── `PlusPlus.web.tsx` - tsx file
├── `ProjectGitStatus.tsx` - tsx file
├── `RightSidebar.tsx` - tsx file
├── `RoundButton.tsx` - tsx file
├── `SearchableListSelector.tsx` - tsx file
├── `SessionActionsNativeMenu.android.tsx` - tsx file
├── `SessionActionsNativeMenu.ios.tsx` - tsx file
├── `SessionActionsNativeMenu.tsx` - tsx file
├── `SessionActionsNativeMenu.web.tsx` - tsx file
├── `SessionActionsPopover.tsx` - tsx file
├── `SessionsList.tsx` - tsx file
├── `SessionsListWrapper.tsx` - tsx file
├── `SettingsView.tsx` - tsx file
├── `SettingsViewWrapper.tsx` - tsx file
├── `Shaker.tsx` - tsx file
├── `Shaker.web.tsx` - tsx file
├── `ShimmerView.tsx` - tsx file
├── `SidebarNavigator.tsx` - tsx file
├── `SidebarView.tsx` - tsx file
├── `SimpleSyntaxHighlighter.tsx` - tsx file
├── `StatusBarProvider.tsx` - tsx file
├── `StatusDot.tsx` - tsx file
├── `StyledText.tsx` - tsx file
├── `Switch.tsx` - tsx file
├── `TabBar.tsx` - tsx file
├── `TransitionStack.tsx` - tsx file
├── `UpdateBanner.tsx` - tsx file
├── `UserCard.tsx` - tsx file
├── `UserSearchResult.tsx` - tsx file
├── `VoiceAssistantStatusBar.tsx` - tsx file
└── `VoiceBars.tsx` - tsx file
```

---
*Auto-generated by doc-sync hook.*
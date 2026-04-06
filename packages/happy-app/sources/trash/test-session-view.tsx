// temp test file
const backBtnShadow = Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 } as const,
    android: { elevation: 2 } as const,
});

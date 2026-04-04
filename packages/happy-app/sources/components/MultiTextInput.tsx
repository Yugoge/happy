import * as React from 'react';
import { Text, TextInput, Platform, View, NativeSyntheticEvent, TextInputKeyPressEventData, TextInputSelectionChangeEventData } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

export type SupportedKey = 'Enter' | 'Escape' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Tab';

export interface KeyPressEvent {
    key: SupportedKey;
    shiftKey: boolean;
}

export type OnKeyPressCallback = (event: KeyPressEvent) => boolean;

export const MULTI_TEXT_INPUT_FONT_SIZE = 16;
export const MULTI_TEXT_INPUT_LINE_HEIGHT = 22;

export interface TextInputState {
    text: string;
    selection: {
        start: number;
        end: number;
    };
}

export interface MultiTextInputHandle {
    setTextAndSelection: (text: string, selection: { start: number; end: number }) => void;
    focus: () => void;
    blur: () => void;
}

interface MultiTextInputProps {
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    editable?: boolean;
    maxHeight?: number;
    lineHeight?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
    onKeyPress?: OnKeyPressCallback;
    onSelectionChange?: (selection: { start: number; end: number }) => void;
    onStateChange?: (state: TextInputState) => void;
}

export const MultiTextInput = React.forwardRef<MultiTextInputHandle, MultiTextInputProps>((props, ref) => {
    const {
        value,
        onChangeText,
        placeholder,
        editable = true,
        maxHeight = 120,
        lineHeight = MULTI_TEXT_INPUT_LINE_HEIGHT,
        onKeyPress,
        onSelectionChange,
        onStateChange
    } = props;

    const { theme } = useUnistyles();
    const selectionRef = React.useRef({ start: 0, end: 0 });
    const inputRef = React.useRef<TextInput>(null);
    const textStyle = {
        width: '100%' as const,
        fontSize: MULTI_TEXT_INPUT_FONT_SIZE,
        lineHeight,
        maxHeight,
        color: theme.colors.input.text,
        textAlignVertical: 'top' as const,
        padding: 0,
        paddingTop: props.paddingTop,
        paddingBottom: props.paddingBottom,
        paddingLeft: props.paddingLeft,
        paddingRight: props.paddingRight,
        opacity: editable ? 1 : 0.58,
        ...Typography.default(),
    };

    React.useEffect(() => {
        if (!editable) inputRef.current?.blur();
    }, [editable]);

    const handleKeyPress = React.useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        if (!editable || !onKeyPress) return;
        const nativeEvent = e.nativeEvent;
        const key = nativeEvent.key;
        let normalizedKey: SupportedKey | null = null;
        switch (key) {
            case 'Enter': normalizedKey = 'Enter'; break;
            case 'Escape': normalizedKey = 'Escape'; break;
            case 'ArrowUp': case 'Up': normalizedKey = 'ArrowUp'; break;
            case 'ArrowDown': case 'Down': normalizedKey = 'ArrowDown'; break;
            case 'ArrowLeft': case 'Left': normalizedKey = 'ArrowLeft'; break;
            case 'ArrowRight': case 'Right': normalizedKey = 'ArrowRight'; break;
            case 'Tab': normalizedKey = 'Tab'; break;
        }
        if (!normalizedKey) return;
        const handled = onKeyPress({ key: normalizedKey, shiftKey: (nativeEvent as any).shiftKey || false });
        if (handled) e.preventDefault();
    }, [editable, onKeyPress]);

    const handleTextChange = React.useCallback((text: string) => {
        const selection = { start: text.length, end: text.length };
        selectionRef.current = selection;
        onChangeText(text);
        onStateChange?.({ text, selection });
        onSelectionChange?.(selection);
    }, [onChangeText, onStateChange, onSelectionChange]);

    const handleSelectionChange = React.useCallback((e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        const sel = e.nativeEvent.selection;
        if (!sel) return;
        const selection = { start: sel.start, end: sel.end };
        const unchanged = selection.start === selectionRef.current.start && selection.end === selectionRef.current.end;
        if (unchanged) return;
        selectionRef.current = selection;
        onSelectionChange?.(selection);
        onStateChange?.({ text: value, selection });
    }, [value, onSelectionChange, onStateChange]);

    // On web, attach a DOM-level keydown listener so we can call preventDefault() before
    // the browser textarea inserts a newline. React Native's onKeyPress fires after the
    // textarea default behavior; submitBehavior="newline" makes the newline impossible to
    // intercept via React synthetic events. This fix is web-only; native platforms unaffected.
    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        const inputEl = inputRef.current as unknown as HTMLTextAreaElement | null;
        if (!inputEl) return;
        const handleDomKeyDown = (e: KeyboardEvent) => {
            if (!onKeyPress || e.key !== 'Enter') return;
            if (e.isComposing || e.keyCode === 229) return;
            const handled = onKeyPress({ key: 'Enter', shiftKey: e.shiftKey });
            if (handled) e.preventDefault();
        };
        inputEl.addEventListener('keydown', handleDomKeyDown);
        return () => inputEl.removeEventListener('keydown', handleDomKeyDown);
    }, [onKeyPress]);

    React.useImperativeHandle(ref, () => ({
        setTextAndSelection: (text: string, selection: { start: number; end: number }) => {
            if (!inputRef.current) return;
            inputRef.current.setNativeProps({ text, selection });
            selectionRef.current = selection;
            onChangeText(text);
            onStateChange?.({ text, selection });
            onSelectionChange?.(selection);
        },
        focus: () => inputRef.current?.focus(),
        blur: () => inputRef.current?.blur(),
    }), [onChangeText, onStateChange, onSelectionChange]);

    return (
        <View style={{ width: '100%' }}>
            {editable ? (
                <TextInput
                    ref={inputRef}
                    style={textStyle}
                    placeholder={placeholder}
                    placeholderTextColor={theme.colors.input.placeholder}
                    value={value}
                    editable={editable}
                    onChangeText={handleTextChange}
                    onKeyPress={handleKeyPress}
                    onSelectionChange={handleSelectionChange}
                    multiline={true}
                    autoCapitalize="sentences"
                    autoCorrect={true}
                    keyboardType="default"
                    returnKeyType="default"
                    autoComplete="off"
                    textContentType="none"
                    submitBehavior="newline"
                />
            ) : (
                <View pointerEvents="none">
                    <Text style={[textStyle, { color: value ? theme.colors.input.text : theme.colors.input.placeholder }]}>
                        {value || placeholder || ' '}
                    </Text>
                </View>
            )}
        </View>
    );
});

MultiTextInput.displayName = 'MultiTextInput';

import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolViewProps } from './_all';
import { ToolSectionView } from '../ToolSectionView';
import { t } from '@/text';
import {
    extractRequestUserInputSummary,
    extractRequestUserInputUnavailableReason,
    buildRequestUserInputFailureLineFromResult,
} from '@/utils/codexToolRendering';

// #5 (Cluster C): a READ-ONLY view of a Codex request_user_input call. It shows
// the prompt/question(s), options as non-clickable rows, any completed response,
// and the unavailable/error reason. It intentionally does NOT reuse
// AskUserQuestionView (that one is permission/RPC-oriented and offers interactive
// answering) — this surface never implies the user can answer here.
//
// FAILED/unavailable contract (B11, AC-C2): once this view is registered the
// failed request_user_input no longer flows through GenericToolPreview, so this
// view reproduces the full failure contract via the shared helpers — strip
// <tool_use_error>, object precedence stderr??error??message??reason, string
// unwrapped, render the completed 'unavailable in Default mode' reason, non-empty
// fallback for an errorless failure, and never re-leak raw/duplicate error.
export const RequestUserInputView = React.memo<ToolViewProps>(({ tool }) => {
    const summary = extractRequestUserInputSummary(tool);

    // Failure / unavailable reason takes precedence so the read-only card surfaces
    // why no answer is present instead of a blank dead-end.
    //
    // B11 precedence (codex#1): for a genuinely FAILED (state==='error') call the
    // B11 failure helper MUST win — it strips <tool_use_error> wrappers, whereas
    // extractRequestUserInputUnavailableReason returns the RAW field text (which
    // would re-leak the tags for an error payload like
    // '<tool_use_error>request_user_input is unavailable in Default mode</tool_use_error>').
    // The unavailable extractor is used ONLY for the COMPLETED unavailable-in-Default
    // shape (no tags), where it surfaces the cleaned reason.
    const errorReason = tool.state === 'error'
        ? buildRequestUserInputFailureLineFromResult(tool.result)
        : extractRequestUserInputUnavailableReason(tool.result);

    const hasContent = !!summary.prompt || summary.questions.length > 0
        || !!summary.answer || !!errorReason;
    if (!hasContent) return null;

    return (
        <ToolSectionView>
            <View style={styles.container}>
                {summary.prompt && (
                    <View style={styles.block}>
                        <Text style={styles.label}>{t('tools.names.question')}</Text>
                        <Text style={styles.bodyText}>{summary.prompt}</Text>
                    </View>
                )}

                {summary.questions.map((q, qIndex) => (
                    <View key={qIndex} style={styles.block}>
                        {q.header ? (
                            <View style={styles.headerChip}>
                                <Text style={styles.headerText}>{q.header}</Text>
                            </View>
                        ) : null}
                        <Text style={styles.questionText}>{q.question}</Text>
                        {q.options.length > 0 && (
                            <View style={styles.optionsContainer}>
                                <Text style={styles.label}>{t('tools.requestUserInput.options')}</Text>
                                {q.options.map((option, oIndex) => (
                                    <View key={oIndex} style={styles.optionRow}>
                                        <View style={styles.optionBullet} />
                                        <View style={styles.optionContent}>
                                            <Text style={styles.optionLabel}>{option.label}</Text>
                                            {option.description ? (
                                                <Text style={styles.optionDescription}>{option.description}</Text>
                                            ) : null}
                                        </View>
                                    </View>
                                ))}
                            </View>
                        )}
                    </View>
                ))}

                {errorReason ? (
                    <View style={styles.block}>
                        <Text style={styles.label}>{t('tools.requestUserInput.response')}</Text>
                        <Text style={styles.errorText}>{errorReason}</Text>
                    </View>
                ) : (
                    <View style={styles.block}>
                        <Text style={styles.label}>{t('tools.requestUserInput.answer')}</Text>
                        <Text style={summary.answer ? styles.bodyText : styles.noAnswerText}>
                            {summary.answer ?? t('tools.requestUserInput.noAnswer')}
                        </Text>
                    </View>
                )}
            </View>
        </ToolSectionView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 16,
    },
    block: {
        gap: 6,
    },
    label: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
    },
    headerChip: {
        alignSelf: 'flex-start',
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
    },
    headerText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
    },
    questionText: {
        fontSize: 15,
        fontWeight: '500',
        color: theme.colors.text,
    },
    bodyText: {
        fontSize: 14,
        color: theme.colors.text,
        lineHeight: 20,
    },
    optionsContainer: {
        gap: 6,
        marginTop: 4,
    },
    optionRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    optionBullet: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.textSecondary,
        marginTop: 7,
    },
    optionContent: {
        flex: 1,
    },
    optionLabel: {
        fontSize: 14,
        color: theme.colors.text,
    },
    optionDescription: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    errorText: {
        fontSize: 14,
        color: theme.colors.box.error.text,
        lineHeight: 20,
    },
    noAnswerText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontStyle: 'italic',
    },
}));

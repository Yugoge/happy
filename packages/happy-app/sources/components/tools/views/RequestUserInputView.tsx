import * as React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { ToolViewProps } from './_all';
import { ToolSectionView } from '../ToolSectionView';
import { sessionAllow } from '@/sync/ops';
import { t } from '@/text';
import {
    extractRequestUserInputSummary,
    extractRequestUserInputUnavailableReason,
    buildRequestUserInputFailureLineFromResult,
    type RequestUserInputQuestion,
} from '@/utils/codexToolRendering';

// #5 (Cluster 5 / AC-C3, AC-C4): the INTERACTIVE Codex request_user_input card.
// When the request is pending (tool.permission.status === 'pending') it mirrors
// AskUserQuestionView — the user selects option(s) and submits, and the answer is
// relayed back over the SAME permission RPC (sessionAllow ... answers). The
// answersRecord is keyed by the QUESTION ID (qid) preserved from
// input.questions[].id so the C-producer can map qid -> answer for the JSON-RPC
// round-trip (falling back to the header only when id is absent — keying by header
// alone breaks the round-trip).
//
// When the request is NOT interactive (completed / denied / canceled / error /
// unavailable, or a question with no options) the view falls back to the READ-ONLY
// rendering: prompt/question(s), options as non-clickable rows, any completed
// response, and the unavailable/error reason. FAILED/unavailable contract (B11,
// AC-C2): strip <tool_use_error>, object precedence stderr??error??message??reason,
// string unwrapped, render the completed 'unavailable in Default mode' reason,
// non-empty fallback for an errorless failure, and never re-leak raw/duplicate error.

// Build the answer key for a question: qid wins (round-trip correctness), header is
// the fallback, then the question text as a last resort so the key is never empty.
// codex#3: an EMPTY id/header (e.g. '') must NOT win via ?? (which only falls through
// on null/undefined) — a blank key would collide across questions and break the
// qid->answer mapping. nonEmpty() trims and treats blank as absent so a real key is
// always chosen.
function nonEmpty(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function answerKeyFor(q: RequestUserInputQuestion): string {
    return nonEmpty(q.id) ?? nonEmpty(q.header) ?? nonEmpty(q.question) ?? '';
}

// codex#1: render the reducer-propagated permission.answers (Record<qid, label(s)>) as
// readable 'key: value' lines for the read-only answered state. Returns null when empty
// so the resolution chain falls through to the locally-captured submitted text.
function formatPermissionAnswers(answers: Record<string, string> | undefined): string | null {
    if (!answers) return null;
    const lines = Object.entries(answers)
        .map(([k, v]) => (nonEmpty(v) ? `${k}: ${v}` : null))
        .filter((l): l is string => !!l);
    return lines.length > 0 ? lines.join('\n') : null;
}

export const RequestUserInputView = React.memo<ToolViewProps>(({ tool, sessionId }) => {
    const { theme } = useUnistyles();
    const summary = extractRequestUserInputSummary(tool);

    const [selections, setSelections] = React.useState<Map<number, Set<number>>>(new Map());
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [isSubmitted, setIsSubmitted] = React.useState(false);
    // codex#1: the locally-captured answer text, shown in the read-only path during the
    // post-submit / pre-producer-reply window so the card never flashes 'No answer'.
    const [submittedAnswerText, setSubmittedAnswerText] = React.useState<string | null>(null);

    // A request is INTERACTIVE only while the tool is RUNNING (codex#4: a stale pending
    // permission on a completed/error card must NOT re-show the form — completed/error
    // read-only wins), a permission is pending, and EVERY question offers selectable
    // options (codex#2: a request mixing option and no-option questions cannot be fully
    // answered via selection alone — submitting only the option-bearing questions would
    // relay a PARTIAL answer; instead fall to the read-only rendering).
    const isPending = tool.permission?.status === 'pending';
    const interactiveQuestions = summary.questions;
    const allSelectable = interactiveQuestions.length > 0
        && interactiveQuestions.every((q) => q.options.length > 0);
    const isInteractive = tool.state === 'running' && isPending && allSelectable && !isSubmitted;

    const allQuestionsAnswered = interactiveQuestions.every((_, qIndex) => {
        const selected = selections.get(qIndex);
        return selected && selected.size > 0;
    });

    const handleOptionToggle = React.useCallback((questionIndex: number, optionIndex: number, multiSelect: boolean) => {
        setSelections((prev) => {
            const newMap = new Map(prev);
            const currentSet = newMap.get(questionIndex) || new Set<number>();
            if (multiSelect) {
                const newSet = new Set(currentSet);
                if (newSet.has(optionIndex)) {
                    newSet.delete(optionIndex);
                } else {
                    newSet.add(optionIndex);
                }
                newMap.set(questionIndex, newSet);
            } else {
                newMap.set(questionIndex, new Set([optionIndex]));
            }
            return newMap;
        });
    }, []);

    const handleSubmit = React.useCallback(async () => {
        if (!sessionId || !tool.permission?.id || !allQuestionsAnswered || isSubmitting) return;
        setIsSubmitting(true);
        // Disable the form immediately by switching to the submitted view so edits
        // during the in-flight RPC cannot diverge from the captured selections.
        setIsSubmitted(true);

        const responseLines: string[] = [];
        // answersRecord keyed by qid (AC-C3 round-trip): the C-producer maps each
        // qid back to its codex question for the JSON-RPC response.
        const answersRecord: Record<string, string> = {};
        interactiveQuestions.forEach((q, qIndex) => {
            const selected = selections.get(qIndex);
            if (!selected || selected.size === 0) return;
            const labels = Array.from(selected)
                .map((optIndex) => q.options[optIndex]?.label)
                .filter((l): l is string => !!l)
                .join(', ');
            if (!labels) return;
            answersRecord[answerKeyFor(q)] = labels;
            responseLines.push(`${q.header ?? q.question}: ${labels}`);
        });
        const responseText = responseLines.join('\n');
        // codex#1: remember the chosen answer so the read-only path can display it
        // immediately (before the producer's reply lands as tool.result/permission.answers).
        setSubmittedAnswerText(responseText || null);

        try {
            await sessionAllow(sessionId, tool.permission.id, undefined, undefined, undefined, responseText, answersRecord);
        } catch (error) {
            console.error('Failed to submit request_user_input answer:', error);
            // codex#1: the RPC failed — reopen the form so the user can retry rather
            // than be stranded on a submitted-but-unsent card.
            setIsSubmitted(false);
            setSubmittedAnswerText(null);
        } finally {
            setIsSubmitting(false);
        }
    }, [sessionId, tool.permission?.id, interactiveQuestions, selections, allQuestionsAnswered, isSubmitting]);

    // INTERACTIVE: selectable options + submit (mirrors AskUserQuestionView).
    if (isInteractive) {
        return (
            <ToolSectionView>
                <View style={styles.container}>
                    {interactiveQuestions.map((question, qIndex) => {
                        const selectedOptions = selections.get(qIndex) || new Set<number>();
                        return (
                            <View key={qIndex} style={styles.block}>
                                {question.header ? (
                                    <View style={styles.headerChip}>
                                        <Text style={styles.headerText}>{question.header}</Text>
                                    </View>
                                ) : null}
                                <Text style={styles.questionText}>{question.question}</Text>
                                <View style={styles.optionsContainer}>
                                    {question.options.map((option, oIndex) => {
                                        const isSelected = selectedOptions.has(oIndex);
                                        return (
                                            <TouchableOpacity
                                                key={oIndex}
                                                style={[
                                                    styles.optionButton,
                                                    isSelected && styles.optionButtonSelected,
                                                ]}
                                                onPress={() => handleOptionToggle(qIndex, oIndex, question.multiSelect)}
                                                activeOpacity={0.7}
                                            >
                                                {question.multiSelect ? (
                                                    <View style={[styles.checkboxOuter, isSelected && styles.checkboxOuterSelected]}>
                                                        {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                                                    </View>
                                                ) : (
                                                    <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                                                        {isSelected && <View style={styles.radioInner} />}
                                                    </View>
                                                )}
                                                <View style={styles.optionContent}>
                                                    <Text style={styles.optionLabel}>{option.label}</Text>
                                                    {option.description ? (
                                                        <Text style={styles.optionDescription}>{option.description}</Text>
                                                    ) : null}
                                                </View>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </View>
                        );
                    })}

                    <View style={styles.actionsContainer}>
                        <TouchableOpacity
                            style={[
                                styles.submitButton,
                                (!allQuestionsAnswered || isSubmitting) && styles.submitButtonDisabled,
                            ]}
                            onPress={handleSubmit}
                            disabled={!allQuestionsAnswered || isSubmitting}
                            activeOpacity={0.7}
                        >
                            {isSubmitting ? (
                                <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                            ) : (
                                <Text style={styles.submitButtonText}>{t('tools.askUserQuestion.submit')}</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </ToolSectionView>
        );
    }

    // READ-ONLY fallback. Failure / unavailable reason takes precedence so the card
    // surfaces why no answer is present instead of a blank dead-end.
    //
    // B11 precedence: for a genuinely FAILED (state==='error') call the B11 failure
    // helper MUST win — it strips <tool_use_error> wrappers, whereas
    // extractRequestUserInputUnavailableReason returns the RAW field text (which
    // would re-leak the tags for an error payload like
    // '<tool_use_error>request_user_input is unavailable in Default mode</tool_use_error>').
    // The unavailable extractor is used ONLY for the COMPLETED unavailable-in-Default
    // shape (no tags), where it surfaces the cleaned reason.
    const errorReason = tool.state === 'error'
        ? buildRequestUserInputFailureLineFromResult(tool.result)
        : extractRequestUserInputUnavailableReason(tool.result);

    // codex#1: resolve the displayed answer through producer-reply (summary.answer from
    // tool.result) -> the reducer-propagated permission.answers -> the locally-captured
    // submittedAnswerText, so the card shows the chosen answer immediately after submit
    // and never flashes 'No answer' in the post-submit / pre-reply window.
    const permissionAnswerText = formatPermissionAnswers(tool.permission?.answers);
    const resolvedAnswer = summary.answer ?? permissionAnswerText ?? submittedAnswerText;

    const hasContent = !!summary.prompt || summary.questions.length > 0
        || !!resolvedAnswer || !!errorReason || isSubmitted;
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
                        <Text style={resolvedAnswer ? styles.bodyText : styles.noAnswerText}>
                            {resolvedAnswer ?? t('tools.requestUserInput.noAnswer')}
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
    // Read-only option row (non-clickable).
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
    // Interactive option button (mirrors AskUserQuestionView).
    optionButton: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: theme.colors.divider,
        gap: 10,
        minHeight: 44, // Minimum touch target for mobile
    },
    optionButtonSelected: {
        backgroundColor: theme.colors.surfaceHigh,
        borderColor: theme.colors.radio.active,
    },
    radioOuter: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    radioOuterSelected: {
        borderColor: theme.colors.radio.active,
    },
    radioInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.colors.radio.dot,
    },
    checkboxOuter: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    checkboxOuterSelected: {
        borderColor: theme.colors.radio.active,
        backgroundColor: theme.colors.radio.active,
    },
    actionsContainer: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 8,
        justifyContent: 'flex-end',
    },
    submitButton: {
        backgroundColor: theme.colors.button.primary.background,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 44, // Minimum touch target for mobile
    },
    submitButtonDisabled: {
        opacity: 0.5,
    },
    submitButtonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 14,
        fontWeight: '600',
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

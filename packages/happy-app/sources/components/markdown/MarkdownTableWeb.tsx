import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '../StyledText';
import type { MarkdownSpan } from './parseMarkdown';
import { parseMarkdownSpans } from './parseMarkdownSpans';

// Render-prop signature for the span renderer that lives in MarkdownView.tsx.
// Passing as a prop avoids a circular import between this sibling and MarkdownView.
export type RenderSpansFn = React.ComponentType<{
    spans: MarkdownSpan[];
    baseStyle?: any;
    selectable: boolean;
    onLinkPress: (url: string) => void;
}>;

function useTableStyles() {
    const { theme } = useUnistyles();
    return React.useMemo(() => ({
        table: { borderCollapse: 'collapse' as const, width: 'auto' as const, fontSize: 16, lineHeight: '24px' },
        th: {
            padding: '8px 12px', borderBottom: `1px solid ${theme.colors.divider}`,
            borderRight: `1px solid ${theme.colors.divider}`, backgroundColor: theme.colors.surfaceHigh,
            color: theme.colors.text, fontFamily: 'IBMPlexSans-Regular', fontWeight: 600 as const,
            textAlign: 'left' as const, whiteSpace: 'nowrap' as const,
        },
        td: {
            padding: '8px 12px', borderBottom: `1px solid ${theme.colors.divider}`,
            borderRight: `1px solid ${theme.colors.divider}`, color: theme.colors.text,
            fontFamily: 'IBMPlexSans-Regular', fontWeight: 400 as const,
            textAlign: 'left' as const, whiteSpace: 'nowrap' as const,
        },
        container: {
            marginTop: 8, marginBottom: 8, border: `1px solid ${theme.colors.divider}`,
            borderRadius: 8, overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const,
            width: 'fit-content' as const, maxWidth: 'min(100%, calc(100vw - 32px))',
        },
    }), [theme]);
}

type CellProps = {
    text: string;
    cellStyle: React.CSSProperties;
    textStyle: any;
    selectable: boolean;
    onLinkPress: (url: string) => void;
    renderSpans: RenderSpansFn;
};

function WebTableCell(props: CellProps) {
    const RenderSpans = props.renderSpans;
    return (
        <td style={props.cellStyle}>
            <Text selectable={props.selectable} style={props.textStyle}>
                <RenderSpans
                    spans={parseMarkdownSpans(props.text, false)}
                    baseStyle={props.textStyle}
                    selectable={props.selectable}
                    onLinkPress={props.onLinkPress}
                />
            </Text>
        </td>
    );
}

function WebTableHeaderCell(props: CellProps & { thStyle: React.CSSProperties }) {
    const RenderSpans = props.renderSpans;
    return (
        <th style={props.thStyle}>
            <Text selectable={props.selectable} style={props.textStyle}>
                <RenderSpans
                    spans={parseMarkdownSpans(props.text, false)}
                    baseStyle={props.textStyle}
                    selectable={props.selectable}
                    onLinkPress={props.onLinkPress}
                />
            </Text>
        </th>
    );
}

function WebTableRow(props: {
    row: string[],
    colCount: number,
    isLast: boolean,
    tdStyle: React.CSSProperties,
    selectable: boolean,
    onLinkPress: (url: string) => void,
    renderSpans: RenderSpansFn,
    cellTextStyle: any,
}) {
    return (
        <tr>
            {Array.from({ length: props.colCount }, (_, colIndex) => (
                <WebTableCell
                    key={colIndex}
                    text={props.row[colIndex] ?? ''}
                    cellStyle={{
                        ...props.tdStyle,
                        borderBottom: props.isLast ? 'none' : props.tdStyle.borderBottom,
                        borderRight: colIndex === props.colCount - 1 ? 'none' : props.tdStyle.borderRight,
                    }}
                    textStyle={props.cellTextStyle}
                    selectable={props.selectable}
                    onLinkPress={props.onLinkPress}
                    renderSpans={props.renderSpans}
                />
            ))}
        </tr>
    );
}

function WebTableHead(props: {
    headers: string[],
    thStyle: React.CSSProperties,
    selectable: boolean,
    onLinkPress: (url: string) => void,
    renderSpans: RenderSpansFn,
    headerTextStyle: any,
}) {
    return (
        <thead>
            <tr>
                {props.headers.map((header, i) => (
                    <WebTableHeaderCell
                        key={i}
                        text={header}
                        thStyle={{
                            ...props.thStyle,
                            borderRight: i === props.headers.length - 1 ? 'none' : props.thStyle.borderRight,
                        }}
                        cellStyle={{}}
                        textStyle={props.headerTextStyle}
                        selectable={props.selectable}
                        onLinkPress={props.onLinkPress}
                        renderSpans={props.renderSpans}
                    />
                ))}
            </tr>
        </thead>
    );
}

function WebTableBody(props: {
    headers: string[],
    rows: string[][],
    tdStyle: React.CSSProperties,
    selectable: boolean,
    onLinkPress: (url: string) => void,
    renderSpans: RenderSpansFn,
    cellTextStyle: any,
}) {
    return (
        <tbody>
            {props.rows.map((row, i) => (
                <WebTableRow
                    key={i}
                    row={row}
                    colCount={props.headers.length}
                    isLast={i === props.rows.length - 1}
                    tdStyle={props.tdStyle}
                    selectable={props.selectable}
                    onLinkPress={props.onLinkPress}
                    renderSpans={props.renderSpans}
                    cellTextStyle={props.cellTextStyle}
                />
            ))}
        </tbody>
    );
}

type TableBlockWebProps = {
    headers: string[],
    rows: string[][],
    selectable: boolean,
    onLinkPress: (url: string) => void,
    renderSpans: RenderSpansFn,
    tableHeaderTextStyle: any,
    tableCellTextStyle: any,
};

function WebTableInner(props: TableBlockWebProps & { th: React.CSSProperties, td: React.CSSProperties, tableStyle: React.CSSProperties }) {
    return (
        // @ts-ignore
        <table style={props.tableStyle}>
            <WebTableHead
                headers={props.headers}
                thStyle={props.th}
                selectable={props.selectable}
                onLinkPress={props.onLinkPress}
                renderSpans={props.renderSpans}
                headerTextStyle={props.tableHeaderTextStyle}
            />
            <WebTableBody
                headers={props.headers}
                rows={props.rows}
                tdStyle={props.td}
                selectable={props.selectable}
                onLinkPress={props.onLinkPress}
                renderSpans={props.renderSpans}
                cellTextStyle={props.tableCellTextStyle}
            />
        </table>
    );
}

export function RenderTableBlockWeb(props: TableBlockWebProps) {
    const s = useTableStyles();
    return (
        // @ts-ignore
        <div style={s.container}>
            <WebTableInner {...props} th={s.th} td={s.td} tableStyle={s.table} />
        </div>
    );
}

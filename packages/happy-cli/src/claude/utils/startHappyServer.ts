/**
 * Happy MCP server
 * Provides Happy CLI specific tools including chat session title management
 *
 * Uses stateless StreamableHTTP: each request gets a fresh McpServer + transport.
 * This is required by MCP SDK >=1.27 which rejects reuse of an already-connected transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";

type TitleHandler = (title: string) => Promise<{ success: boolean; error?: string }>;

function buildSuccessResult(title: string) {
    return {
        content: [{ type: 'text' as const, text: `Successfully changed chat title to: "${title}"` }],
        isError: false,
    };
}

function buildErrorResult(error: string | undefined) {
    return {
        content: [{ type: 'text' as const, text: `Failed to change chat title: ${error || 'Unknown error'}` }],
        isError: true,
    };
}

function registerChangeTitleTool(mcp: McpServer, handler: TitleHandler) {
    mcp.registerTool('change_title', {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: { title: z.string().describe('The new title for the chat session') },
    }, async (args: { title: string }) => {
        const response = await handler(args.title);
        logger.debug('[happyMCP] Response:', response);
        return response.success ? buildSuccessResult(args.title) : buildErrorResult(response.error);
    });
}

function createMcpServer(handler: TitleHandler): McpServer {
    const mcp = new McpServer({ name: "Happy MCP", version: "1.0.0" });
    registerChangeTitleTool(mcp, handler);
    return mcp;
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, handler: TitleHandler) {
    const mcp = createMcpServer(handler);
    try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await mcp.connect(transport);
        await transport.handleRequest(req, res);
        res.on('close', () => { transport.close(); mcp.close(); });
    } catch (error) {
        logger.debug("Error handling request:", error);
        if (!res.headersSent) { res.writeHead(500).end(); }
        mcp.close();
    }
}

/**
 * Persist title to session metadata and send chat service message.
 * Fix for Bug #62 (commit 76b5cec3): the previous code used a fire-and-forget
 * updateMetadata inside sendClaudeSessionMessage and returned success immediately.
 * Now we await the metadata update before returning success.
 */
async function persistTitle(client: ApiSessionClient, title: string) {
    await client.updateMetadata((metadata) => ({
        ...metadata,
        summary: { text: title, updatedAt: Date.now() }
    }));
    logger.debug('[happyMCP] Metadata persisted for title:', title);
    client.sendClaudeSessionMessage({ type: 'summary', summary: title, leafUuid: randomUUID() });
}

function buildTitleHandler(client: ApiSessionClient): TitleHandler {
    return async (title: string) => {
        logger.debug('[happyMCP] Changing title to:', title);
        try {
            await persistTitle(client, title);
            return { success: true };
        } catch (error) {
            logger.debug('[happyMCP] Failed to persist metadata for title:', title, error);
            return { success: false, error: String(error) };
        }
    };
}

export async function startHappyServer(client: ApiSessionClient) {
    logger.debug(`[happyMCP] server:start sessionId=${client.sessionId}`);

    const handler = buildTitleHandler(client);

    const server = createServer((req, res) => handleMcpRequest(req, res, handler));

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    logger.debug(`[happyMCP] server:ready sessionId=${client.sessionId} url=${baseUrl.toString()}`);

    return {
        url: baseUrl.toString(),
        toolNames: ['change_title'],
        stop: () => {
            logger.debug(`[happyMCP] server:stop sessionId=${client.sessionId}`);
            server.close();
        }
    };
}

#!/usr/bin/env node
/**
 * investigate-sidechain.mjs
 *
 * Decrypts messages from two sessions (old working vs new broken),
 * compares their envelope structures, and simulates the reducer pipeline
 * to identify why sidechain messages fail to display.
 *
 * Usage: node scripts/investigate-sidechain.mjs <old_session_id> <new_session_id>
 */

import { execSync } from 'child_process';
import { createDecipheriv, createHmac } from 'crypto';
import sodium from 'libsodium-wrappers';

// ============================================================================
// Phase 1: Decryption utilities
// ============================================================================

function hmacSha512(key, data) {
    return createHmac('sha512', key).update(data).digest();
}

function deriveKey(master, usage, path) {
    let I = hmacSha512(Buffer.from(usage + ' Master Seed'), master);
    let state = { key: I.subarray(0, 32), chainCode: I.subarray(32) };
    for (const index of path) {
        I = hmacSha512(state.chainCode, Buffer.concat([Buffer.from([0x00]), Buffer.from(index, 'utf-8')]));
        state = { key: I.subarray(0, 32), chainCode: I.subarray(32) };
    }
    return state.key;
}

async function init() {
    await sodium.ready;
}

function decryptDEK(dekBase64, contentKeyPair) {
    const dekBytes = Buffer.from(dekBase64, 'base64');
    // Format: version(1) + ephPk(32) + nonce(24) + ciphertext
    const version = dekBytes[0]; // 0x00
    const ephPk = dekBytes.slice(1, 33);
    const nonce = dekBytes.slice(33, 57);
    const ciphertext = dekBytes.slice(57);

    const aesKey = sodium.crypto_box_open_easy(ciphertext, nonce, ephPk, contentKeyPair.privateKey);
    return Buffer.from(aesKey);
}

function decryptMessage(encryptedContent, aesKey) {
    if (!encryptedContent || encryptedContent.t !== 'encrypted' || !encryptedContent.c) {
        return encryptedContent; // Not encrypted
    }
    const msgBytes = Buffer.from(encryptedContent.c, 'base64');
    // Format: version(1) + nonce(12) + ciphertext + authTag(16)
    const version = msgBytes[0];
    const nonce = msgBytes.slice(1, 13);
    const ciphertext = msgBytes.slice(13, -16);
    const authTag = msgBytes.slice(-16);

    const dc = createDecipheriv('aes-256-gcm', aesKey, nonce);
    dc.setAuthTag(authTag);
    const decrypted = Buffer.concat([dc.update(ciphertext), dc.final()]);
    return JSON.parse(decrypted.toString('utf-8'));
}

// ============================================================================
// Phase 2: Database queries
// ============================================================================

function queryDB(sql) {
    const result = execSync(
        `docker exec happy-postgres psql -U yuge -d happydb -t -A -c "${sql.replace(/"/g, '\\"')}"`,
        { maxBuffer: 100 * 1024 * 1024 }
    ).toString().trim();
    return result;
}

function getSessionDEK(sessionId) {
    const result = queryDB(`SELECT encode("dataEncryptionKey", 'base64') FROM "Session" WHERE id = '${sessionId}'`);
    return result;
}

function getSessionMessages(sessionId, limit = 5000) {
    const result = queryDB(
        `SELECT id, seq, content::text, "localId" FROM "SessionMessage" WHERE "sessionId" = '${sessionId}' ORDER BY seq ASC LIMIT ${limit}`
    );
    if (!result) return [];
    return result.split('\n').map(line => {
        const parts = line.split('|');
        return {
            id: parts[0],
            seq: parseInt(parts[1]),
            content: JSON.parse(parts[2]),
            localId: parts[3] || null,
        };
    });
}

// ============================================================================
// Phase 3: Analysis
// ============================================================================

function analyzeDecryptedMessages(messages, sessionId) {
    const stats = {
        sessionId,
        totalMessages: messages.length,
        roleBreakdown: {},
        sessionProtocolCount: 0,
        legacyOutputCount: 0,
        duplexCount: 0,
        sidechainRelated: {
            withSubagentField: 0,
            toolCallStarts: 0,
            toolCallEnds: 0,
            startStopLifecycle: 0,
            textWithParent: 0,
            sidechainContentType: 0,
        },
        subagentIds: new Set(),
        toolCallIds: new Set(),
        sampleEnvelopes: [],
    };

    for (const msg of messages) {
        const content = msg.decrypted;
        if (!content) continue;

        // Count roles
        const role = content.role || 'unknown';
        stats.roleBreakdown[role] = (stats.roleBreakdown[role] || 0) + 1;

        // Check for duplex
        if (content.meta?.duplex) {
            stats.duplexCount++;
        }

        // Check session protocol
        if (role === 'session') {
            stats.sessionProtocolCount++;
            const envelope = content.content?.data || content.content;
            if (envelope?.ev) {
                const ev = envelope.ev;

                if (envelope.subagent) {
                    stats.sidechainRelated.withSubagentField++;
                    stats.subagentIds.add(envelope.subagent);
                }

                if (ev.t === 'tool-call-start') {
                    stats.sidechainRelated.toolCallStarts++;
                    stats.toolCallIds.add(ev.call);

                    // Capture sample envelope for Task/Agent tools
                    if (ev.name === 'Task' || ev.name === 'Agent') {
                        if (stats.sampleEnvelopes.length < 3) {
                            stats.sampleEnvelopes.push({
                                type: 'tool-call-start',
                                msgId: msg.id,
                                seq: msg.seq,
                                envelopeId: envelope.id,
                                call: ev.call,
                                name: ev.name,
                                subagent: envelope.subagent || null,
                                turn: envelope.turn,
                                role: envelope.role,
                            });
                        }
                    }
                }
                if (ev.t === 'tool-call-end') {
                    stats.sidechainRelated.toolCallEnds++;
                }
                if (ev.t === 'start' || ev.t === 'stop') {
                    stats.sidechainRelated.startStopLifecycle++;
                    if (stats.sampleEnvelopes.length < 5) {
                        stats.sampleEnvelopes.push({
                            type: ev.t,
                            msgId: msg.id,
                            seq: msg.seq,
                            envelopeId: envelope.id,
                            subagent: envelope.subagent || null,
                            turn: envelope.turn,
                            role: envelope.role,
                        });
                    }
                }
                if (ev.t === 'text' && envelope.subagent) {
                    stats.sidechainRelated.textWithParent++;
                }
            }
        }

        // Check legacy output
        if (role === 'agent' && content.content?.type === 'output') {
            stats.legacyOutputCount++;
            const data = content.content.data;
            if (data?.type === 'sidechain') {
                stats.sidechainRelated.sidechainContentType++;
            }
        }
    }

    // Find sidechain messages (session protocol with subagent field)
    // and check if their subagent IDs match any tool-call-start call IDs
    const subagentIdArray = Array.from(stats.subagentIds);
    const toolCallIdArray = Array.from(stats.toolCallIds);

    stats.subagentIdsMatchingToolCalls = subagentIdArray.filter(id => toolCallIdArray.includes(id)).length;
    stats.subagentIdsNotMatchingToolCalls = subagentIdArray.filter(id => !toolCallIdArray.includes(id)).length;
    stats.subagentIds = subagentIdArray;
    stats.toolCallIds = toolCallIdArray.slice(0, 20); // Limit output

    return stats;
}

// ============================================================================
// Phase 4: Simulate the reducer tracer pipeline
// ============================================================================

function isCuid2Like(value) {
    return /^[a-z][a-z0-9]{15,}$/.test(value);
}

function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function simulateNormalize(msg) {
    const content = msg.decrypted;
    if (!content) return null;

    // Duplex filter (line 736)
    if (content.meta?.duplex) {
        return { filtered: 'duplex', original: content };
    }

    // Session protocol path
    if (content.role === 'session') {
        let envelope;
        // preprocessMessageContent wrapping
        if (content.content?.type === 'session') {
            envelope = content.content.data;
        } else if (content.content?.id && content.content?.role && content.content?.ev) {
            envelope = content.content;
        } else {
            return { filtered: 'no_envelope', original: content };
        }

        if (!envelope || !envelope.ev) {
            return { filtered: 'no_ev', original: content };
        }

        // Drop agent envelopes without turn
        if (envelope.role === 'agent' && !envelope.turn) {
            return { filtered: 'no_turn', original: content };
        }

        // Drop start/stop lifecycle
        if (envelope.ev.t === 'start' || envelope.ev.t === 'stop') {
            return { filtered: 'lifecycle_' + envelope.ev.t, original: content };
        }

        // Drop turn-start
        if (envelope.ev.t === 'turn-start') {
            return { filtered: 'turn_start', original: content };
        }

        const parentUUID = envelope.subagent ?? null;
        const isSidechain = parentUUID !== null;

        if (envelope.ev.t === 'tool-call-start') {
            return {
                normalized: {
                    id: envelope.id,
                    role: 'agent',
                    isSidechain,
                    content: [{
                        type: 'tool-call',
                        id: envelope.ev.call,
                        name: envelope.ev.name || 'unknown',
                        uuid: envelope.id,
                        parentUUID,
                    }],
                }
            };
        }

        if (envelope.ev.t === 'text') {
            if (envelope.role === 'user') {
                return {
                    normalized: {
                        id: envelope.id,
                        role: 'user',
                        isSidechain: false,
                        content: { type: 'text', text: envelope.ev.text },
                    }
                };
            }
            return {
                normalized: {
                    id: envelope.id,
                    role: 'agent',
                    isSidechain,
                    content: [{
                        type: envelope.ev.thinking ? 'thinking' : 'text',
                        text: envelope.ev.text,
                        uuid: envelope.id,
                        parentUUID,
                    }],
                }
            };
        }

        if (envelope.ev.t === 'tool-call-end') {
            return {
                normalized: {
                    id: envelope.id,
                    role: 'agent',
                    isSidechain,
                    content: [{
                        type: 'tool-result',
                        tool_use_id: envelope.ev.call,
                        uuid: envelope.id,
                        parentUUID,
                    }],
                }
            };
        }

        if (envelope.ev.t === 'turn-end') {
            return {
                normalized: {
                    id: envelope.id,
                    role: 'event',
                    isSidechain: false,
                    content: { type: 'ready' },
                }
            };
        }

        return { filtered: 'unhandled_ev_' + envelope.ev.t, original: content };
    }

    // Legacy agent path
    if (content.role === 'agent') {
        return { normalized: { role: 'agent', legacy: true, type: content.content?.type } };
    }

    if (content.role === 'user') {
        return { normalized: { role: 'user', legacy: true } };
    }

    return { filtered: 'unknown_role', original: content };
}

function simulateTracer(normalizedMessages) {
    const state = {
        toolCallToMessageId: new Map(),
        promptToTaskId: new Map(),
        uuidToSidechainId: new Map(),
        orphanMessages: new Map(),
        processedIds: new Set(),
    };

    const stats = {
        totalNormalized: normalizedMessages.length,
        sidechainMessages: 0,
        nonSidechainMessages: 0,
        toolCallRegistrations: 0,
        taskAgentToolCalls: 0,
        sidechainRootMatches: 0,
        parentUuidLookupHits: 0,
        parentUuidLookupMisses: 0,
        orphansBuffered: 0,
        orphansFlushed: 0,
        orphansReleasedStandalone: 0,
        sidechainIdAssignments: 0,
        cuid2Checks: { total: 0, matched: 0, failed: 0 },
        sampleMisses: [],
    };

    for (const msg of normalizedMessages) {
        if (!msg.normalized) continue;
        const n = msg.normalized;
        if (n.legacy) continue;

        // Register tool-call-start
        if (n.role === 'agent' && Array.isArray(n.content)) {
            for (const c of n.content) {
                if (c.type === 'tool-call') {
                    state.toolCallToMessageId.set(c.id, n.id);
                    stats.toolCallRegistrations++;

                    // Flush orphans keyed by this tool call ID
                    const orphans = state.orphanMessages.get(c.id);
                    if (orphans) {
                        state.orphanMessages.delete(c.id);
                        stats.orphansFlushed += orphans.length;
                        for (const o of orphans) {
                            state.uuidToSidechainId.set(o.uuid || o.id, n.id);
                            stats.sidechainIdAssignments++;
                        }
                    }

                    if (c.name === 'Task' || c.name === 'Agent') {
                        stats.taskAgentToolCalls++;
                    }
                }
            }
        }

        // Handle sidechain messages
        if (n.isSidechain) {
            stats.sidechainMessages++;
            const parentUUID = n.content?.[0]?.parentUUID;

            if (parentUUID) {
                // Check Path B: toolCallToMessageId
                const parentSidechainId = state.uuidToSidechainId.get(parentUUID) || state.toolCallToMessageId.get(parentUUID);

                if (parentSidechainId) {
                    stats.parentUuidLookupHits++;
                    state.uuidToSidechainId.set(n.content[0].uuid || n.id, parentSidechainId);
                    stats.sidechainIdAssignments++;
                } else {
                    stats.parentUuidLookupMisses++;

                    // Check CUID2 pattern
                    stats.cuid2Checks.total++;
                    if (isUuidLike(parentUUID) || isCuid2Like(parentUUID)) {
                        stats.cuid2Checks.matched++;
                        const orphans = state.orphanMessages.get(parentUUID) || [];
                        orphans.push({ id: n.id, uuid: n.content[0]?.uuid });
                        state.orphanMessages.set(parentUUID, orphans);
                        stats.orphansBuffered++;
                    } else {
                        stats.cuid2Checks.failed++;
                        stats.orphansReleasedStandalone++;
                        if (stats.sampleMisses.length < 5) {
                            stats.sampleMisses.push({
                                messageId: n.id,
                                parentUUID,
                                isCuid2: isCuid2Like(parentUUID),
                                isUuid: isUuidLike(parentUUID),
                            });
                        }
                    }
                }
            } else {
                // No parent UUID - standalone sidechain
                stats.orphansReleasedStandalone++;
            }
        } else {
            stats.nonSidechainMessages++;
        }
    }

    // Report remaining orphans
    stats.remainingOrphans = state.orphanMessages.size;
    stats.remainingOrphanKeys = Array.from(state.orphanMessages.keys()).slice(0, 10);
    stats.remainingOrphanCounts = {};
    for (const [key, orphans] of state.orphanMessages) {
        stats.remainingOrphanCounts[key] = orphans.length;
    }

    return stats;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    await init();

    const oldSessionId = process.argv[2] || 'cmnag0drl8ifdnr14wn398c4e';
    const newSessionId = process.argv[3] || 'cmncb36ls202lt615dlvhqzas';

    console.log('=== Sidechain Investigation ===');
    console.log(`Old session: ${oldSessionId}`);
    console.log(`New session: ${newSessionId}`);

    // Derive content key pair
    const masterSecret = Buffer.from('gWwKFlcU7I3OixXUE+aiUEEEZyzRCQSL583hd3WgALs=', 'base64');
    const contentDataKey = deriveKey(masterSecret, 'Happy EnCoder', ['content']);
    const contentKeyPair = sodium.crypto_box_seed_keypair(contentDataKey);

    console.log('\nContent public key:', Buffer.from(contentKeyPair.publicKey).toString('base64'));

    // Process each session
    for (const sessionId of [oldSessionId, newSessionId]) {
        const label = sessionId === oldSessionId ? 'OLD' : 'NEW';
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Processing ${label} session: ${sessionId}`);
        console.log(`${'='.repeat(60)}`);

        // Get DEK
        const dekBase64 = getSessionDEK(sessionId);
        if (!dekBase64) {
            console.log('ERROR: No DEK found for session');
            continue;
        }

        let aesKey;
        try {
            aesKey = decryptDEK(dekBase64, contentKeyPair);
        } catch (e) {
            console.log('ERROR decrypting DEK:', e.message);
            continue;
        }
        console.log(`AES key derived (${aesKey.length} bytes)`);

        // Get messages
        console.log('Fetching messages...');
        const rawMessages = getSessionMessages(sessionId, 5000);
        console.log(`Fetched ${rawMessages.length} messages`);

        // Decrypt
        let decryptionErrors = 0;
        for (const msg of rawMessages) {
            try {
                msg.decrypted = decryptMessage(msg.content, aesKey);
            } catch (e) {
                decryptionErrors++;
                msg.decrypted = null;
            }
        }
        console.log(`Decrypted: ${rawMessages.length - decryptionErrors} success, ${decryptionErrors} errors`);

        // Analyze raw decrypted messages
        const analysis = analyzeDecryptedMessages(rawMessages, sessionId);
        console.log('\n--- Raw Message Analysis ---');
        console.log(`Total: ${analysis.totalMessages}`);
        console.log(`Roles:`, analysis.roleBreakdown);
        console.log(`Session protocol: ${analysis.sessionProtocolCount}`);
        console.log(`Legacy output: ${analysis.legacyOutputCount}`);
        console.log(`Duplex: ${analysis.duplexCount}`);
        console.log(`\nSidechain-related:`);
        console.log(`  With subagent field: ${analysis.sidechainRelated.withSubagentField}`);
        console.log(`  tool-call-start: ${analysis.sidechainRelated.toolCallStarts}`);
        console.log(`  tool-call-end: ${analysis.sidechainRelated.toolCallEnds}`);
        console.log(`  start/stop lifecycle: ${analysis.sidechainRelated.startStopLifecycle}`);
        console.log(`  text with subagent: ${analysis.sidechainRelated.textWithParent}`);
        console.log(`  sidechain content type (legacy): ${analysis.sidechainRelated.sidechainContentType}`);
        console.log(`\nSubagent IDs (${analysis.subagentIds.length}):`, analysis.subagentIds.slice(0, 10));
        console.log(`Tool call IDs matching subagent IDs: ${analysis.subagentIdsMatchingToolCalls}`);
        console.log(`Tool call IDs NOT matching: ${analysis.subagentIdsNotMatchingToolCalls}`);
        console.log(`\nSample envelopes:`, JSON.stringify(analysis.sampleEnvelopes, null, 2));

        // Simulate normalization
        console.log('\n--- Normalization Simulation ---');
        const normalizedResults = rawMessages.map(m => simulateNormalize(m));
        const filterCounts = {};
        let normalizedCount = 0;
        for (const r of normalizedResults) {
            if (r.filtered) {
                filterCounts[r.filtered] = (filterCounts[r.filtered] || 0) + 1;
            }
            if (r.normalized) normalizedCount++;
        }
        console.log(`Normalized: ${normalizedCount}`);
        console.log(`Filtered:`, filterCounts);

        // Simulate tracer
        console.log('\n--- Tracer Simulation ---');
        const tracerStats = simulateTracer(normalizedResults);
        console.log(`Total normalized input: ${tracerStats.totalNormalized}`);
        console.log(`Sidechain messages: ${tracerStats.sidechainMessages}`);
        console.log(`Non-sidechain: ${tracerStats.nonSidechainMessages}`);
        console.log(`Tool call registrations: ${tracerStats.toolCallRegistrations}`);
        console.log(`Task/Agent tool calls: ${tracerStats.taskAgentToolCalls}`);
        console.log(`\nSidechain linking:`);
        console.log(`  Root matches (Path A, promptToTaskId): ${tracerStats.sidechainRootMatches}`);
        console.log(`  Parent UUID hits (Path B, toolCallToMessageId): ${tracerStats.parentUuidLookupHits}`);
        console.log(`  Parent UUID misses: ${tracerStats.parentUuidLookupMisses}`);
        console.log(`  CUID2 checks: ${tracerStats.cuid2Checks.total} (matched: ${tracerStats.cuid2Checks.matched}, failed: ${tracerStats.cuid2Checks.failed})`);
        console.log(`  Orphans buffered: ${tracerStats.orphansBuffered}`);
        console.log(`  Orphans flushed: ${tracerStats.orphansFlushed}`);
        console.log(`  Released standalone: ${tracerStats.orphansReleasedStandalone}`);
        console.log(`  SidechainId assignments: ${tracerStats.sidechainIdAssignments}`);
        console.log(`  Remaining orphans: ${tracerStats.remainingOrphans}`);
        if (tracerStats.remainingOrphanKeys.length > 0) {
            console.log(`  Remaining orphan keys:`, tracerStats.remainingOrphanKeys);
            console.log(`  Remaining orphan counts:`, tracerStats.remainingOrphanCounts);
        }
        if (tracerStats.sampleMisses.length > 0) {
            console.log(`  Sample misses:`, JSON.stringify(tracerStats.sampleMisses, null, 2));
        }

        // Store for comparison
        if (label === 'OLD') {
            global._oldStats = { analysis, tracerStats, filterCounts, normalizedCount };
        } else {
            global._newStats = { analysis, tracerStats, filterCounts, normalizedCount };
        }
    }

    // Comparison
    console.log(`\n${'='.repeat(60)}`);
    console.log('=== COMPARISON ===');
    console.log(`${'='.repeat(60)}`);

    if (global._oldStats && global._newStats) {
        const old = global._oldStats;
        const nw = global._newStats;

        console.log('\nKey differences:');
        console.log(`Session protocol msgs: OLD=${old.analysis.sessionProtocolCount} NEW=${nw.analysis.sessionProtocolCount}`);
        console.log(`Legacy output msgs: OLD=${old.analysis.legacyOutputCount} NEW=${nw.analysis.legacyOutputCount}`);
        console.log(`Duplex msgs: OLD=${old.analysis.duplexCount} NEW=${nw.analysis.duplexCount}`);
        console.log(`Subagent fields: OLD=${old.analysis.sidechainRelated.withSubagentField} NEW=${nw.analysis.sidechainRelated.withSubagentField}`);
        console.log(`Task/Agent tool calls: OLD=${old.tracerStats.taskAgentToolCalls} NEW=${nw.tracerStats.taskAgentToolCalls}`);
        console.log(`Sidechain messages traced: OLD=${old.tracerStats.sidechainMessages} NEW=${nw.tracerStats.sidechainMessages}`);
        console.log(`Path B hits: OLD=${old.tracerStats.parentUuidLookupHits} NEW=${nw.tracerStats.parentUuidLookupHits}`);
        console.log(`Path B misses: OLD=${old.tracerStats.parentUuidLookupMisses} NEW=${nw.tracerStats.parentUuidLookupMisses}`);
        console.log(`Remaining orphans: OLD=${old.tracerStats.remainingOrphans} NEW=${nw.tracerStats.remainingOrphans}`);
        console.log(`SidechainId assignments: OLD=${old.tracerStats.sidechainIdAssignments} NEW=${nw.tracerStats.sidechainIdAssignments}`);
    }
}

main().catch(console.error);

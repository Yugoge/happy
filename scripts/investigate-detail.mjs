#!/usr/bin/env node
/**
 * investigate-detail.mjs
 *
 * Detailed inspection of tool-call-start envelopes and sidechain linkage
 * for a specific session.
 */

import { execSync } from 'child_process';
import { createDecipheriv, createHmac } from 'crypto';
import sodium from 'libsodium-wrappers';

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

async function main() {
    await sodium.ready;

    const sessionId = process.argv[2] || 'cmncb36ls202lt615dlvhqzas';
    const masterSecret = Buffer.from('gWwKFlcU7I3OixXUE+aiUEEEZyzRCQSL583hd3WgALs=', 'base64');
    const cdk = deriveKey(masterSecret, 'Happy EnCoder', ['content']);
    const kp = sodium.crypto_box_seed_keypair(cdk);

    // Get DEK - write query to temp file to avoid shell escaping issues
    const fs = await import('fs');
    const dekQuery = `SELECT encode("dataEncryptionKey", 'base64') FROM "Session" WHERE id = '${sessionId}'`;
    fs.writeFileSync('/tmp/dek_query.sql', dekQuery);
    const dekB64 = execSync('docker exec -i happy-postgres psql -U yuge -d happydb -t -A < /tmp/dek_query.sql').toString().trim();

    const dekBytes = Buffer.from(dekB64, 'base64');
    const ephPk = dekBytes.slice(1, 33);
    const nonce = dekBytes.slice(33, 57);
    const ciphertext = dekBytes.slice(57);
    const aesKey = Buffer.from(sodium.crypto_box_open_easy(ciphertext, nonce, ephPk, kp.privateKey));

    // Get messages
    const startSeq = parseInt(process.argv[3] || '0');
    const msgQuery = `SELECT seq, content::text FROM "SessionMessage" WHERE "sessionId" = '${sessionId}' AND seq > ${startSeq} ORDER BY seq ASC LIMIT 500`;
    fs.writeFileSync('/tmp/msg_query.sql', msgQuery);
    const rawOutput = execSync('docker exec -i happy-postgres psql -U yuge -d happydb -t -A < /tmp/msg_query.sql', { maxBuffer: 100*1024*1024 }).toString().trim();

    const lines = rawOutput.split('\n');
    console.log(`Session: ${sessionId}`);
    console.log(`Total messages fetched: ${lines.length}`);
    console.log();

    // Track tool-call-start details and sidechain messages
    const toolCallStarts = [];
    const sidechainMsgs = [];
    const subagentIdToCallId = new Map(); // subagent -> call in tool-call-start

    for (const line of lines) {
        const pipeIdx = line.indexOf('|');
        const seq = parseInt(line.substring(0, pipeIdx));
        const contentStr = line.substring(pipeIdx + 1);

        let content;
        try {
            content = JSON.parse(contentStr);
        } catch { continue; }

        if (content.t !== 'encrypted') continue;

        let decrypted;
        try {
            const msgBytes = Buffer.from(content.c, 'base64');
            const mnonce = msgBytes.slice(1, 13);
            const mciphertext = msgBytes.slice(13, -16);
            const authTag = msgBytes.slice(-16);
            const dc = createDecipheriv('aes-256-gcm', aesKey, mnonce);
            dc.setAuthTag(authTag);
            decrypted = JSON.parse(Buffer.concat([dc.update(mciphertext), dc.final()]).toString('utf-8'));
        } catch { continue; }

        // Session protocol messages
        if (decrypted.role === 'session') {
            const envelope = decrypted.content?.data || decrypted.content;
            if (!envelope?.ev) continue;

            if (envelope.ev.t === 'tool-call-start' && (envelope.ev.name === 'Agent' || envelope.ev.name === 'Task')) {
                toolCallStarts.push({
                    seq,
                    call: envelope.ev.call,
                    name: envelope.ev.name,
                    subagent: envelope.subagent || null,
                    envelopeId: envelope.id,
                    turn: envelope.turn,
                });
            }

            if (envelope.subagent && envelope.ev.t !== 'start' && envelope.ev.t !== 'stop') {
                sidechainMsgs.push({
                    seq,
                    subagent: envelope.subagent,
                    evType: envelope.ev.t,
                    envelopeId: envelope.id,
                    parentUUID: envelope.subagent,  // normalizeSessionEnvelope sets parentUUID = envelope.subagent
                });
            }

            if (envelope.ev.t === 'start' || envelope.ev.t === 'stop') {
                console.log(`  [seq ${seq}] lifecycle ${envelope.ev.t}: subagent=${envelope.subagent}`);
            }
        }

        // Also check legacy duplex messages
        if (decrypted.role === 'agent' && decrypted.meta?.duplex) {
            const data = decrypted.content?.data;
            if (data?.type === 'assistant') {
                const blocks = data?.message?.content || [];
                for (const b of blocks) {
                    if (b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task')) {
                        console.log(`  [seq ${seq}] LEGACY duplex Task/Agent tool_use: id=${b.id} name=${b.name}`);
                    }
                }
            }
        }
    }

    console.log('\n=== Task/Agent tool-call-start envelopes ===');
    for (const tcs of toolCallStarts) {
        console.log(`  seq=${tcs.seq} call=${tcs.call} name=${tcs.name} subagent=${tcs.subagent}`);
    }

    console.log(`\n=== Sidechain messages (first 20) ===`);
    const uniqueSubagents = new Set(sidechainMsgs.map(m => m.subagent));
    console.log(`Total sidechain messages: ${sidechainMsgs.length}`);
    console.log(`Unique subagent IDs: ${uniqueSubagents.size}`);
    for (const msg of sidechainMsgs.slice(0, 20)) {
        console.log(`  seq=${msg.seq} subagent=${msg.subagent} ev=${msg.evType}`);
    }

    // Check linkage
    console.log('\n=== Linkage Analysis ===');
    const callIdsFromToolCallStarts = new Set(toolCallStarts.map(t => t.call));
    let linked = 0;
    let unlinked = 0;
    const unlinkedSubagents = new Set();

    for (const msg of sidechainMsgs) {
        // The app does: toolCallToMessageId.get(parentUUID)
        // parentUUID = envelope.subagent (from normalizeSessionEnvelope line 561)
        // toolCallToMessageId is populated by: toolCallToMessageId.set(content.id, message.id)
        // where content.id = envelope.ev.call (from tool-call-start normalization at line 662)

        if (callIdsFromToolCallStarts.has(msg.subagent)) {
            linked++;
        } else {
            unlinked++;
            unlinkedSubagents.add(msg.subagent);
        }
    }

    console.log(`Sidechain messages linked to tool-call-start: ${linked}`);
    console.log(`Sidechain messages UNLINKED: ${unlinked}`);
    console.log(`Unlinked subagent IDs: ${Array.from(unlinkedSubagents).slice(0, 10)}`);

    if (toolCallStarts.length > 0) {
        console.log(`\nFirst tool-call-start call ID: ${toolCallStarts[0].call}`);
        console.log(`First sidechain subagent ID: ${sidechainMsgs[0]?.subagent}`);
        console.log(`Do they match? ${toolCallStarts[0].call === sidechainMsgs[0]?.subagent}`);
    }
}

main().catch(console.error);

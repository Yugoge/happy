import { Fastify } from '../types';
import { isLocalStorage, getLocalFilesDir, s3client, s3bucket } from '@/storage/files';
import * as path from 'path';
import * as fs from 'fs';

function serveLocalFile(filePath: string, reply: any) {
    const baseDir = path.resolve(getLocalFilesDir());
    const fullPath = path.resolve(baseDir, filePath);
    if (!fullPath.startsWith(baseDir + path.sep)) {
        return reply.code(403).send('Forbidden');
    }
    if (!fs.existsSync(fullPath)) {
        return reply.code(404).send('Not found');
    }
    return reply.send(fs.createReadStream(fullPath));
}

async function serveS3File(filePath: string, reply: any) {
    try {
        const stream = await s3client.getObject(s3bucket, filePath);
        return reply.send(stream);
    } catch (e: any) {
        const status = e?.code === 'NoSuchKey' ? 404 : 500;
        return reply.code(status).send(status === 404 ? 'Not found' : 'Storage error');
    }
}

/**
 * Serves files from local storage or S3/MinIO.
 * All file URLs proxy through the server so browsers can access them.
 */
export function fileRoutes(app: Fastify) {
    app.get('/files/*', async function (request, reply) {
        const filePath = (request.params as any)['*'];
        if (!filePath) return reply.code(400).send('Missing file path');

        if (isLocalStorage()) return serveLocalFile(filePath, reply);
        return serveS3File(filePath, reply);
    });
}

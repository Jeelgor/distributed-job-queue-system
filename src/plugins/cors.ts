import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

export async function corsPlugin(app: FastifyInstance) {
  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] ? process.env['CORS_ORIGIN'].split(',') : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
}

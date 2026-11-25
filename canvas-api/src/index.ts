import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
const server = app.listen(config.port, () => {
    console.log(`canvas-api listening on http://127.0.0.1:${config.port}`);
    console.log(`registration mode: ${config.registrationMode}, auto verify email: ${config.autoVerifyEmail}`);
});

const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down`);
    server.close(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

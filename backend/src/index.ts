import app from './app.js';
import { config } from './config/index.js';

async function start() {
  try {
    const address = await app.listen({ port: config.port, host: config.host });
    app.log.info(`IoT Explorer Backend listening on ${address}`);
  } catch (err) {
    app.log.fatal(err, 'Failed to start server');
    process.exit(1);
  }
}

start();

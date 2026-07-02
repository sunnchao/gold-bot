import { loadGoldBotEnv } from '@gold-bot/config';
import { createSqliteEaStore } from '@gold-bot/persistence';
import { createAppServer } from './app.js';

const env = loadGoldBotEnv();
const app = createAppServer({
  store: env.GB_EA_STORE_SQLITE_PATH === '' ? undefined : createSqliteEaStore(env.GB_EA_STORE_SQLITE_PATH),
  defaultRuntimeMode: env.GB_NODE_SHADOW_MODE ? 'shadow' : 'oracle'
});

await app.listen(env.GB_APP_SERVER_PORT, env.GB_APP_SERVER_HOST);

console.log(`app-server listening on http://${env.GB_APP_SERVER_HOST}:${env.GB_APP_SERVER_PORT}`);

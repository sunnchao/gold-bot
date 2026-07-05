import { loadGoldBotEnv } from '@gold-bot/config';
import { createSqliteEaStore } from '@gold-bot/persistence';
import { createAppServer } from './app.js';
import { bootstrapTokens } from './bootstrap/tokens.js';

const env = loadGoldBotEnv();
const store = env.GB_EA_STORE_SQLITE_PATH === '' ? undefined : createSqliteEaStore(env.GB_EA_STORE_SQLITE_PATH);

// Bootstrap tokens on startup
if (store) {
  bootstrapTokens(store, env.GB_ADMIN_TOKEN, env.GB_LEGACY_TOKENS_PATH);
}

const adminTokens = env.GB_ADMIN_TOKEN === '' ? [] : [env.GB_ADMIN_TOKEN];
const app = createAppServer({
  store,
  validTokens: adminTokens,
  adminTokens,
  defaultRuntimeMode: env.GB_NODE_SHADOW_MODE ? 'shadow' : 'cutover'
});

await app.listen(env.GB_APP_SERVER_PORT, env.GB_APP_SERVER_HOST);

console.log(`app-server listening on http://${env.GB_APP_SERVER_HOST}:${env.GB_APP_SERVER_PORT}`);

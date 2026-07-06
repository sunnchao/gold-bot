import { loadGoldBotEnv } from '@gold-bot/config';
import { createPostgresEaStore, createSqliteEaStore } from '@gold-bot/persistence';
import { DiscordNotifier, FeishuNotifier } from '@gold-bot/notifications';
import { createAppServer } from './app.js';
import { bootstrapTokens } from './bootstrap/tokens.js';

const env = loadGoldBotEnv();
let store = env.GB_EA_STORE_POSTGRES_DSN !== ''
  ? await createPostgresEaStore(env.GB_EA_STORE_POSTGRES_DSN)
  : env.GB_EA_STORE_SQLITE_PATH === ''
    ? undefined
    : createSqliteEaStore(env.GB_EA_STORE_SQLITE_PATH);
if (store === null) {
  if (env.GB_EA_STORE_SQLITE_PATH !== '') {
    console.warn('GB_EA_STORE_POSTGRES_DSN unreachable, falling back to sqlite');
    store = createSqliteEaStore(env.GB_EA_STORE_SQLITE_PATH);
  } else {
    console.warn('GB_EA_STORE_POSTGRES_DSN unreachable, falling back to in-memory');
    store = undefined;
  }
}

// Bootstrap tokens on startup
if (store) {
  await bootstrapTokens(store, env.GB_ADMIN_TOKEN, env.GB_LEGACY_TOKENS_PATH);
}

const adminTokens = env.GB_ADMIN_TOKEN === '' ? [] : [env.GB_ADMIN_TOKEN];
const discord = new DiscordNotifier({ webhookUrl: env.GB_DISCORD_WEBHOOK_URL, log: (m) => console.log(m) });
const feishu = new FeishuNotifier({ webhookUrl: env.GB_FEISHU_WEBHOOK_URL, secret: env.GB_FEISHU_SECRET, log: (m) => console.log(m) });
const app = await createAppServer({
  store,
  validTokens: adminTokens,
  adminTokens,
  defaultRuntimeMode: env.GB_NODE_SHADOW_MODE ? 'shadow' : 'cutover',
  discord,
  feishu
});

await app.listen(env.GB_APP_SERVER_PORT, env.GB_APP_SERVER_HOST);

console.log(`app-server listening on http://${env.GB_APP_SERVER_HOST}:${env.GB_APP_SERVER_PORT}`);

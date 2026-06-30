module.exports = {
  apps: [{
    name: 'gold-analysis-agent',
    script: 'dist/main.js',
    cwd: '/root/gold-bot/agents',
    autorestart: true,
    max_restarts: 10,
    env: {
      NODE_ENV: 'production',
      GOLDBOT_API_URL: process.env.GOLDBOT_API_URL || 'http://127.0.0.1:8880',
      GOLDBOT_API_TOKEN: process.env.GOLDBOT_API_TOKEN,
      REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
      LLM_PROVIDER: process.env.LLM_PROVIDER || 'openai',
      LLM_BASE_URL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL || 'gpt-4o',
      LLM_FALLBACK_MODEL: process.env.LLM_FALLBACK_MODEL || 'gpt-4o-mini',
      LLM_TIMEOUT: process.env.LLM_TIMEOUT || '120000',
      LLM_MAX_RETRIES: process.env.LLM_MAX_RETRIES || '3',
      PORT: '3100',
      ACCOUNTS_CONFIG_FILE: '/root/gold-bot/agents/accounts.json',
    }
  }]
};

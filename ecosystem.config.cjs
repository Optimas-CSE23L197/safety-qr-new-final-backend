// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'api',
      script: 'src/server.js',
      max_memory_restart: '400M',
      node_args: '--import tsx/esm',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'emergency-worker',
      script: 'src/orchestrator/workers/index.js',
      max_memory_restart: '200M',
      node_args: '--import tsx/esm',
      env: {
        NODE_ENV: 'production',
        WORKER_ROLE: 'emergency',
      },
    },
    {
      name: 'notification-worker',
      script: 'src/orchestrator/workers/index.js',
      max_memory_restart: '200M',
      node_args: '--import tsx/esm',
      env: {
        NODE_ENV: 'production',
        WORKER_ROLE: 'notification',
      },
    },
  ],
};

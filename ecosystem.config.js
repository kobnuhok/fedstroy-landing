module.exports = {
  apps: [
    {
      name: 'fedstroy-landing',
      script: 'server.js',
      // Режим fork с одним процессом предотвращает race conditions при атомарной записи в leads.json
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 8080,
        KEEP_UPLOADED_FILES: 'true'
      }
    }
  ]
};

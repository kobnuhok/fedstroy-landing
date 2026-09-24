module.exports = {
  apps: [
    {
      name: 'fedstroy-landing',
      script: 'server.js',
      instances: 'max',
      exec_mode: 'cluster',
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

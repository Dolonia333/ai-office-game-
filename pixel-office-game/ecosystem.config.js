module.exports = {
  apps: [
    {
      name: "dolonia",
      script: "server.js",
      instances: 1,
      autorestart: true,
      max_memory_restart: "256M",
      env: {
        PORT: 8080,
      },
    },
  ],
};

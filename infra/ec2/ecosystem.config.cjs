module.exports = {
  apps: [
    {
      name: "trapit-web",
      cwd: "/var/www/trapit/apps/web",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 0.0.0.0 -p 3000",
      env: {
        NODE_ENV: "production",
        TRAPIT_DATA_DIR: "/var/lib/trapit",
      },
    },
  ],
};
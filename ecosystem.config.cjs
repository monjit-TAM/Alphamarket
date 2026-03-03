const fs = require('fs');
const path = require('path');
const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val.length) env[key.trim()] = val.join('=').trim();
});

module.exports = {
  apps: [{
    name: "alphamarket",
    script: "./dist/index.cjs",
    cwd: "/var/www/alphamarket",
    env: env
  }]
};

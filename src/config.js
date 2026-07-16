const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.updatespage');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return null;
    }
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`Failed to load config: ${error.message}`);
  }
}

function saveConfig(config) {
  try {
    ensureConfigDir();
    // The config holds an API key — keep it readable by the owner only
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch (error) {
    throw new Error(`Failed to save config: ${error.message}`);
  }
}

function requireConfig() {
  const config = loadConfig();
  if (!config || !config.apiKey || !config.baseUrl) {
    throw new Error('Not configured. Run: updates config --api-key <key> --url <url>');
  }
  return config;
}

module.exports = {
  loadConfig,
  saveConfig,
  requireConfig,
};

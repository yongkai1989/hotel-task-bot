/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  const fileConfig = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : {};
  return {
    appUrl: String(
      process.env.PRINTER_APP_URL ||
        fileConfig.appUrl ||
        'https://crown.hotelhallmark.com'
    ).trim(),
    bridgeKey: String(
      process.env.PRINTER_BRIDGE_KEY ||
        fileConfig.bridgeKey ||
        ''
    ).trim(),
  };
}

function appOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/$/, '');
  }
}

async function main() {
  const config = loadConfig();
  if (!config.bridgeKey || config.bridgeKey.includes('CHANGE_ME')) {
    throw new Error('Missing bridgeKey. Use the same config.json as the printer bridge.');
  }

  const response = await fetch(
    `${appOrigin(config.appUrl)}/api/operational-reminders?kind=hk-morning-review`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.bridgeKey}`,
        'x-printer-bridge-key': config.bridgeKey,
      },
      cache: 'no-store',
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `HK morning review request failed: ${response.status}`);
  }

  console.log(
    payload.alreadySent
      ? 'The 8:30 AM HK morning review was already sent today.'
      : `HK morning review sent in ${Number(payload.attempted || 1)} Telegram message(s).`
  );
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});

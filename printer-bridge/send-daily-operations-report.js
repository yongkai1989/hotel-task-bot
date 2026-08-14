/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  let fileConfig = {};

  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  return {
    appUrl: String(
      process.env.PRINTER_APP_URL ||
        fileConfig.appUrl ||
        'https://crown.hotelhallmark.com'
    ).trim(),
    bridgeKey: String(
      process.env.PRINTER_BRIDGE_KEY || fileConfig.bridgeKey || ''
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
    throw new Error(
      'Missing bridgeKey. Use the same config.json and PRINTER_BRIDGE_KEY as the printer bridge.'
    );
  }

  const response = await fetch(
    `${appOrigin(config.appUrl)}/api/cron/daily-operations-telegram`,
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
    throw new Error(payload?.error || `Report request failed: ${response.status}`);
  }

  if (payload.alreadySent) {
    console.log(`Daily operations report for ${payload.reportDate} was already sent.`);
    return;
  }

  console.log(`Daily operations report for ${payload.reportDate} sent successfully.`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});

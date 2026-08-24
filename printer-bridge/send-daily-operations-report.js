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

  async function request(pathname) {
    const response = await fetch(`${appOrigin(config.appUrl)}${pathname}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.bridgeKey}`,
        'x-printer-bridge-key': config.bridgeKey,
      },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Request failed: ${response.status}`);
    }
    return payload;
  }

  const [reportResult, maintenanceResult] = await Promise.allSettled([
    request('/api/daily-operations-telegram'),
    request('/api/operational-reminders?kind=preventive-maintenance'),
  ]);

  if (reportResult.status === 'fulfilled') {
    const report = reportResult.value;
    console.log(
      report.alreadySent
        ? `Daily operations report for ${report.reportDate} was already sent.`
        : `Daily operations report for ${report.reportDate} sent successfully.`
    );
  } else {
    console.error(`Daily operations report failed: ${reportResult.reason?.message || reportResult.reason}`);
  }

  if (maintenanceResult.status === 'fulfilled') {
    const maintenance = maintenanceResult.value;
    console.log(
      maintenance.alreadySent
        ? 'Preventive Maintenance reminder was already processed today.'
        : maintenance.findingCount
          ? `Preventive Maintenance reminder sent for ${maintenance.findingCount} overdue task(s).`
          : 'No overdue Preventive Maintenance reminder was needed.'
    );
  } else {
    console.error(`Preventive Maintenance reminder failed: ${maintenanceResult.reason?.message || maintenanceResult.reason}`);
  }

  const failures = [reportResult, maintenanceResult].filter((result) => result.status === 'rejected');
  if (failures.length) throw new Error(`${failures.length} scheduled 9:00 AM request(s) failed.`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});

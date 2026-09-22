'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const VERSION = '2.0.0';
const ROOT = __dirname;
const configPath = path.join(ROOT, 'guest-shop-printers.json');
const statePath = path.join(ROOT, 'guest-shop-printer-state.json');

if (!fs.existsSync(configPath)) {
  throw new Error('Missing guest-shop-printers.json. Copy guest-shop-printers.example.json and enter the printer IP addresses and bridge key.');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const appUrl = String(config.appUrl || '').replace(/\/+$/, '');
const bridgeKey = String(config.bridgeKey || '');
const pollSeconds = Math.max(5, Number(config.pollSeconds || 10));
const printers = config.printers || {};
if (!appUrl || !bridgeKey) throw new Error('appUrl and bridgeKey are required.');

function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return { pendingAcks: {} }; }
}

function saveState(state) {
  const temp = `${statePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, statePath);
}

function headers(role, maintenancePulse = false) {
  return {
    'x-printer-bridge-key': bridgeKey,
    'x-printer-role': role,
    'x-printer-device': os.hostname(),
    'x-bridge-version': VERSION,
    ...(maintenancePulse ? { 'x-maintenance-pulse': '1' } : {}),
    'content-type': 'application/json',
  };
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function line(text = '') { return `${String(text)}\n`; }
function ticket(role, order) {
  const items = Array.isArray(order.items_json) ? order.items_json : [];
  let text = '\x1b@\x1ba\x01';
  text += line('HALLMARK CROWN HOTEL');
  text += line(role === 'FNB' ? 'F&B ORDER' : role === 'FO' ? 'FRONT OFFICE COPY' : 'BREAKFAST TICKET');
  text += line('--------------------------------');
  text += '\x1ba\x00';
  text += line(`Room: ${order.room_number || '-'}`);
  text += line(`Guest: ${order.guest_name || '-'}`);
  text += line(`Paid: ${order.paid_at ? new Date(order.paid_at).toLocaleString('en-MY') : '-'}`);
  text += line(`Reference: ${order.payment_reference || '-'}`);
  text += line('--------------------------------');
  for (const item of items) {
    const qty = Number(item.quantity || item.qty || 1);
    text += line(`${qty} x ${item.name || item.item_name || 'Item'}`);
    const options = Array.isArray(item.selected_options)
      ? item.selected_options.flatMap((group) => Array.isArray(group.options) ? group.options.map((option) => option.name) : []).filter(Boolean)
      : [];
    if (options.length) text += line(`  ${options.join(', ')}`);
    if (item.special_instructions) text += line(`  NOTE: ${item.special_instructions}`);
  }
  text += line('--------------------------------');
  text += line(`TOTAL RM${Number(order.total_myr || 0).toFixed(2)}`);
  if (role === 'BREAKFAST') {
    text += line('Breakfast service: 7:00 AM - 11:00 AM');
    if (order.paid_at) {
      const paidHour = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kuala_Lumpur',
        hour: '2-digit',
        hour12: false,
      }).format(new Date(order.paid_at)));
      if (paidHour >= 11) text += line('Service: NEXT BREAKFAST');
    }
    if (order.voucher_code) text += line(`Voucher: ${order.voucher_code}`);
  }
  text += line('\n\n');
  return Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0x1d, 0x56, 0x00])]);
}

function sendToPrinter(role, order) {
  const printer = printers[role];
  if (!printer?.host || printer.enabled === false) return Promise.reject(new Error(`${role} printer is not configured or enabled.`));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: printer.host, port: Number(printer.port || 9100), timeout: 8000 });
    socket.once('connect', () => socket.end(ticket(role, order)));
    socket.once('timeout', () => socket.destroy(new Error('Printer connection timed out.')));
    socket.once('error', reject);
    socket.once('close', (hadError) => { if (!hadError) resolve(); });
  });
}

async function acknowledge(role, id, status, printError = '') {
  return request(`${appUrl}/api/guest-shop/print-queue?printer_role=${encodeURIComponent(role)}`, {
    method: 'PUT', headers: headers(role), body: JSON.stringify({ id, print_status: status, print_error: printError }),
  });
}

async function flushPendingAcks(state) {
  for (const [key, value] of Object.entries(state.pendingAcks || {})) {
    try {
      await acknowledge(value.role, value.id, 'PRINTED');
      delete state.pendingAcks[key];
      saveState(state);
    } catch (error) {
      console.error(`Printed ${key}, but acknowledgement is still pending:`, error.message);
    }
  }
}

async function printOrder(state, role, order) {
  const key = `${role}:${order.id}`;
  if (state.pendingAcks[key]) return;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await sendToPrinter(role, order);
      state.pendingAcks[key] = { role, id: order.id, printedAt: new Date().toISOString() };
      saveState(state);
      await flushPendingAcks(state);
      console.log(`${new Date().toISOString()} printed ${key}`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  await acknowledge(role, order.id, 'FAILED', String(lastError?.message || lastError || 'Printer failed').slice(0, 300)).catch(() => {});
  console.error(`${new Date().toISOString()} failed ${key}:`, lastError?.message || lastError);
}

let cycleNumber = 0;
async function cycle() {
  cycleNumber += 1;
  const state = loadState();
  await flushPendingAcks(state);
  const maintenancePulse = cycleNumber === 1 || cycleNumber % Math.max(1, Math.round(60 / pollSeconds)) === 0;
  const payload = await request(`${appUrl}/api/guest-shop/print-queue?printer_role=ALL`, { headers: headers('ALL', maintenancePulse) });
  for (const role of ['BREAKFAST', 'FNB', 'FO']) {
    if (printers[role]?.enabled === false) continue;
    for (const order of payload.queues?.[role] || []) await printOrder(state, role, order);
  }
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try { await cycle(); } catch (error) { console.error(`${new Date().toISOString()} bridge cycle failed:`, error.message); }
  finally { running = false; }
}

console.log(`Hallmark purchase printer bridge ${VERSION} started on ${os.hostname()} (${pollSeconds}s recovery interval).`);
void tick();
setInterval(() => void tick(), pollSeconds * 1000);

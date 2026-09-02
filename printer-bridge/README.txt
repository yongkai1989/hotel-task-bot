Hallmark Crown Hotel - Epson TM-T82X F&B Printer Bridge

What this does
--------------
This bridge runs on a Windows PC that is on the same local network as the Epson TM-T82X.
It checks your Vercel app for paid F&B orders waiting to print, sends them to the printer,
then marks the order as printed.

The PC does not need to log in to the F&B admin page.

One-time setup
--------------
1. In Vercel, add an Environment Variable:
   PRINTER_BRIDGE_KEY = any long private password you choose

   Example:
   PRINTER_BRIDGE_KEY = GENERATE_A_LONG_RANDOM_SECRET

2. Redeploy Vercel after adding PRINTER_BRIDGE_KEY.

3. Copy config.example.json and rename the copy to config.json.

4. Edit config.json:
   - appUrl: your Vercel app root URL only, for example:
     https://project-0fmf8.vercel.app
     Do not include /restaurant-kiosk, /dashboard, or any page path.
   - bridgeKey: exactly the same value as PRINTER_BRIDGE_KEY in Vercel
   - printerHost: the Epson printer IP address
   - printerPort: usually 9100 for Epson LAN raw printing

5. Install Node.js LTS on the Windows PC if it is not installed.

6. Test printer connection:
   Double-click test-print.bat

7. Start live bridge:
   Double-click run-printer-bridge.bat

Recommended printer setup
-------------------------
Use LAN cable instead of Bluetooth.
Print the Epson network/self-test page to find the IP address.
Reserve that IP address in your router so it does not change.

Staff meal report printing
--------------------------
For printerRole = STAFF_MEAL, there is no permanent bridge and no background polling.
The one-time command queues the current weekly report, prints the same A4 landscape
layout as the Staff Meal backend Print Report button, marks it printed, and exits.

Important:
- Set the Ricoh MP 3054 as the Windows default printer on the PC running this bridge.
- Chrome or Edge must be installed on that PC.
- Run queue-staff-meal-report.bat every Monday morning. It queues, prints, marks the
  report printed, and exits. run-staff-meal-printer-bridge.bat performs the same
  one-time action and also exits.
- Do not leave run-printer-bridge.bat running with printerRole = STAFF_MEAL. The script
  intentionally stops and explains that Staff Meal uses one-time printing.
- Do not double-click epson-fnb-printer-bridge.js directly; Windows may try to run it
  with Windows Script Host and show a line 2 syntax error.
- Running the normal Monday command again will not print a duplicate report that is
  already marked PRINTED. Use the explicit --staff-meal-report-reprint command only
  when a reprint is genuinely required.
- The printerHost value is still kept in config.json, but browser report printing uses
  the Windows default printer so it can preserve the report layout.
- To force the old plain-text raw print mode, add this to config.json:
  "staffMealPrintMode": "raw"

How to keep it running
----------------------
Daily Telegram operations report:
This does not use Vercel Cron and does not poll. The existing printer-bridge PC makes
one secure request each morning at 9:00 AM using the existing PRINTER_BRIDGE_KEY.
The same 9:00 AM run now also checks overdue Preventive Maintenance. When anything
is overdue, Izzuddin and Yazid receive Web Push and the MT Tasks Telegram chat gets
the overdue task list.
The same run also always sends the MT Tasks Telegram chat a Maintenance Daily Review.
It lists open MT tasks, incomplete MT Manager Room Checks, overdue Preventive
Maintenance, and all other open Preventive Maintenance. It ends with a reminder for
the night shift to continue other open work whenever no defects are waiting.

HK morning review:
A separate 8:30 AM Windows task sends the HK Telegram chat a review of yesterday.
It includes PA, scheduled HK Supervisor, and Prem checklist completion; HK Special
Project progress and yesterday's movement; every linen type's In Bill versus Return
quantity and signed variance; the current monthly top five flagged Block/Levels;
all open HK tasks and Manager Room Checks; and room, In Bill, and Return save status.
Long reports are split safely so no open HK task is omitted. It does not poll and
does not use Vercel Cron.

Chambermaid save reminder:
The installer also creates a separate 5:00 PM Windows task. It checks today's
CHECKOUT and STAYOVER rooms once. If any required Chambermaid entries remain
unsaved, Izni, Sofea, Sulaiman, and Prem receive one Web Push reminder. If all
rooms are saved, nothing is sent. It does not poll and does not use Vercel Cron.

Linen difference follow-up:
A separate 6:00 PM Windows task sends the HK Telegram chat one daily report. It lists
every Block and Level with a linen difference of plus or minus 2 or more, including
the linen type, Chambermaid use, In Bill quantity, and signed difference. A clear
report is also sent when no level is flagged. Long reports are split into multiple
Telegram messages so no flagged level is omitted. It does not use Vercel Cron.

One-time setup on the always-on printer-bridge PC:
1. Confirm config.json contains the same appUrl and bridgeKey used by the live bridge.
2. Right-click install-daily-operations-report-task.ps1 and choose "Run with PowerShell".
3. The installer creates a Windows Task Scheduler task named
   "Hallmark Daily Operations Telegram Report" for 9:00 AM every day.
4. It creates "Hallmark HK Morning Review" for 8:30 AM every day.
5. It also creates "Hallmark Chambermaid Save Reminder" for 5:00 PM every day.
6. It creates "Hallmark Linen Difference Follow-up" for 6:00 PM every day.
7. If the PC is off at a scheduled time, Windows runs it as soon as possible
   after startup. The server keeps a daily audit so the same reminder is not sent twice.

To test the report once without changing the schedule, double-click
send-daily-operations-report.bat. A report already sent for yesterday will not be
sent twice.

Staff Meal:
Do not keep it running. In Windows Task Scheduler, create a weekly Monday task that
runs queue-staff-meal-report.bat. Use "Run only when user is logged on" because the
A4 report opens Chrome or Edge for kiosk printing. Enable "Run task as soon as
possible after a scheduled start is missed" if the PC may be switched off on Monday.

Live F&B / Guest Shop order printers only:
Simple method:
Leave run-printer-bridge.bat open on the PC.

Better method:
Place a shortcut to run-printer-bridge.bat in Windows Startup so it starts after reboot.

Troubleshooting
---------------
If test print fails:
- Confirm the Epson is powered on.
- Confirm the PC is on the same network.
- Confirm printerHost in config.json is the Epson IP.
- Try printerPort 9100 first.
- Make sure Windows firewall is not blocking outbound TCP.

If orders do not print:
- Confirm Vercel PRINTER_BRIDGE_KEY matches config.json bridgeKey.
- Confirm F&B paid orders have print_status = QUEUED.
- Confirm Vercel was redeployed after adding the environment variable.

Important
---------
Do not share config.json publicly because it contains your private bridge key.

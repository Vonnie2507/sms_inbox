# SMS Inbox

A Frappe app that provides a phone-style SMS inbox for ERPNext.

## Features

- 📱 Phone-style conversation UI
- 💬 Send & Reply to SMS
- 🔍 Search conversations
- ☑️ Select and attach messages to records
- 🔔 Navbar unread badge
- 🔄 Real-time updates

## Installation

### On Frappe Cloud:
1. Go to your site dashboard
2. Click **Apps** → **Add App**
3. Enter this repository URL
4. Install on your site

### Self-hosted:
```bash
bench get-app https://github.com/YOUR_USERNAME/sms_inbox.git
bench --site your-site install-app sms_inbox
```

## Configuration

1. Go to **SMS Settings** in ERPNext
2. Enter your Twilio credentials
3. Enable SMS

## Usage

Access SMS Inbox from:
- Navbar 💬 icon
- `/app/sms-conversations`

## License

MIT

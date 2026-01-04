app_name = "sms_inbox"
app_title = "SMS Inbox"
app_publisher = "Probuild"
app_description = "Phone-style SMS inbox for ERPNext with Twilio integration"
app_email = "admin@probuild.com"
app_license = "MIT"

# Include JS in desk
app_include_js = "/assets/sms_inbox/js/sms_notifications.js"

# Boot session
boot_session = "sms_inbox.boot.boot_session"

# Guest methods (Twilio webhook)
guest_methods = [
    "sms_inbox.api.twilio.receive_sms"
]

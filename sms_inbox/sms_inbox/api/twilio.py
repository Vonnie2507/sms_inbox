"""
Twilio SMS Integration API
Handles sending/receiving SMS and conversation management
"""

import frappe
from frappe.utils import now_datetime


def normalize_phone_number(phone_number, default_country_code="+61"):
    """Normalizes a phone number to E.164 format."""
    if not phone_number:
        return ""
    
    clean = phone_number.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    
    if clean.startswith("0"):
        clean = default_country_code + clean[1:]
    
    if not clean.startswith("+"):
        clean = default_country_code + clean
    
    return clean


def get_default_country_code(fallback="+61"):
    """Fetch default country code from SMS Settings."""
    try:
        settings = frappe.get_single("SMS Settings")
        return (settings.default_country_code or fallback).strip() or fallback
    except Exception:
        return fallback


@frappe.whitelist()
def get_sms_settings():
    """Get SMS settings if configured"""
    try:
        settings = frappe.get_single("SMS Settings")
        if settings and settings.enabled:
            return {
                "enabled": True,
                "phone_number": settings.phone_number
            }
    except Exception:
        pass
    return {"enabled": False}


@frappe.whitelist()
def send_sms(recipient_number, message, linked_doctype=None, linked_name=None, contact_name=None):
    """Sends an SMS message using Twilio and logs it."""
    try:
        settings = frappe.get_single("SMS Settings")
        if not settings or not settings.enabled:
            frappe.throw("SMS is not enabled. Please configure SMS Settings.")

        if not settings.account_sid or not settings.auth_token or not settings.phone_number:
            frappe.throw("Twilio credentials are not fully configured.")

        default_country_code = (settings.default_country_code or "+61").strip() or "+61"
        recipient_number = normalize_phone_number(recipient_number, default_country_code)

        from twilio.rest import Client
        client = Client(settings.account_sid, settings.get_password("auth_token"))

        # Create SMS Log entry first
        log = frappe.get_doc({
            "doctype": "SMS Log",
            "direction": "Outbound",
            "phone_number": recipient_number,
            "message": message,
            "linked_doctype": linked_doctype,
            "linked_name": linked_name,
            "status": "Sending",
            "contact_name": contact_name,
            "sent_by": frappe.session.user,
            "sent_at": now_datetime(),
            "read": 1
        })
        log.insert(ignore_permissions=True)
        frappe.db.commit()

        message_response = client.messages.create(
            to=recipient_number,
            from_=settings.phone_number,
            body=message
        )

        log.status = "Sent"
        log.twilio_sid = message_response.sid
        log.save(ignore_permissions=True)
        frappe.db.commit()

        return {
            "success": True,
            "message": "SMS sent successfully!",
            "sid": message_response.sid,
            "log_name": log.name,
            "recipient_number": recipient_number
        }

    except Exception as e:
        error_msg = str(e)
        frappe.log_error(f"Twilio SMS Error: {error_msg}", "Twilio SMS Failed")
        return {
            "success": False,
            "error": error_msg
        }


@frappe.whitelist(allow_guest=True)
def receive_sms():
    """Webhook endpoint to receive incoming SMS from Twilio"""
    try:
        from_number = frappe.form_dict.get("From", "")
        message_body = frappe.form_dict.get("Body", "")
        message_sid = frappe.form_dict.get("MessageSid", "")
        
        if not from_number or not message_body:
            return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
        
        from_number = normalize_phone_number(from_number, get_default_country_code())
        linked_doctype, linked_name, contact_name = find_linked_record(from_number)
        
        log = frappe.get_doc({
            "doctype": "SMS Log",
            "direction": "Inbound",
            "phone_number": from_number,
            "message": message_body,
            "linked_doctype": linked_doctype,
            "linked_name": linked_name,
            "status": "Received",
            "twilio_sid": message_sid,
            "contact_name": contact_name,
            "sent_at": now_datetime(),
            "read": 0
        })
        log.insert(ignore_permissions=True)
        frappe.db.commit()
        
        publish_new_sms_notification(from_number, message_body, contact_name)
        
        frappe.response["type"] = "text/xml"
        return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
        
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Twilio Webhook Error")
        return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'


def find_linked_record(phone_number):
    """Find a Contact or previous conversation linked to a phone number"""
    normalized = normalize_phone_number(phone_number, get_default_country_code())
    phone_variants = [phone_number, normalized]
    clean_number = phone_number.replace("+", "").replace(" ", "").replace("-", "")
    phone_variants.append(clean_number)
    
    recent_log = frappe.db.get_value(
        "SMS Log",
        filters={
            "phone_number": ["in", phone_variants],
            "linked_doctype": ["is", "set"],
            "direction": "Outbound"
        },
        fieldname=["linked_doctype", "linked_name", "contact_name"],
        order_by="sent_at desc"
    )
    
    if recent_log:
        return recent_log
    
    contact = frappe.db.get_value(
        "Contact",
        filters={"mobile_no": ["in", phone_variants]},
        fieldname=["name", "first_name", "last_name"]
    )
    
    if contact:
        full_name = f"{contact[1]} {contact[2]}".strip()
        return "Contact", contact[0], full_name
    
    return None, None, None


def publish_new_sms_notification(from_number, message_body, contact_name):
    """Publish realtime event for new SMS"""
    preview = message_body[:50] + "..." if len(message_body) > 50 else message_body
    sender = contact_name or from_number
    new_count = get_unread_sms_count()
    
    users_to_notify = frappe.get_all(
        "Has Role",
        filters={"role": ["in", ["System Manager", "Sales User"]], "parenttype": "User"},
        fields=["parent"],
        distinct=True
    )
    
    for user_row in users_to_notify:
        user = user_row.parent
        if user not in ["Guest"]:
            frappe.publish_realtime(
                event='new_sms',
                message={
                    "sender": sender,
                    "preview": preview,
                    "phone": from_number,
                    "new_count": new_count
                },
                user=user
            )


@frappe.whitelist()
def get_conversations():
    """Get all SMS conversations grouped by phone number"""
    conversations = frappe.db.sql("""
        SELECT 
            phone_number,
            contact_name,
            message as last_message,
            direction,
            sent_at as last_message_time,
            linked_doctype,
            linked_name,
            (SELECT COUNT(*) FROM `tabSMS Log` s2 
             WHERE s2.phone_number = s1.phone_number 
             AND s2.direction = 'Inbound' 
             AND s2.read = 0) as unread_count
        FROM `tabSMS Log` s1
        WHERE sent_at = (
            SELECT MAX(sent_at) 
            FROM `tabSMS Log` s2 
            WHERE s2.phone_number = s1.phone_number
        )
        ORDER BY sent_at DESC
    """, as_dict=True)
    
    return conversations


@frappe.whitelist()
def get_conversation_messages(phone_number):
    """Get all messages for a specific conversation"""
    messages = frappe.get_all(
        "SMS Log",
        filters={"phone_number": phone_number},
        fields=["name", "direction", "message", "sent_at", "status", "contact_name", 
                "linked_doctype", "linked_name", "twilio_sid", "sent_by"],
        order_by="sent_at asc"
    )
    
    for msg in messages:
        if msg.direction == "Outbound" and msg.sent_by:
            msg.sender_full_name = frappe.db.get_value("User", msg.sent_by, "full_name")
        else:
            msg.sender_full_name = None
    
    return messages


@frappe.whitelist()
def mark_conversation_read(phone_number):
    """Mark all unread inbound messages as read"""
    frappe.db.sql("""
        UPDATE `tabSMS Log` 
        SET `read` = 1 
        WHERE phone_number = %s AND direction = 'Inbound' AND `read` = 0
    """, (phone_number,))
    frappe.db.commit()
    
    new_count = get_unread_sms_count()
    
    users = frappe.get_all("Has Role", filters={"role": ["in", ["System Manager", "Sales User"]], "parenttype": "User"}, fields=["parent"], distinct=True)
    for u in users:
        frappe.publish_realtime(event='sms_unread_count_update', message={"new_count": new_count}, user=u.parent)
    
    return {"success": True, "new_unread_count": new_count}


@frappe.whitelist()
def mark_conversation_unread(phone_number):
    """Mark conversation as unread"""
    frappe.db.sql("""
        UPDATE `tabSMS Log` 
        SET `read` = 0 
        WHERE phone_number = %s AND direction = 'Inbound'
        ORDER BY sent_at DESC LIMIT 1
    """, (phone_number,))
    frappe.db.commit()
    
    new_count = get_unread_sms_count()
    
    users = frappe.get_all("Has Role", filters={"role": ["in", ["System Manager", "Sales User"]], "parenttype": "User"}, fields=["parent"], distinct=True)
    for u in users:
        frappe.publish_realtime(event='sms_unread_count_update', message={"new_count": new_count}, user=u.parent)
    
    return {"success": True, "new_unread_count": new_count}


@frappe.whitelist()
def get_unread_sms_count():
    """Get count of unread inbound SMS messages"""
    try:
        count = frappe.db.count("SMS Log", filters={
            "direction": "Inbound",
            "read": 0
        })
        return count or 0
    except Exception:
        return 0


@frappe.whitelist()
def attach_conversation_to_record(phone_number, target_doctype, target_name):
    """Attach SMS conversation to a record"""
    allowed_doctypes = {"Opportunity", "Lead", "Project", "Customer", "Contact"}
    if target_doctype not in allowed_doctypes:
        frappe.throw(f"Invalid target doctype: {target_doctype}")

    sms_logs = frappe.get_all("SMS Log", filters={"phone_number": phone_number}, pluck="name")
    
    if not sms_logs:
        return {"success": False, "message": "No SMS messages found"}
    
    for log_name in sms_logs:
        frappe.db.set_value("SMS Log", log_name, {
            "linked_doctype": target_doctype,
            "linked_name": target_name
        })
    
    frappe.db.commit()
    return {"success": True, "message": f"Attached {len(sms_logs)} messages to {target_doctype}: {target_name}"}


@frappe.whitelist()
def attach_sms_messages_to_record(message_names, target_doctype, target_name):
    """Attach selected SMS Log messages to a record"""
    allowed_doctypes = {"Opportunity", "Lead", "Project", "Customer", "Contact"}
    if target_doctype not in allowed_doctypes:
        frappe.throw(f"Invalid target doctype: {target_doctype}")

    if isinstance(message_names, str):
        try:
            message_names = frappe.parse_json(message_names)
        except Exception:
            message_names = [message_names]

    if not isinstance(message_names, (list, tuple)) or not message_names:
        frappe.throw("No messages selected")

    updated = 0
    for log_name in message_names:
        frappe.db.set_value("SMS Log", log_name, {"linked_doctype": target_doctype, "linked_name": target_name})
        updated += 1

    frappe.db.commit()
    return {"success": True, "message": f"Attached {updated} message(s) to {target_doctype}: {target_name}"}


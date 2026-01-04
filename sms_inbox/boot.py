import frappe


def boot_session(bootinfo):
    """Add SMS unread count to boot session"""
    if frappe.session.user != "Guest":
        try:
            bootinfo.unread_sms_count = frappe.db.count("SMS Log", filters={
                "direction": "Inbound",
                "read": 0
            }) or 0
        except Exception:
            bootinfo.unread_sms_count = 0

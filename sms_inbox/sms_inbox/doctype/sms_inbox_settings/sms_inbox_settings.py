import frappe
from frappe.model.document import Document

class SMSInboxSettings(Document):
    def validate(self):
        if self.enabled and (not self.account_sid or not self.auth_token or not self.phone_number):
            frappe.throw("Please fill in all Twilio credentials to enable SMS")


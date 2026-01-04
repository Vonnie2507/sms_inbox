frappe.pages['sms-conversations'].on_page_load = function(wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'SMS Conversations',
        single_column: true
    });

    page.add_action_icon("refresh", function() {
        page.sms_conversations.refresh();
    });

    $(wrapper).on('show', function() {
        if (!page.sms_conversations) {
            page.sms_conversations = new SMSConversations(page, wrapper);
        } else {
            page.sms_conversations.refresh();
        }
    });

    page.sms_conversations = new SMSConversations(page, wrapper);
};

class SMSConversations {
    constructor(page, wrapper) {
        this.page = page;
        this.wrapper = wrapper;
        this.$container = $(wrapper).find('.layout-main-section');
        this.current_conversation = null;
        this.conversations = [];
        this.search_text = '';
        this.selection_mode = false;
        this.selected_message_names = new Set();
        this.last_messages = [];
        this.setup_layout();
        this.setup_realtime();
        this.load_conversations();
    }

    setup_layout() {
        this.$container.html(`
            <style>
                .sms-container { display: flex; height: calc(100vh - 150px); }
                .conversations-list { width: 350px; border-right: 1px solid #d1d8dd; overflow-y: auto; background: #fff; }
                .conversations-header { padding: 12px; border-bottom: 1px solid #eee; position: sticky; top: 0; background: #fff; z-index: 1; }
                .conversations-search { width: 100%; border: 1px solid #d1d8dd; border-radius: 16px; padding: 6px 10px; outline: none; }
                .conversation-item { padding: 12px 15px; border-bottom: 1px solid #eee; cursor: pointer; }
                .conversation-item:hover { background: #f5f7fa; }
                .conversation-item.active { background: #e8f0fe; }
                .unread-badge { background: #e74c3c; color: white; border-radius: 10px; padding: 2px 8px; font-size: 11px; }
                .chat-container { flex: 1; display: flex; flex-direction: column; background: #fff; }
                .chat-header { padding: 15px; border-bottom: 1px solid #d1d8dd; background: #f5f7fa; display: flex; justify-content: space-between; align-items: center; }
                .chat-messages { flex: 1; overflow-y: auto; padding: 20px; background: #fafbfc; }
                .message-row { display: flex; align-items: flex-end; gap: 8px; margin: 8px 0; }
                .message-row.outbound { justify-content: flex-end; }
                .message-row.inbound { justify-content: flex-start; }
                .message-row.selected .message-bubble { outline: 2px solid rgba(0, 132, 255, 0.35); }
                .msg-select input { width: 16px; height: 16px; cursor: pointer; }
                .message-bubble { max-width: 70%; padding: 10px 14px; border-radius: 18px; }
                .message-bubble.outbound { background: #0084ff; color: white; border-bottom-right-radius: 4px; }
                .message-bubble.inbound { background: #e4e6eb; color: #000; border-bottom-left-radius: 4px; }
                .message-time { font-size: 11px; opacity: 0.7; margin-top: 4px; }
                .message-sender { font-size: 11px; opacity: 0.8; margin-bottom: 4px; font-weight: 500; }
                .message-linked { font-size: 11px; opacity: 0.7; margin-top: 4px; }
                .chat-input { padding: 15px; border-top: 1px solid #d1d8dd; display: flex; gap: 10px; }
                .chat-input textarea { flex: 1; border-radius: 20px; padding: 10px 15px; border: 1px solid #d1d8dd; resize: none; }
                .chat-input button { border-radius: 20px; padding: 10px 20px; }
                .date-separator { text-align: center; margin: 20px 0; color: #8d99a6; font-size: 12px; }
                .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #8d99a6; }
            </style>
            <div class="sms-container">
                <div class="conversations-list">
                    <div class="conversations-header">
                        <div class="d-flex" style="gap: 8px;">
                            <input class="conversations-search" type="text" placeholder="Search..." />
                            <button class="btn btn-sm btn-primary new-message-btn">New</button>
                        </div>
                    </div>
                    <div class="conversations-items"></div>
                </div>
                <div class="chat-container">
                    <div class="empty-state">Select a conversation</div>
                </div>
            </div>
        `);

        this.$container.find('.conversations-search').on('input', (e) => {
            this.search_text = (e.currentTarget.value || '').toLowerCase();
            this.render_conversations(this.conversations);
        });

        this.$container.find('.new-message-btn').on('click', () => this.show_new_message_dialog());
    }

    setup_realtime() {
        frappe.realtime.on('new_sms', (data) => {
            if (!data) return;
            this.load_conversations();
            if (this.current_conversation?.phone_number === data.phone) {
                this.load_conversation(this.current_conversation);
            }
        });
    }

    load_conversations() {
        frappe.call({
            method: 'sms_inbox.api.twilio.get_conversations',
            callback: (r) => {
                if (r.message) {
                    this.conversations = r.message || [];
                    this.render_conversations(r.message);
                }
            }
        });
    }

    render_conversations(conversations) {
        const $items = this.$container.find('.conversations-items');
        $items.empty();

        const filtered = (conversations || []).filter((c) => {
            if (!this.search_text) return true;
            return [c.contact_name, c.phone_number, c.last_message].filter(Boolean).join(' ').toLowerCase().includes(this.search_text);
        });

        if (filtered.length === 0) {
            $items.html('<div class="p-3 text-muted">No conversations</div>');
            return;
        }

        filtered.forEach(conv => {
            const name = conv.contact_name || conv.phone_number;
            const time = frappe.datetime.prettyDate(conv.last_message_time);
            const preview = (conv.last_message || '').substring(0, 40) + ((conv.last_message || '').length > 40 ? '...' : '');
            const unread = conv.unread_count > 0 ? `<span class="unread-badge">${conv.unread_count}</span>` : '';
            const direction = conv.direction === 'Inbound' ? '←' : '→';
            const active = this.current_conversation?.phone_number === conv.phone_number ? 'active' : '';

            $items.append(`
                <div class="conversation-item ${active}" data-phone="${conv.phone_number}">
                    <div class="d-flex justify-content-between align-items-center">
                        <strong>${frappe.utils.escape_html(name)}</strong>
                        ${unread}
                    </div>
                    <div class="text-muted small mt-1">${direction} ${frappe.utils.escape_html(preview)}</div>
                    <div class="text-muted small">${time}</div>
                </div>
            `);
        });

        $items.find('.conversation-item').click((e) => {
            const phone = $(e.currentTarget).data('phone');
            const conv = conversations.find(c => c.phone_number === phone);
            this.load_conversation(conv);
            $items.find('.conversation-item').removeClass('active');
            $(e.currentTarget).addClass('active');
        });
    }

    load_conversation(conv) {
        this.current_conversation = conv;
        this.selection_mode = false;
        this.selected_message_names = new Set();

        frappe.call({
            method: 'sms_inbox.api.twilio.get_conversation_messages',
            args: { phone_number: conv.phone_number },
            callback: (r) => {
                if (r.message) {
                    this.last_messages = r.message;
                    this.render_chat(conv, r.message);
                    if (conv.unread_count > 0) {
                        frappe.call({ method: 'sms_inbox.api.twilio.mark_conversation_read', args: { phone_number: conv.phone_number } });
                    }
                }
            }
        });
    }

    render_chat(conv, messages) {
        const name = conv.contact_name || conv.phone_number;
        const $chat = this.$container.find('.chat-container');

        $chat.html(`
            <div class="chat-header">
                <div>
                    <strong>${frappe.utils.escape_html(name)}</strong>
                    <div class="text-muted small">${conv.phone_number}</div>
                </div>
                <div>
                    <button class="btn btn-sm btn-default select-btn">Select</button>
                    <button class="btn btn-sm btn-primary attach-selected-btn" style="display:none">Attach (0)</button>
                    <button class="btn btn-sm btn-default cancel-btn" style="display:none">Cancel</button>
                    <button class="btn btn-sm btn-default attach-btn">📎 Attach All</button>
                </div>
            </div>
            <div class="chat-messages"></div>
            <div class="chat-input">
                <textarea placeholder="Type a message..." rows="2"></textarea>
                <button class="btn btn-primary send-btn">Send</button>
            </div>
        `);

        this.render_messages(messages);

        $chat.find('.send-btn').click(() => this.send_message(conv.phone_number));
        $chat.find('textarea').keydown((e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send_message(conv.phone_number); }
        });
        $chat.find('.select-btn').click(() => this.toggle_selection_mode());
        $chat.find('.cancel-btn').click(() => this.toggle_selection_mode(false));
        $chat.find('.attach-selected-btn').click(() => this.show_attach_selected_dialog());
        $chat.find('.attach-btn').click(() => this.show_attach_dialog(conv.phone_number));
    }

    render_messages(messages) {
        const $msg = this.$container.find('.chat-messages');
        $msg.empty();
        let lastDate = null;

        messages.forEach(m => {
            const msgDate = frappe.datetime.str_to_obj(m.sent_at).toDateString();
            if (msgDate !== lastDate) {
                $msg.append(`<div class="date-separator">${frappe.datetime.prettyDate(m.sent_at)}</div>`);
                lastDate = msgDate;
            }

            const time = frappe.datetime.str_to_obj(m.sent_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            const sender = m.direction === 'Outbound' && m.sender_full_name ? `<div class="message-sender">${m.sender_full_name}</div>` : '';
            const linked = m.linked_doctype ? `<div class="message-linked">📎 ${m.linked_doctype}: ${m.linked_name}</div>` : '';
            const selected = this.selected_message_names.has(m.name);
            const checkbox = this.selection_mode ? `<div class="msg-select"><input type="checkbox" data-name="${m.name}" ${selected ? 'checked' : ''} /></div>` : '';

            $msg.append(`
                <div class="message-row ${m.direction.toLowerCase()} ${selected ? 'selected' : ''}" data-name="${m.name}">
                    ${m.direction === 'Inbound' ? checkbox : ''}
                    <div class="message-bubble ${m.direction.toLowerCase()}">
                        ${sender}
                        <div>${frappe.utils.escape_html(m.message)}</div>
                        ${linked}
                        <div class="message-time">${time}</div>
                    </div>
                    ${m.direction === 'Outbound' ? checkbox : ''}
                </div>
            `);
        });

        $msg.scrollTop($msg.prop("scrollHeight"));

        $msg.find('.msg-select input').change((e) => {
            const name = $(e.target).data('name');
            if (e.target.checked) this.selected_message_names.add(name);
            else this.selected_message_names.delete(name);
            this.update_selection_ui();
        });
    }

    toggle_selection_mode(enabled) {
        this.selection_mode = enabled !== undefined ? enabled : !this.selection_mode;
        if (!this.selection_mode) this.selected_message_names = new Set();
        this.render_messages(this.last_messages);
        this.update_selection_ui();
    }

    update_selection_ui() {
        const count = this.selected_message_names.size;
        const $chat = this.$container.find('.chat-container');
        if (this.selection_mode) {
            $chat.find('.select-btn').text('Selecting');
            $chat.find('.attach-selected-btn').show().text(`Attach (${count})`).prop('disabled', count === 0);
            $chat.find('.cancel-btn').show();
        } else {
            $chat.find('.select-btn').text('Select');
            $chat.find('.attach-selected-btn').hide();
            $chat.find('.cancel-btn').hide();
        }
    }

    send_message(phone_number) {
        const $textarea = this.$container.find('.chat-input textarea');
        const message = $textarea.val().trim();
        if (!message) return;

        const $btn = this.$container.find('.send-btn').prop('disabled', true).text('Sending...');

        frappe.call({
            method: 'sms_inbox.api.twilio.send_sms',
            args: { recipient_number: phone_number, message, linked_doctype: this.current_conversation?.linked_doctype, linked_name: this.current_conversation?.linked_name, contact_name: this.current_conversation?.contact_name },
            callback: (r) => {
                $btn.prop('disabled', false).text('Send');
                if (r.message?.success) {
                    $textarea.val('');
                    this.load_conversation(this.current_conversation);
                    frappe.show_alert({ message: 'SMS sent!', indicator: 'green' });
                } else {
                    frappe.msgprint({ title: 'Error', message: r.message?.error || 'Failed', indicator: 'red' });
                }
            }
        });
    }

    show_new_message_dialog() {
        let d = new frappe.ui.Dialog({
            title: 'New Message',
            fields: [
                { fieldname: 'contact', fieldtype: 'Link', options: 'Contact', label: 'Contact' },
                { fieldname: 'phone_number', fieldtype: 'Data', label: 'Phone Number', reqd: 1 },
                { fieldname: 'message', fieldtype: 'Small Text', label: 'Message', reqd: 1 }
            ],
            primary_action_label: 'Send',
            primary_action: (values) => {
                frappe.call({
                    method: 'sms_inbox.api.twilio.send_sms',
                    args: { recipient_number: values.phone_number, message: values.message },
                    callback: (r) => {
                        if (r.message?.success) { d.hide(); this.load_conversations(); frappe.show_alert({ message: 'SMS sent!', indicator: 'green' }); }
                        else { frappe.msgprint({ title: 'Error', message: r.message?.error, indicator: 'red' }); }
                    }
                });
            }
        });
        d.fields_dict.contact.$input.on('change', async () => {
            const contact = d.get_value('contact');
            if (contact) {
                const resp = await frappe.db.get_value('Contact', contact, ['mobile_no', 'phone']);
                d.set_value('phone_number', resp?.message?.mobile_no || resp?.message?.phone || '');
            }
        });
        d.show();
    }

    show_attach_dialog(phone_number) {
        let d = new frappe.ui.Dialog({
            title: 'Attach Conversation',
            fields: [
                { fieldname: 'doctype', fieldtype: 'Select', label: 'Attach To', options: 'Opportunity\nLead\nProject\nCustomer\nContact', reqd: 1 },
                { fieldname: 'docname', fieldtype: 'Dynamic Link', label: 'Record', options: 'doctype', reqd: 1 }
            ],
            primary_action_label: 'Attach',
            primary_action: (values) => {
                frappe.call({
                    method: 'sms_inbox.api.twilio.attach_conversation_to_record',
                    args: { phone_number, target_doctype: values.doctype, target_name: values.docname },
                    callback: (r) => { if (r.message?.success) { d.hide(); frappe.show_alert({ message: r.message.message, indicator: 'green' }); this.load_conversation(this.current_conversation); } }
                });
            }
        });
        d.show();
    }

    show_attach_selected_dialog() {
        const names = Array.from(this.selected_message_names);
        if (!names.length) return;
        let d = new frappe.ui.Dialog({
            title: `Attach ${names.length} Message(s)`,
            fields: [
                { fieldname: 'doctype', fieldtype: 'Select', label: 'Attach To', options: 'Opportunity\nLead\nProject\nCustomer\nContact', reqd: 1 },
                { fieldname: 'docname', fieldtype: 'Dynamic Link', label: 'Record', options: 'doctype', reqd: 1 }
            ],
            primary_action_label: 'Attach',
            primary_action: (values) => {
                frappe.call({
                    method: 'sms_inbox.api.twilio.attach_sms_messages_to_record',
                    args: { message_names: names, target_doctype: values.doctype, target_name: values.docname },
                    callback: (r) => { if (r.message?.success) { d.hide(); frappe.show_alert({ message: r.message.message, indicator: 'green' }); this.toggle_selection_mode(false); this.load_conversation(this.current_conversation); } }
                });
            }
        });
        d.show();
    }

    refresh() {
        this.load_conversations();
        if (this.current_conversation) this.load_conversation(this.current_conversation);
    }
}

/**
 * SMS Inbox - Navbar Badge
 */
frappe.provide('sms_inbox');

$(document).ready(function() {
    setTimeout(function() {
        sms_inbox.add_badge();
        sms_inbox.setup_realtime();
    }, 1000);
});

sms_inbox.add_badge = function() {
    if ($('.sms-inbox-nav').length) return;
    
    const $navbar = $('.navbar-nav');
    if (!$navbar.length) return;
    
    const count = frappe.boot.unread_sms_count || 0;
    
    const $item = $(`
        <li class="nav-item sms-inbox-nav" title="SMS">
            <a class="nav-link" href="/app/sms-conversations" style="position: relative; padding: 0.5rem 0.75rem;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <span class="sms-badge" style="position:absolute;top:4px;right:2px;background:#e74c3c;color:white;font-size:10px;font-weight:bold;min-width:16px;height:16px;border-radius:8px;display:${count > 0 ? 'flex' : 'none'};align-items:center;justify-content:center;padding:0 4px;">${count}</span>
            </a>
        </li>
    `);
    
    const $bell = $navbar.find('.dropdown-notifications').parent();
    if ($bell.length) $item.insertBefore($bell);
    else $navbar.append($item);
};

sms_inbox.update_count = function(count) {
    const $badge = $('.sms-badge');
    $badge.text(count);
    count > 0 ? $badge.show() : $badge.hide();
    frappe.boot.unread_sms_count = count;
};

sms_inbox.setup_realtime = function() {
    frappe.realtime.on('new_sms', function(data) {
        sms_inbox.update_count(data.new_count);
        frappe.show_alert({ message: `<strong>New SMS from ${data.sender}</strong><br>${data.preview}`, indicator: 'blue' }, 10);
    });
    
    frappe.realtime.on('sms_unread_count_update', function(data) {
        sms_inbox.update_count(data.new_count);
    });
};

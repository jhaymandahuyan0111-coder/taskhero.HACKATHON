/* =========================================================
   TASKHERO - SHARED JAVASCRIPT
   Used by ALL pages.
   ========================================================= */

/* =========================================================
   NAVIGATION
   ========================================================= */

function currentUser() {
    if (!localStorage.getItem("taskhero-token")) {
        localStorage.removeItem("taskhero-user");
        return null;
    }
    try {
        return JSON.parse(localStorage.getItem("taskhero-user") || "null");
    } catch {
        localStorage.removeItem("taskhero-user");
        localStorage.removeItem("taskhero-token");
        return null;
    }
}

function notificationLabel(icon) {
    const value = String(icon || "").trim();
    return value && !/\p{Extended_Pictographic}/u.test(value) ? value : "Update";
}

function requireAuth(target) {
    if (currentUser()) {
        window.location.href = target;
        return true;
    }
    window.location.href = `auth.html?returnTo=${encodeURIComponent(target)}`;
    return false;
}

function goHome()    { window.location.href = "index.html"; }
function postTask()  { requireAuth("post-task.html"); }
function myTasks()   { requireAuth("my-task.html"); }
function messages()  { requireAuth("messeges-page.html"); }
function goBack()    { if (window.history.length > 1) window.history.back(); else goHome(); }
function signOut() {
    localStorage.removeItem("taskhero-user");
    localStorage.removeItem("taskhero-token");
    window.location.href = "auth.html";
}

/* =========================================================
   DARK / LIGHT MODE
   ========================================================= */

function toggleDarkMode() {
    document.body.classList.toggle("dark-mode");
    const enabled = document.body.classList.contains("dark-mode");
    localStorage.setItem("taskhero-dark-mode", enabled);
    updateThemeButton();
}

function updateThemeButton() {
    const btn   = document.getElementById("themeButton");
    const light = document.getElementById("themeIconLight");
    const dark  = document.getElementById("themeIconDark");
    const isDark = document.body.classList.contains("dark-mode");
    if (btn)   { btn.title = isDark ? "Switch to Light Mode" : "Switch to Dark Mode"; btn.setAttribute("aria-label", btn.title); }
    if (light) light.style.display = isDark ? "none"  : "";
    if (dark)  dark.style.display  = isDark ? "" : "none";
}

function loadTheme() {
    if (localStorage.getItem("taskhero-dark-mode") === "true") {
        document.body.classList.add("dark-mode");
    }
    updateThemeButton();
}

/* =========================================================
   ACTIVE NAV HIGHLIGHT
   Detects the current page and marks the correct nav button.
   ========================================================= */

function setActiveNav() {
    const page = window.location.pathname.split("/").pop() || "home.html";
    const map = {
        "home.html":         0,
        "post-task.html":    1,
        "my-task.html":      2,
        "messeges-page.html":3,
        "profile.html":      4
    };
    const idx = map[page];
    if (idx === undefined) return;

    const buttons = document.querySelectorAll(".nav-links .nav-button");
    buttons.forEach((btn, i) => {
        btn.classList.toggle("active", i === idx);
    });
}

/* =========================================================
   TOAST NOTIFICATION
   ========================================================= */

function showToast(message, type = "info", duration = 3000) {
    // Remove existing toast
    const existing = document.getElementById("taskhero-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "taskhero-toast";
    toast.className = "toast " + type;
    toast.innerText = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add("show"));
    });

    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 350);
    }, duration);
}

/* =========================================================
   NOTIFICATIONS PANEL
   ========================================================= */

let notificationBadgeVersion = 0;
let notificationBadgeTimer;
function setNotificationBadge(count) {
    notificationBadgeVersion++;
    const button = document.getElementById("notif-btn");
    if (!button) return;
    const dot = button.querySelector(".notification-dot");
    if (dot) dot.hidden = !(count > 0);
    button.setAttribute("aria-label", count > 0 ? `Notifications, ${count} unread` : "Notifications");
    button.title = count > 0 ? "New notifications" : "Notifications";
}

async function refreshNotificationBadge() {
    if (!document.getElementById("notif-btn")) return;
    const user = currentUser();
    if (!user) { setNotificationBadge(0); return; }
    if (document.hidden) return;
    const version = ++notificationBadgeVersion;
    try {
        const response = await fetch(`${window.TASKHERO_API_BASE}/notifications/${encodeURIComponent(user.id)}/unread-count`);
        const result = await response.json();
        if (response.ok && result.success && version === notificationBadgeVersion) setNotificationBadge(result.unreadCount);
    } catch (_) { /* Preserve the last known state during a network interruption. */ }
}

function startNotificationBadge() {
    clearInterval(notificationBadgeTimer);
    refreshNotificationBadge();
    notificationBadgeTimer = setInterval(refreshNotificationBadge, 15000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshNotificationBadge(); });
window.addEventListener("focus", refreshNotificationBadge);

async function notifications() {
    const existing = document.getElementById("notif-panel");
    if (existing) { existing.remove(); return; }

    const user = currentUser();
    if (!user) {
        window.location.href = "auth.html?returnTo=home.html";
        return;
    }

    const panel = document.createElement("section");
    panel.id = "notif-panel";
    panel.setAttribute("aria-label", "Notifications");
    panel.style.cssText = `
        position: fixed;
        top: 78px;
        right: 24px;
        width: min(360px, calc(100vw - 24px));
        max-height: min(520px, calc(100vh - 100px));
        background: var(--card);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.15);
        z-index: 2000;
        overflow: auto;
        animation: modalIn 0.2s ease;
    `;

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border)";
    const title = document.createElement("strong");
    title.textContent = "Notifications";
    const markAll = document.createElement("button");
    markAll.type = "button";
    markAll.className = "task-action-btn btn-view";
    markAll.textContent = "Mark all read";
    header.append(title, markAll);

    const list = document.createElement("div");
    list.setAttribute("aria-live", "polite");
    list.style.cssText = "overflow:auto";
    const status = document.createElement("p");
    status.textContent = "Loading notifications…";
    status.style.cssText = "padding:22px 16px;text-align:center;color:var(--text-sub);font-size:13px";
    list.append(status);
    panel.append(header, list);
    document.body.append(panel);

    async function loadNotifications() {
        list.replaceChildren();
        const loading = document.createElement("p");
        loading.textContent = "Loading notifications…";
        loading.style.cssText = "padding:22px 16px;text-align:center;color:var(--text-sub);font-size:13px";
        list.append(loading);
        try {
            const response = await fetch(`${window.TASKHERO_API_BASE}/notifications/${encodeURIComponent(user.id)}`);
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || "Unable to load notifications.");
            setNotificationBadge(result.unreadCount);
            list.replaceChildren();
            if (!result.data.length) {
                const empty = document.createElement("p");
                empty.textContent = "No notifications yet.";
                empty.style.cssText = "padding:24px 16px;text-align:center;color:var(--text-sub);font-size:13px";
                list.append(empty);
                return;
            }
            for (const notification of result.data) {
                const item = document.createElement("button");
                item.type = "button";
                item.className = "notification-item";
                item.style.cssText = `display:flex;width:100%;gap:12px;padding:13px 16px;text-align:left;border:0;border-bottom:1px solid var(--border);background:${notification.read ? "transparent" : "var(--surface)"};color:var(--text);cursor:pointer`;
                const label = document.createElement("span");
                label.textContent = notificationLabel(notification.icon);
                label.style.cssText = "flex:0 0 64px;font-size:11px;font-weight:700;color:var(--primary)";
                const content = document.createElement("span");
                content.style.cssText = "min-width:0;display:grid;gap:4px";
                const text = document.createElement("span");
                text.textContent = notification.text;
                text.style.cssText = "font-size:13px;line-height:1.45;overflow-wrap:anywhere";
                const time = document.createElement("time");
                time.dateTime = notification.createdAt;
                time.textContent = new Date(notification.createdAt).toLocaleString();
                time.style.cssText = "font-size:11px;color:var(--text-sub)";
                content.append(text, time);
                item.append(label, content);
                if (!notification.read) {
                    item.addEventListener("click", async () => {
                        const readResponse = await fetch(`${window.TASKHERO_API_BASE}/notifications/${encodeURIComponent(notification.id)}/read`, { method: "PATCH" });
                        if (readResponse.ok) loadNotifications();
                    });
                } else {
                    item.disabled = true;
                    item.style.cursor = "default";
                }
                list.append(item);
            }
        } catch (error) {
            list.replaceChildren();
            const message = document.createElement("p");
            message.textContent = error.message;
            message.style.cssText = "padding:22px 16px;text-align:center;color:var(--danger);font-size:13px";
            list.append(message);
        }
    }

    markAll.addEventListener("click", async () => {
        const response = await fetch(`${window.TASKHERO_API_BASE}/notifications/${encodeURIComponent(user.id)}/read-all`, { method: "PATCH" });
        if (response.ok) loadNotifications();
    });

    loadNotifications();

    setTimeout(() => {
        document.addEventListener("click", function closePanel(event) {
            if (!panel.contains(event.target) && event.target.id !== "notif-btn") {
                panel.remove();
                document.removeEventListener("click", closePanel);
            }
        });
    }, 100);
}

/* Replace the old placeholder panel with the signed-in user's real account data. */
function profile() {
    if (!currentUser()) {
        window.location.href = "auth.html?returnTo=profile.html";
        return;
    }
    window.location.href = "profile.html";
}

/* =========================================================
   LOAD SHARED NAVIGATION
   ========================================================= */

function loadNavigation() {
    const container = document.getElementById("shared-navigation");
    if (!container) return;

    const page = window.location.pathname.split("/").pop();
    const protectedPages = ["", "home.html", "post-task.html", "my-task.html", "messeges-page.html", "profile.html"];
    if (protectedPages.includes(page) && !currentUser()) {
        window.location.href = `auth.html?returnTo=${encodeURIComponent(page)}`;
        return;
    }

    fetch("components/navigation.html")
        .then(r => r.text())
        .then(html => {
            container.innerHTML = html;
            container.classList.add("is-ready");
            loadTheme();          // apply saved theme
            setActiveNav();       // highlight correct button
            initUserSearch();     // wire up user search
            updateNavAvatar();    // show user's profile initial/photo
            startNotificationBadge();
        })
        .catch(err => console.warn("Navigation load failed:", err));
}

/* =========================================================
   NAV PROFILE AVATAR + DROPDOWN
   ========================================================= */

function updateNavAvatar() {
    const el   = document.getElementById("navProfileAvatar");
    const user = currentUser();
    if (!el) return;

    // Build avatar content
    let avatarHtml;
    if (user && user.avatar && user.avatar.length > 2) {
        avatarHtml = `<img src="${user.avatar}" alt="${user.name || 'Profile'}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    } else if (user) {
        const letter = (user.name || user.avatar || "?").trim().charAt(0).toUpperCase();
        avatarHtml = letter;
    } else {
        avatarHtml = "?";
    }
    el.innerHTML = avatarHtml;

    // Also populate the dropdown user info panel
    const menuAvatar = document.getElementById("navMenuAvatar");
    const menuName   = document.getElementById("navMenuName");
    const menuEmail  = document.getElementById("navMenuEmail");
    if (menuAvatar && user) {
        menuAvatar.innerHTML = user.avatar && user.avatar.length > 2
            ? `<img src="${user.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
            : (user.name || "?").trim().charAt(0).toUpperCase();
    }
    if (menuName  && user) menuName.textContent  = user.name  || "Account";
    if (menuEmail && user) menuEmail.textContent = user.email || "";
}

function toggleProfileMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById("navProfileMenu");
    const btn  = document.getElementById("navProfileBtn");
    if (!menu) return;
    const isOpen = menu.classList.toggle("open");
    btn.setAttribute("aria-expanded", isOpen);
    if (isOpen) {
        // Close when clicking anywhere outside
        setTimeout(() => {
            document.addEventListener("click", _closeProfileMenuOutside);
        }, 0);
    }
}

function closeProfileMenu() {
    const menu = document.getElementById("navProfileMenu");
    const btn  = document.getElementById("navProfileBtn");
    if (menu) menu.classList.remove("open");
    if (btn)  btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", _closeProfileMenuOutside);
}

function _closeProfileMenuOutside(e) {
    const menu = document.getElementById("navProfileMenu");
    const btn  = document.getElementById("navProfileBtn");
    if (menu && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        closeProfileMenu();
    }
}

(function () {
    const API_BASE = window.TASKHERO_API_BASE;
    let _searchTimer = null;
    let _lastQuery   = "";
    let _activeIndex = -1;   // keyboard-selected result index

    /* Called from navigation.html oninput / onfocus */
    window.navUserSearchInput = function (value) {
        const q = value.trim();

        // Re-open dropdown if already has results for same query
        if (q === _lastQuery && q !== "") {
            _openDropdown();
            return;
        }

        // Clear empty
        if (!q) {
            _lastQuery = "";
            _closeDropdown();
            return;
        }

        // Debounce 250 ms
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => _runSearch(q), 250);
    };

    async function _runSearch(q) {
        const dropdown = document.getElementById("navSearchDropdown");
        if (!dropdown) return;

        _lastQuery   = q;
        _activeIndex = -1;

        // Show loading state
        dropdown.innerHTML = `<div class="nav-search-loading">Searching…</div>`;
        _openDropdown();

        try {
            const res  = await fetch(`${API_BASE}/users/search?q=${encodeURIComponent(q)}`);
            const json = await res.json();

            // Bail if the user has already typed something else
            const input = document.getElementById("navSearchInput");
            if (!input || input.value.trim() !== q) return;

            if (!json.success || json.count === 0) {
                dropdown.innerHTML = `<div class="nav-search-empty">No users found for "<strong>${_esc(q)}</strong>"</div>`;
                return;
            }

            _renderResults(json.data, q, dropdown);
        } catch {
            const dropdown2 = document.getElementById("navSearchDropdown");
            if (dropdown2) dropdown2.innerHTML = `<div class="nav-search-empty">Server offline — make sure the backend is running.</div>`;
        }
    }

    function _renderResults(users, q, dropdown) {
        const me = currentUser();

        dropdown.innerHTML = users.map((u, i) => {
            const avatarHtml = u.avatar && u.avatar.length > 2
                ? `<img src="${_esc(u.avatar)}" alt="${_esc(u.name)}">`
                : _esc((u.avatar || u.name.charAt(0)).toUpperCase());

            const isMe   = me && me.id === u.id;
            const subLine = [
                u.tagline  || null,
                u.location || null,
                u.tasksCompleted ? `${u.tasksCompleted} tasks` : null,
            ].filter(Boolean).join(" · ") || "TaskHero member";

            const target = isMe
                ? "profile.html"
                : `profile.html?userId=${encodeURIComponent(u.id)}`;

            return `<a
                class="nav-search-result"
                href="${target}"
                role="option"
                aria-selected="false"
                data-idx="${i}"
                onclick="_navSearchClose()"
            >
                <div class="nav-search-avatar">${avatarHtml}</div>
                <div class="nav-search-info">
                    <div class="nav-search-name">${_highlightMatch(_esc(u.name), q)}</div>
                    <div class="nav-search-sub">${_esc(subLine)}</div>
                </div>
            </a>`;
        }).join("");
    }

    /* Keyboard navigation on the search input */
    document.addEventListener("keydown", function (e) {
        const input    = document.getElementById("navSearchInput");
        const dropdown = document.getElementById("navSearchDropdown");
        if (!input || document.activeElement !== input) return;
        if (!dropdown || !dropdown.classList.contains("open")) return;

        const items = dropdown.querySelectorAll(".nav-search-result");
        if (!items.length) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            _activeIndex = Math.min(_activeIndex + 1, items.length - 1);
            _updateActiveItem(items);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            _activeIndex = Math.max(_activeIndex - 1, -1);
            _updateActiveItem(items);
        } else if (e.key === "Enter" && _activeIndex >= 0) {
            e.preventDefault();
            items[_activeIndex].click();
        } else if (e.key === "Escape") {
            _closeDropdown();
            input.blur();
        }
    });

    function _updateActiveItem(items) {
        items.forEach((el, i) => {
            const active = i === _activeIndex;
            el.setAttribute("aria-selected", active);
            el.classList.toggle("nav-search-result--active", active);
            if (active) el.scrollIntoView({ block: "nearest" });
        });
    }

    /* Close when clicking outside */
    document.addEventListener("click", function (e) {
        const wrap = document.getElementById("navUserSearch");
        if (wrap && !wrap.contains(e.target)) _closeDropdown();
    });

    function _openDropdown() {
        const d = document.getElementById("navSearchDropdown");
        if (d) d.classList.add("open");
    }

    function _closeDropdown() {
        const d = document.getElementById("navSearchDropdown");
        if (d) { d.classList.remove("open"); _activeIndex = -1; }
    }

    /* Called from anchor onclick to close before navigation */
    window._navSearchClose = function () {
        _closeDropdown();
        const input = document.getElementById("navSearchInput");
        if (input) { input.value = ""; _lastQuery = ""; }
    };

    /* Escape HTML entities */
    function _esc(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    /* Wrap matched substring in <mark> */
    function _highlightMatch(escaped, query) {
        const safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return escaped.replace(new RegExp(`(${safe})`, "i"), "<mark>$1</mark>");
    }

    /* Wire up keyboard: init is called after nav HTML is injected */
    window.initUserSearch = function () {
        // Nothing extra needed — event listeners use delegation / getElementById
        // and are already attached above via document-level listeners.
    };
}());

/* =========================================================
   INIT ON PAGE LOAD
   ========================================================= */

document.addEventListener("DOMContentLoaded", function () {
    loadNavigation();
});

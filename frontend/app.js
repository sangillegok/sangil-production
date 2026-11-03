const API = "/api";

let token = sessionStorage.getItem("sangil_production_token");
let currentUser = null;

const roleMenus = {
    SUPER_ADMIN: [
        { id: "dashboard", label: "Dashboard" },
        { id: "production", label: "Production" },
        { id: "efficiency", label: "Efficiency" },
        { id: "users", label: "User Management" },
        { id: "audit", label: "Audit Log" }
    ],
    ADMIN: [
        { id: "dashboard", label: "Dashboard" },
        { id: "production", label: "Production" },
        { id: "efficiency", label: "Efficiency" },
    ],
    MANAGER_PRODUCTION: [
        { id: "dashboard", label: "Dashboard" },
        { id: "production", label: "Production" },
        { id: "efficiency", label: "Efficiency" },
    ],
    OPERATOR: [
        { id: "production", label: "Production" },
        { id: "efficiency", label: "Efficiency" },
    ],
    VIEWER: [
        { id: "dashboard", label: "Dashboard" }
    ]
};

async function apiRequest(path, options = {}) {
    const headers = options.headers || {};

    if (token) {
        headers.Authorization = "Bearer " + token;
    }

    if (options.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(API + path, {
        ...options,
        headers
    });

    const text = await response.text();

    let data = {};

    if (text) {
        data = JSON.parse(text);
    }

    if (!response.ok) {
        throw new Error(data.detail || "Request gagal");
    }

    return data;
}

function setEfficiencyDateToday() {
    const dateInput = document.getElementById("effDate");
    if (!dateInput) return;
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
    dateInput.value = `${values.year}-${values.month}-${values.day}`;
}

function renderEfficiencyChart(containerId, rows, key, targetLine = null, categoryName = "") {
    const container = document.getElementById(containerId);
    if (!container) return;

    const title = "Actual Efficiency (%)";
    const chartTitle = categoryName || title;
    const fmt = value => Number(value || 0).toLocaleString("id-ID", {
        maximumFractionDigits: 2
    });

    if (!rows.length) {
        container.innerHTML = `
            <div style="padding:16px;color:#334155;font:14px Arial,sans-serif">
                <strong>${chartTitle}</strong>
                <div style="margin-top:6px;color:#64748b">${title}</div>
                <p style="margin:12px 0 0">Belum ada data untuk kategori ini.</p>
            </div>`;
        return;
    }

    const width = 600, height = 260;
    const left = 52, right = 18, top = 38, bottom = 48;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const values = rows.map(row => Number(row[key]) || 0);
    const maxValue = Math.max(1, ...values, targetLine || 0) * 1.18;
    const step = plotWidth / rows.length;
    const barWidth = Math.max(8, Math.min(38, step * 0.55));
    const y = value => top + plotHeight - (value / maxValue) * plotHeight;

    const grid = Array.from({ length: 5 }, (_, i) => {
        const value = maxValue * i / 4;
        const yy = y(value);
        return `
            <line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}" stroke="#cbd5e1"/>
            <text x="${left-8}" y="${yy+4}" text-anchor="end" font-size="11" fill="#334155">${fmt(value)}</text>`;
    }).join("");

    const bars = rows.map((row, index) => {
        const value = values[index];
        const x = left + index * step + (step - barWidth) / 2;
        const barY = y(value);
        const barHeight = Math.max(1, top + plotHeight - barY);
        return `
            <rect class="efficiency-bar" data-row-index="${index}" x="${x}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="3" fill="#2878c8" style="cursor:pointer">
                <title>${row.date}: ${fmt(value)}%</title>
            </rect>
            <text x="${x+barWidth/2}" y="${Math.max(24,barY-6)}" text-anchor="middle" font-size="11" font-weight="600" fill="#0f172a">${fmt(value)}%</text>
            <text x="${x+barWidth/2}" y="${height-22}" text-anchor="middle" font-size="11" fill="#334155">${String(row.date||"").slice(5)}</text>`;
    }).join("");

    const target = targetLine === null ? "" : `
        <line x1="${left}" y1="${y(targetLine)}" x2="${width-right}" y2="${y(targetLine)}"
              stroke="#d97706" stroke-width="2" stroke-dasharray="6 4"/>
        <text x="${width-right}" y="${Math.max(12,y(targetLine)-6)}" text-anchor="end"
              font-size="11" fill="#b45309">Target ${targetLine}%</text>`;
container.innerHTML = `
        <div style="padding:12px;color:#0f172a">
            <strong>${chartTitle}</strong>
            <div style="color:#64748b;margin:4px 0 8px">${title}</div>
            <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${chartTitle}"
                 style="display:block;width:100%;height:auto">
                <text x="${left}" y="20" font-size="14" font-weight="700" fill="#0f172a">${title}</text>
                ${grid}${target}${bars}
            </svg>
            <div class="efficiency-click-detail" style="margin-top:12px;padding:10px;border-radius:8px;background:#f1f5f9;color:#334155">
                Klik batang grafik untuk melihat detail tanggal.
            </div>
        </div>`;

    const detailBox = container.querySelector(".efficiency-click-detail");
    container.querySelectorAll(".efficiency-bar").forEach(bar => {
        bar.addEventListener("click", () => {
            const row = rows[Number(bar.dataset.rowIndex)];
            if (!row || !detailBox) return;
            detailBox.innerHTML = `
                <strong>Detail ${row.date || "-"}</strong>
                <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px">
                    <span>Waktu Kerja: ${fmt(row.total_working_time)} menit</span>
                    <span>Good Qty: ${fmt(row.good_quantity)}</span>
                    <span>Defect Qty: ${fmt(row.defect_quantity)}</span>
                    <span>Total Output: ${fmt(row.total_output)}</span>
                    <span>Defect Rate: ${fmt(row.defect_rate)}%</span>
                    <span>Actual Efficiency: ${fmt(row.actual_eff)}%</span>
                    <span>Target: ${fmt(row.target_eff)}%</span>
                </div>`;
        });
    });
}

async function loadEfficiencyDashboard() {
    const charts = [
        ["effChartTPL1", "TPL 1"],
        ["effChartTPL2", "TPL 2"],
        ["effChartPlateRear", "Plate Rear"],
        ["effChartMachineBottom", "Machine Bottom Plate"],
        ["effChartAssyRear", "Assy Plate Rear R1"],
        ["effChartAssyBottom", "Assy Bottom Plate"]
    ];

    charts.forEach(([id]) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<p class="form-message">Memuat data...</p>';
    });

    for (const [id, efficiencyType] of charts) {
        const chart = document.getElementById(id);
        if (!chart) continue;

        try {
            const result = await apiRequest(
                `/efficiency/daily?efficiency_type=${encodeURIComponent(efficiencyType)}`
            );
            renderEfficiencyChart(id, result.daily || [], "actual_eff", 90, efficiencyType);
        } catch (error) {
            chart.innerHTML = `<p class="form-message">${error.message}</p>`;
        }
    }
}

async function submitEfficiencyEntry(event) {
    event.preventDefault();
    const message = document.getElementById("efficiencyMessage");
    const payload = {
        efficiency_type: document.getElementById("effType").value,
        inspection_date: document.getElementById("effDate").value,
        shift: document.getElementById("effShift").value,
        stop_as_planned: document.getElementById("effStopAsPlanned").value,
        stop_time: document.getElementById("effStopTime").value,
        stop_as_planned_value: Number(document.getElementById("effStopAsPlannedValue").value || 0),
        stop_time_value: Number(document.getElementById("effStopTimeValue").value || 0),
        total_working_time: Number(document.getElementById("effWorkingTime").value),
        good_quantity: Number(document.getElementById("effGoodQty").value),
        defect_quantity: Number(document.getElementById("effDefectQty").value)
    };

    message.textContent = "Menyimpan data...";
    try {
        const result = await apiRequest("/efficiency/entries", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        message.textContent = `Data tersimpan. Actual efficiency: ${result.actual_eff}%`;
        document.getElementById("effWorkingTime").value = "";
        document.getElementById("effGoodQty").value = "";
        document.getElementById("effDefectQty").value = "0";
        await loadEfficiencyDashboard();
    } catch (error) {
        message.textContent = `Gagal menyimpan: ${error.message}`;
    }
}
function showLogin() {
    document.getElementById("loginPage").classList.remove("hidden");
    document.getElementById("appPage").classList.add("hidden");
}

function showApp() {
    document.getElementById("loginPage").classList.add("hidden");
    document.getElementById("appPage").classList.remove("hidden");
}

function buildMenu() {
    const menu = document.getElementById("menu");
    menu.innerHTML = "";

    const items = roleMenus[currentUser.role] || roleMenus.VIEWER;

    items.forEach(item => {
        const button = document.createElement("button");
        button.className = "menu-btn";
        button.dataset.page = item.id;
        button.textContent = item.label;
        button.onclick = () => showPage(item.id);
        menu.appendChild(button);
    });
}


function setProductionEffectiveDate() {
    const el = document.getElementById("productionDate");
    if (!el) return;

    function updateDateTime() {
        const now = new Date();

        const dateText = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Jakarta",
            day: "2-digit",
            month: "long",
            year: "numeric"
        }).format(now);

        const timeText = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Jakarta",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(now);

        el.textContent = `${dateText} | ${timeText} WIB`;
    }

    updateDateTime();

    if (window.productionClockTimer) {
        clearInterval(window.productionClockTimer);
    }

    window.productionClockTimer = setInterval(updateDateTime, 1000);
}
function showPage(page) {
    if (page === "efficiency") {
        setEfficiencyDateToday();
        loadEfficiencyDashboard();
    }
    const pages = [
        "dashboard",
        "production",
        "users",
        "audit"
    ];

    pages.forEach(name => {
        const element = document.getElementById(name + "Page");

        if (element) {
            element.classList.add("hidden");
        }
    });

    const selected = document.getElementById(page + "Page");

    if (selected) {
        selected.classList.remove("hidden");
    }

    const menuButtons = document.querySelectorAll(".menu-btn");

    menuButtons.forEach(button => {
        button.classList.toggle("active", button.dataset.page === page);
    });

    const titles = {
        dashboard: ["Dashboard", "Production overview"],
        production: ["Production", "Production control"],
        efficiency: ["Efficiency Dashboard", "Daily production efficiency"],
        users: ["User Management", "System user management"],
        audit: ["Audit Log", "System activity history"]
    };

    const title = titles[page] || titles.dashboard;

    document.getElementById("pageTitle").textContent = title[0];
    document.getElementById("pageSubtitle").textContent = title[1];
}

const efficiencyForm = document.getElementById("efficiencyForm");
if (efficiencyForm) {
    efficiencyForm.addEventListener("submit", submitEfficiencyEntry);
}

function renderUser() {
    document.getElementById("displayName").textContent = currentUser.full_name;
    document.getElementById("displayRole").textContent = currentUser.role;

    const initial = currentUser.full_name
        ? currentUser.full_name.charAt(0).toUpperCase()
        : "S";

    document.getElementById("userAvatar").textContent = initial;
}

async function loadCurrentUser() {
    const params = new URLSearchParams(window.location.search);
    const machineParam = String(params.get("machine") || "")
        .trim()
        .replace(/\s+/g, " ");
    const normalizeMachine = value =>
        String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
    const allowedMachines = [
        "Soldering",
        "Cutting Pipe Condenser",
        "Cutting Pipe Hotline",
        "Cutting Copper Tube",
        "Cutting & Notching",
        "Bending Auto Condensor Pipe",
        "300T-01",
        "400T-01",
        "400T-02",
        "400T-03",
        "250T-A01",
        "300T-02",
        "400T-04",
        "250T-A02",
        "250T-A03",
        "250T-A04",
        "250T-A05",
        "250T-A06",
        "250T-B01",
        "250T-B02",
        "250T-B03",
        "250T-B04",
        "80T-01",
        "250T-C01",
        "Spot Welding Siku Reinforce",
        "Spot Welding Hinge Part",
        "45T-01",
        "40T-01",
        "45T-02", "Spot Welding Base Compresor",
        "Spot Welding Nut Reinforce",
        "Spot Welding Reinforce R",
        "Spot Welding Reinforce L",
        "Spot Nut Hinge Upper",
        "Spot Nut Hinge Center"
    ];
    const publicMachine = allowedMachines.find(name => normalizeMachine(name) === normalizeMachine(machineParam));

    if (publicMachine) {
        window.productionPublicMode = true;
        window.productionPublicMachine = publicMachine;
        currentUser = null;
        document.getElementById("loginPage").classList.add("hidden");
        document.getElementById("appPage").classList.remove("hidden");

        const sidebar = document.querySelector(".sidebar");
        if (sidebar) sidebar.style.display = "none";

        document.querySelectorAll(".production-machine-card").forEach(card => {
            card.style.display =
                card.dataset.machineName === publicMachine ? "" : "none";
        });

        const downloadButton = document.querySelector(".production-download-button");
        if (downloadButton) downloadButton.style.display = "none";

        showPage("production");
        return;
    }

    if (!token) {
        showLogin();
        return;
    }

    currentUser = await apiRequest("/me");
    renderUser();
    buildMenu();
    showApp();
    showPage("dashboard");
}

document.getElementById("loginForm").addEventListener("submit", async event => {
    event.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const error = document.getElementById("loginError");

    error.textContent = "";

    const button = document.querySelector("#loginForm button");
    button.disabled = true;
    button.querySelector("span").textContent = "Signing in...";

    try {
        const result = await apiRequest("/auth/login", {
            method: "POST",
            body: JSON.stringify({
                username,
                password
            })
        });

        token = result.access_token;

        sessionStorage.setItem(
            "sangil_production_token",
            token
        );

        currentUser = result.user;

        renderUser();
        buildMenu();
        showApp();
        showPage("dashboard");

    } catch (errorObject) {
        error.textContent = errorObject.message;
        sessionStorage.removeItem("sangil_production_token");
        token = null;
    }

    button.disabled = false;
    button.querySelector("span").textContent = "Login";
});

document.getElementById("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("sangil_production_token");
    token = null;
    currentUser = null;

    document.getElementById("password").value = "";
    showLogin();
});

loadCurrentUser();


/* USER MANAGEMENT */

let usersLoaded = false;

async function loadUsers() {
    if (!currentUser || currentUser.role !== "SUPER_ADMIN") {
        return;
    }

    const body = document.getElementById("usersTableBody");

    body.innerHTML = `
        <tr>
            <td colspan="7" class="loading-cell">Loading users...</td>
        </tr>
    `;

    try {
        const result = await apiRequest("/users");

        renderUsers(result.users);

        usersLoaded = true;

    } catch (errorObject) {
        body.innerHTML = `
            <tr>
                <td colspan="7" class="loading-cell">
                    ${escapeHtml(errorObject.message)}
                </td>
            </tr>
        `;
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatRole(role) {
    if (role === "MANAGER_PRODUCTION") {
        return "MANAGER PRODUCTION";
    }

    return role;
}

function renderUsers(users) {
    const body = document.getElementById("usersTableBody");

    if (!users.length) {
        body.innerHTML = `
            <tr>
                <td colspan="7" class="loading-cell">
                    Belum ada user.
                </td>
            </tr>
        `;

        return;
    }

    body.innerHTML = users.map(user => {

        const status = user.is_active
            ? `<span class="status-active">ACTIVE</span>`
            : `<span class="status-inactive">INACTIVE</span>`;

        const created = user.created_at
            ? new Date(user.created_at).toLocaleDateString("id-ID")
            : "-";

        const isSelf = user.id === currentUser.id;

        const actions = isSelf
            ? `<span style="color:#687686;font-size:10px">Current Account</span>`
            : `
                <div class="action-group">
                    <button class="action-btn" onclick="editUser(${user.id})">
                        Edit
                    </button>

                    <button class="action-btn" onclick="openPasswordModal(${user.id}, '${escapeHtml(user.username)}')">
                        Password
                    </button>

                    <button class="action-btn delete" onclick="deleteUser(${user.id}, '${escapeHtml(user.username)}')">
                        Delete
                    </button>
                </div>
            `;

        return `
            <tr>
                <td>${user.id}</td>
                <td><strong>${escapeHtml(user.username)}</strong></td>
                <td>${escapeHtml(user.full_name)}</td>
                <td>
                    <span class="role-badge">
                        ${escapeHtml(formatRole(user.role))}
                    </span>
                </td>
                <td>${status}</td>
                <td>${created}</td>
                <td>${actions}</td>
            </tr>
        `;

    }).join("");
}

function openUserModal() {
    document.getElementById("userModalTitle").textContent = "Add User";

    document.getElementById("userId").value = "";
    document.getElementById("userUsername").value = "";
    document.getElementById("userFullName").value = "";
    document.getElementById("userRole").value = "OPERATOR";
    document.getElementById("userPassword").value = "";
    document.getElementById("userActive").checked = true;

    document.getElementById("userUsername").disabled = false;
    document.getElementById("passwordGroup").classList.remove("hidden");
    document.getElementById("activeGroup").classList.add("hidden");
    document.getElementById("userFormError").textContent = "";

    document.getElementById("userModal").classList.remove("hidden");
}

function closeUserModal() {
    document.getElementById("userModal").classList.add("hidden");
}

async function editUser(userId) {
    try {
        const result = await apiRequest("/users");

        const user = result.users.find(item => item.id === userId);

        if (!user) {
            return;
        }

        document.getElementById("userModalTitle").textContent = "Edit User";

        document.getElementById("userId").value = user.id;
        document.getElementById("userUsername").value = user.username;
        document.getElementById("userFullName").value = user.full_name;
        document.getElementById("userRole").value = user.role;
        document.getElementById("userActive").checked = user.is_active;

        document.getElementById("userUsername").disabled = true;
        document.getElementById("passwordGroup").classList.add("hidden");
        document.getElementById("activeGroup").classList.remove("hidden");
        document.getElementById("userFormError").textContent = "";

        document.getElementById("userModal").classList.remove("hidden");

    } catch (errorObject) {
        alert(errorObject.message);
    }
}

document.getElementById("userForm").addEventListener("submit", async event => {
    event.preventDefault();

    const userId = document.getElementById("userId").value;
    const error = document.getElementById("userFormError");

    error.textContent = "";

    try {
        if (!userId) {

            await apiRequest("/users", {
                method: "POST",
                body: JSON.stringify({
                    username: document.getElementById("userUsername").value.trim(),
                    full_name: document.getElementById("userFullName").value.trim(),
                    password: document.getElementById("userPassword").value,
                    role: document.getElementById("userRole").value
                })
            });

        }

        if (userId) {

            await apiRequest("/users/" + userId, {
                method: "PUT",
                body: JSON.stringify({
                    full_name: document.getElementById("userFullName").value.trim(),
                    role: document.getElementById("userRole").value,
                    is_active: document.getElementById("userActive").checked
                })
            });

        }

        closeUserModal();
        await loadUsers();

        showUserMessage("User berhasil disimpan.", false);

    } catch (errorObject) {
        error.textContent = errorObject.message;
    }
});

function openPasswordModal(userId, username) {
    document.getElementById("resetUserId").value = userId;
    document.getElementById("resetPasswordUser").textContent =
        "User: " + username;

    document.getElementById("resetPassword").value = "";
    document.getElementById("passwordFormError").textContent = "";

    document.getElementById("passwordModal").classList.remove("hidden");
}

function closePasswordModal() {
    document.getElementById("passwordModal").classList.add("hidden");
}

document.getElementById("passwordForm").addEventListener("submit", async event => {
    event.preventDefault();

    const userId = document.getElementById("resetUserId").value;
    const error = document.getElementById("passwordFormError");

    error.textContent = "";

    try {
        await apiRequest("/users/" + userId + "/reset-password", {
            method: "POST",
            body: JSON.stringify({
                password: document.getElementById("resetPassword").value
            })
        });

        closePasswordModal();

        showUserMessage("Password berhasil direset.", false);

    } catch (errorObject) {
        error.textContent = errorObject.message;
    }
});

async function deleteUser(userId, username) {
    const confirmed = confirm(
        "Hapus user '" + username + "'?"
    );

    if (!confirmed) {
        return;
    }

    try {
        await apiRequest("/users/" + userId, {
            method: "DELETE"
        });

        await loadUsers();

        showUserMessage("User berhasil dihapus.", false);

    } catch (errorObject) {
        showUserMessage(errorObject.message, true);
    }
}

function showUserMessage(message, isError) {
    const element = document.getElementById("userMessage");

    element.textContent = message;

    element.style.color = isError
        ? "var(--danger)"
        : "var(--success)";

    setTimeout(() => {
        element.textContent = "";
    }, 4000);
}


const originalProductionShowPage = showPage;

showPage = function(page) {

    originalProductionShowPage(page);

    if (page === "production") {
        setProductionEffectiveDate();
        loadProductionHistory();
    }
};
const originalShowPage = showPage;

showPage = function(page) {
    originalShowPage(page);

    if (page === "users") {
        loadUsers();
    }
};
document.addEventListener("DOMContentLoaded", function () {
    setProductionEffectiveDate();
});


async function downloadProductionResult() {

    try {

        if (currentUser && currentUser.role === "OPERATOR") {

            alert(
                "Akses Download Excel tidak diperbolehkan untuk Operator."
            );

            return;
        }

        if (!token) {
            alert("Session login sudah berakhir. Silakan login kembali.");
            return;
        }

        const response = await fetch(
            "/api/production/checksheets/download",
            {
                method: "GET",
                headers: {
                    "Authorization": "Bearer " + token
                }
            }
        );

        if (!response.ok) {

            const errorText =
                await response.text();

            console.error(
                "DOWNLOAD EXCEL ERROR:",
                errorText
            );

            alert(
                "Gagal download Production Checksheet.\n\n" +
                errorText
            );

            return;
        }

        const blob =
            await response.blob();

        const url =
            URL.createObjectURL(blob);

        const link =
            document.createElement("a");

        link.href = url;

        const now = new Date();

        const datePart =
            new Intl.DateTimeFormat(
                "en-CA",
                {
                    timeZone: "Asia/Jakarta"
                }
            ).format(now);

        link.download =
            "Production_Checksheet_Rekap_" +
            datePart +
            ".xlsx";

        document.body.appendChild(link);

        link.click();

        document.body.removeChild(link);

        URL.revokeObjectURL(url);

    } catch (errorObject) {

        console.error(
            "DOWNLOAD PRODUCTION ERROR:",
            errorObject
        );

        alert(
            "Gagal download Production Checksheet.\n\n" +
            errorObject.message
        );
    }
}

function escapeExcelHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}


window.saveProductionChecksheet = async function (button) {
    const card = button && button.closest("[data-machine-name]");
    if (!card) { alert("Bagian mesin tidak ditemukan."); return; }
    const machineName = card.dataset.machineName || "";
    const operatorName = card.querySelector(".machine-operator")?.value.trim() || "";
    const message = card.querySelector(".machine-save-message");
    
    if (!operatorName) { alert("Operator Name wajib diisi untuk " + machineName + "."); card.querySelector(".machine-operator")?.focus(); return; }
    const checks = Array.from(card.querySelectorAll("tbody tr")).map(tr => {
    const itemCheck = tr.querySelector(".check-item")?.value.trim() || "";
    const actualInspec = tr.querySelector(".actual-inspec")?.value || "";
    const isPressureAir = /pressure air cyc?linder/i.test(itemCheck);
    const isAirPressure = /^(air preasure|air pressure)$/i.test(itemCheck);
    const condition = tr.querySelector(".check-condition")?.value.trim() || "";
    const airStandard = condition.toLowerCase().replace(/\s+/g, " ").trim();
    let status = "OK";

    if (isPressureAir) {
        status = actualInspec === "3-5 Mpa" ? "OK" : "NG";
    } else if (isAirPressure && /2\s*-\s*5\s*bar/i.test(airStandard)) {
        status = ["2", "3", "4", "5"].includes(actualInspec) ? "OK" : "NG";
    } else if (isAirPressure && /5\s*-\s*7\s*bar/i.test(airStandard)) {
        status = ["5", "6", "7"].includes(actualInspec) ? "OK" : "NG";
    }

    return {
        item_check: itemCheck,
        condition: condition,
        actual_inspec: actualInspec,
        status: status,
        machine_condition: "RUN",
        remarks: tr.querySelector(".check-remarks")?.value.trim() || ""
    };
});
    if (!checks.length) { alert("Item pemeriksaan tidak ditemukan."); return; }
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = "Saving...";
    if (message) message.textContent = "Menyimpan checksheet " + machineName + "...";
    try {
        const result = await apiRequest(window.productionPublicMode ? "/public/production/checksheet" : "/production/checksheet", {
            method: "POST",
            body: JSON.stringify({ machine_name: machineName, operator_name: operatorName, pic_operator: "", checks })
        });
        if (message) message.textContent = "Berhasil disimpan. Checksheet ID: " + result.checksheet_id;
        alert(machineName + " berhasil disimpan.\nChecksheet ID: " + result.checksheet_id);
        await loadProductionHistory();
        if (typeof loadProductionDashboard === "function") loadProductionDashboard();
    } catch (error) {
        console.error("PRODUCTION SAVE ERROR:", error);
        if (message) message.textContent = "Gagal menyimpan: " + (error.message || "Terjadi kesalahan.");
        alert("GAGAL SAVE " + machineName + "\n\n" + (error.message || "Terjadi kesalahan."));
    } finally {
        button.disabled = false;
        button.textContent = oldText || "Save Checksheet";
    }
};

async function loadProductionHistory() {

    const container =
        document.getElementById("productionHistoryList");

    if (!container) {
        return;
    }

    container.innerHTML =
        '<div class="form-message">Loading history...</div>';

    try {

        const result =
            await apiRequest(window.productionPublicMode ? "/public/production/checksheets" : "/production/checksheets");

        const rows =
            result.checksheets || [];

        if (rows.length === 0) {

            container.innerHTML = `
                <div class="empty-state">
                    <h3>No Production Data</h3>
                    <p>Belum ada Production Checksheet yang tersimpan.</p>
                </div>
            `;

            return;
        }

        const grouped = {};

        rows.forEach(row => {

            if (!grouped[row.id]) {

                grouped[row.id] = {
                    id: row.id,
                    effective_date: row.effective_date,
                    shift: row.shift,
                    operator_name: row.operator_name,
                    pic_operator: row.pic_operator,
                    created_at: row.created_at,
                    items: []
                };
            }

            if (row.item_no !== null) {

                grouped[row.id].items.push({
                    item_no: row.item_no,
                    item_check: row.item_check,
                    condition: row.condition,
                    machine_condition: row.machine_condition
                });
            }
        });

        const checksheets =
            Object.values(grouped);

        container.innerHTML =
            checksheets.map(checksheet => {

                const createdDate =
                    checksheet.created_at
                        ? new Date(checksheet.created_at)
                            .toLocaleString("id-ID", {
                                timeZone: "Asia/Jakarta"
                            })
                        : "-";

                const itemsHtml =
                    checksheet.items.map(item => `
                        <tr>
                            <td>${item.item_no}</td>
                            <td>${escapeHtml(item.item_check)}</td>
                            <td>${escapeHtml(item.condition)}</td>
                            <td>${escapeHtml(item.actual_inspec || "")}</td>
                            <td>${escapeHtml(item.remarks || "")}</td>
                        </tr>
                    `).join("");

                return `
                    <div class="history-card">

                        <div class="history-card-header">

                            <div>
                                <strong>
                                    Checksheet #${checksheet.id}
                                </strong>

                                <div class="history-created">
                                    Saved: ${createdDate}
                                </div>
                            </div>
</div>

                        <div class="history-info">

                            <div>
                                <span>Effective Date</span>
                                <strong>${escapeHtml(checksheet.effective_date || "-")}</strong>
                            </div>

                            <div>
                                <span>Operator</span>
                                <strong>${escapeHtml(checksheet.operator_name || "-")}</strong>
                            </div>

                            <div>
                                <span>PIC Operator</span>
                                <strong>${escapeHtml(checksheet.pic_operator || "-")}</strong>
                            </div>

                        </div>

                        <div class="table-wrapper">

                            <table class="data-table production-history-table">

                                <thead>
                                    <tr>
                                        <th>No</th>
                                        <th>Item Check</th>
                                        <th>Status</th>
                                        <th>Actual Inspec</th>
                                        <th>Remarks</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    ${itemsHtml}
                                </tbody>

                            </table>

                        </div>

                    </div>
                `;

            }).join("");

    } catch (errorObject) {

        console.error(
            "LOAD PRODUCTION HISTORY ERROR:",
            errorObject
        );

        container.innerHTML = `
            <div class="form-message" style="color:red;">
                Gagal mengambil data Production:
                ${escapeHtml(errorObject.message)}
            </div>
        `;
    }
}


function escapeHtml(value) {

    const div = document.createElement("div");

    div.textContent =
        value === null || value === undefined
            ? ""
            : String(value);

    return div.innerHTML;
}



async function loadProductionHistory() {

    const container = document.getElementById("productionHistoryList");

    if (!container) {
        return;
    }

    container.innerHTML =
        '<div style="padding:15px;color:#94a3b8;">Loading...</div>';

    try {

        const result = await apiRequest(window.productionPublicMode ? "/public/production/checksheets" : "/production/checksheets");

        const rows = Array.isArray(result?.checksheets)
            ? result.checksheets
            : [];

        if (rows.length === 0) {

            container.innerHTML =
                '<div style="padding:15px;color:#94a3b8;">Belum ada data Production.</div>';

            return;
        }

        const grouped = {};

        rows.forEach(row => {

            const id = row.id;

            if (!grouped[id]) {

                grouped[id] = {
                    id: id,
                    effective_date: row.effective_date,
                    created_at: row.created_at,
                    operator_name: row.operator_name,
                    stopped_machines: []
                };
            }

            if ((["NG", "LAIN"].includes(String(row.actual_inspec || "").trim().toUpperCase()) || ["NG", "LAIN"].includes(String(row.status || "").trim().toUpperCase())) && row.item_check) {

                if (
                    !grouped[id].stopped_machines.includes(
                        row.item_check
                    )
                ) {

                    grouped[id].stopped_machines.push(
                        row.item_check
                    );
                }
            }
        });

        const history = Object.values(grouped);

        history.sort((a, b) => {
            return new Date(b.created_at) - new Date(a.created_at);
        });

        let html = "";

        history.forEach((item, index) => {

            const dateText = item.effective_date
                ? new Intl.DateTimeFormat("en-CA", {
                    timeZone: "Asia/Jakarta",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit"
                }).format(
                    new Date(
                        item.effective_date + "T00:00:00+07:00"
                    )
                )
                : "-";

            const timeText = item.created_at
                ? new Intl.DateTimeFormat("en-GB", {
                    timeZone: "Asia/Jakarta",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false
                }).format(
                    new Date(item.created_at)
                )
                : "-";

            const operatorName =
                String(item.operator_name || "-")
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;");

            let stoppedMachines = "-";

            if (item.stopped_machines.length > 0) {

                stoppedMachines =
                    item.stopped_machines
                        .map(machine =>
                            String(machine)
                                .replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;")
                                .replace(/"/g, "&quot;")
                        )
                        .join(", ");

            }

            html += `
                <div class="production-history-row">

                    <div class="production-history-number">
                        ${index + 1}
                    </div>

                    <div class="production-history-date">
                        <span class="history-label">Tanggal</span>
                        <strong>${dateText}</strong>
                    </div>

                    <div class="production-history-time">
                        <span class="history-label">Jam</span>
                        <strong>${timeText}</strong>
                    </div>

                    <div class="production-history-operator">
                        <span class="history-label">Nama Operator</span>
                        <strong>${operatorName}</strong>
                    </div>

                    <div class="production-history-stop">
                        <span class="history-label">Mesin STOP</span>
                        <strong>${stoppedMachines}</strong>
                    </div>

                </div>
            `;
        });

        container.innerHTML = html;

    } catch (errorObject) {

        console.error(
            "LOAD PRODUCTION HISTORY ERROR:",
            errorObject
        );

        container.innerHTML =
            '<div style="padding:15px;color:#ef4444;">Gagal mengambil history Production.</div>';
    }
}



async function loadProductionHistory() {

    const container = document.getElementById("productionHistoryList");

    if (!container) {
        return;
    }

    container.innerHTML =
        '<div style="padding:15px;color:#94a3b8;">Loading...</div>';

    try {

        const result = await apiRequest(window.productionPublicMode ? "/public/production/checksheets" : "/production/checksheets");

        const rows = Array.isArray(result?.checksheets)
            ? result.checksheets
            : [];

        if (rows.length === 0) {

            container.innerHTML =
                '<div style="padding:15px;color:#94a3b8;">Belum ada data Production.</div>';

            return;
        }

        const grouped = {};

        rows.forEach(row => {

            const id = row.id;

            if (!grouped[id]) {

                grouped[id] = {
                    id: id,
                    effective_date: row.effective_date,
                    created_at: row.created_at,
                    operator_name: row.operator_name,
                    machine_name: row.machine_name || "Legacy / Tidak diketahui",
                    shift: row.shift || "-",
                    stopped_machines: []
                };
            }

            if ((["NG", "LAIN"].includes(String(row.actual_inspec || "").trim().toUpperCase()) || ["NG", "LAIN"].includes(String(row.status || "").trim().toUpperCase())) && row.item_check) {

                if (
                    !grouped[id].stopped_machines.includes(
                        row.item_check
                    )
                ) {

                    grouped[id].stopped_machines.push(
                        row.item_check
                    );
                }
            }
        });

        const history = Object.values(grouped);

        history.sort((a, b) => {
            return new Date(b.created_at) - new Date(a.created_at);
        });

        const pageSize = 5;
        const totalPages = Math.max(1, Math.ceil(history.length / pageSize));
        const requestedPage = Number.parseInt(
            window.productionHistoryPage || "1",
            10
        );
        const page = Math.min(
            Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
            totalPages
        );

        window.productionHistoryPage = page;

        const pageStart = (page - 1) * pageSize;
        const pageHistory = history.slice(pageStart, pageStart + pageSize);

        let html = "";

        pageHistory.forEach((item, index) => {

            const dateText = item.effective_date
                ? new Intl.DateTimeFormat("en-CA", {
                    timeZone: "Asia/Jakarta",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit"
                }).format(
                    new Date(
                        item.effective_date + "T00:00:00+07:00"
                    )
                )
                : "-";

            const timeText = item.created_at
                ? new Intl.DateTimeFormat("en-GB", {
                    timeZone: "Asia/Jakarta",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false
                }).format(
                    new Date(item.created_at)
                )
                : "-";

            const operatorName =
                String(item.operator_name || "-")
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;");

            const shift =
                String(item.shift || "-")
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;");

            let stoppedMachines = "-";

            if (item.stopped_machines.length > 0) {

                stoppedMachines =
                    item.stopped_machines
                        .map(machine =>
                            String(machine)
                                .replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;")
                                .replace(/"/g, "&quot;")
                        )
                        .join(", ");
            }

            html += `
                <div class="production-history-row">

                    <div class="production-history-number">
                        ${pageStart + index + 1}
                    </div>

                    <div class="production-history-date">
                        <span class="history-label">Mesin</span>
                        <strong>${String(item.machine_name || "-").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</strong>
                        <span class="history-label">Tanggal</span>
                        <strong>${dateText}</strong>
                    </div>

                    <div class="production-history-time">
                        <span class="history-label">Jam</span>
                        <strong>${timeText}</strong>
                    </div>

                    <div class="production-history-operator">
                        <span class="history-label">Nama Operator</span>
                        <strong>${operatorName}</strong>
                    </div>
<div class="production-history-stop">
                        <span class="history-label">Mesin STOP</span>
                        <strong>${stoppedMachines}</strong>
                    </div>

                </div>
            `;
        });

        container.innerHTML = html + `
            <div class="production-history-pagination"
                 style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px;padding:14px;border-top:1px solid var(--border,#29445d);">
                <span style="font-size:12px;color:var(--muted,#94a3b8);">
                    Halaman ${page} dari ${totalPages} Ãƒâ€šÃ‚Â·
                    ${history.length} checksheet Ãƒâ€šÃ‚Â·
                    Menampilkan ${history.length ? pageStart + 1 : 0}-${Math.min(pageStart + pageSize, history.length)}
                </span>
                <div style="display:flex;gap:8px;">
                    <button type="button" id="productionHistoryPrev"
                        class="secondary-btn" ${page <= 1 ? "disabled" : ""}>
                        Sebelumnya
                    </button>
                    <button type="button" id="productionHistoryNext"
                        class="secondary-btn" ${page >= totalPages ? "disabled" : ""}>
                        Berikutnya
                    </button>
                </div>
            </div>
        `;

        const prevButton = container.querySelector("#productionHistoryPrev");
        const nextButton = container.querySelector("#productionHistoryNext");

        if (prevButton) {
            prevButton.addEventListener("click", function() {
                if (window.productionHistoryPage > 1) {
                    window.productionHistoryPage -= 1;
                    loadProductionHistory();
                }
            });
        }

        if (nextButton) {
            nextButton.addEventListener("click", function() {
                if (window.productionHistoryPage < totalPages) {
                    window.productionHistoryPage += 1;
                    loadProductionHistory();
                }
            });
        }

    } catch (errorObject) {

        console.error(
            "LOAD PRODUCTION HISTORY ERROR:",
            errorObject
        );

        container.innerHTML =
            '<div style="padding:15px;color:#ef4444;">Gagal mengambil history Production.</div>';
    }
}



function applyOperatorProductionRestriction() {

    if (!currentUser) {
        return;
    }

    if (currentUser.role !== "OPERATOR") {
        return;
    }

    document
        .querySelectorAll("#productionPage button")
        .forEach(button => {

            const onclick =
                button.getAttribute("onclick") || "";

            if (
                onclick.includes(
                    "downloadProductionResult"
                )
            ) {

                button.style.display = "none";
            }
        });
}



const operatorRestrictedShowPage = showPage;

showPage = function(page) {

    operatorRestrictedShowPage(page);

    if (
        page === "production" &&
        currentUser &&
        currentUser.role === "OPERATOR"
    ) {

        setTimeout(
            applyOperatorProductionRestriction,
            100
        );
    }
};

async function loadAuditLogs() {

    const body = document.getElementById("auditLogBody");
    const summary = document.getElementById("auditLogSummary");

    if (!body) {
        return;
    }

    body.innerHTML = `
        <tr>
            <td colspan="6" class="audit-loading">
                Loading Audit Log...
            </td>
        </tr>
    `;

    if (summary) {
        summary.textContent = "Mengambil data Audit Log...";
    }

    const response = await fetch(`${API}/audit-logs`, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    const result = await response.json();

    if (!response.ok) {
        body.innerHTML = `
            <tr>
                <td colspan="6" class="audit-error">
                    ${result.detail || "Gagal mengambil Audit Log."}
                </td>
            </tr>
        `;

        if (summary) {
            summary.textContent = "Gagal mengambil Audit Log.";
        }

        return;
    }

    const logs = result.logs || [];

    if (summary) {
        summary.textContent = `Total ${logs.length} aktivitas terbaru`;
    }

    if (logs.length === 0) {
        body.innerHTML = `
            <tr>
                <td colspan="6" class="audit-loading">
                    Belum ada aktivitas.
                </td>
            </tr>
        `;

        return;
    }

    body.innerHTML = logs.map((log, index) => {

        const created = new Date(log.created_at);

        const date = created.toLocaleDateString("id-ID", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        });

        const time = created.toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });

        const username = log.username || "-";
        const action = log.action || "-";
        const description = log.description || "-";

        return `
            <tr>
                <td>${index + 1}</td>
                <td>${date}</td>
                <td>${time}</td>
                <td><strong>${username}</strong></td>
                <td>
                    <span class="audit-action">
                        ${action}
                    </span>
                </td>
                <td>${description}</td>
            </tr>
        `;

    }).join("");
}

const auditShowPageOriginal = showPage;

showPage = function(page) {

    auditShowPageOriginal(page);

    if (page === "audit") {
        loadAuditLogs();
    }
};

// ===== Dashboard Production Charts =====
async function loadProductionDashboard(requestedRangeDays) {
    const dailySummary = document.getElementById("dashboardDailySummary");
    const dailyChart = document.getElementById("dashboardDailyChart");
    const recentTable = document.getElementById("dashboardRecentTable");
    const attentionTable = document.getElementById("dashboardAttentionTable");
    if (!dailySummary || !dailyChart) return;

    const cycleMachines = [
        "Soldering",
        "Cutting Pipe Condenser",
        "Cutting Pipe Hotline",
        "Cutting Copper Tube",
        "Cutting & Notching",
        "Bending Auto Condensor Pipe"
    ];

    const metalMachines = [
        "300T-01", "300T-02",
        "400T-01", "400T-02", "400T-03", "400T-04",
        "250T-A01", "250T-A02", "250T-A03", "250T-A04", "250T-A05", "250T-A06",
        "250T-B01", "250T-B02", "250T-B03", "250T-B04", "250T-C01", "80T-01",
        "Spot Welding Siku Reinforce", "Spot Welding Hinge Part",
        "Spot Welding Nut Reinforce", "Spot Welding Reinforce R", "Spot Welding Reinforce L",
        "Spot Nut Hinge Upper", "Spot Nut Hinge Center", "Spot Welding Base Compresor",
        "45T-01", "40T-01", "45T-02"
    ];

    const allMachines = cycleMachines.concat(metalMachines);
    const cycleSet = new Set(cycleMachines);
    const metalSet = new Set(metalMachines);
    const rangeDays = [7, 30, 90, 180, 365].includes(Number(requestedRangeDays || window.dashboardRangeDays))
        ? Number(requestedRangeDays || window.dashboardRangeDays)
        : 7;
    window.dashboardRangeDays = rangeDays;

    function dateKey(date) {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit"
        }).format(date);
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function getMachineGroup(name) {
        if (cycleSet.has(name)) return "CYCLE";
        if (metalSet.has(name)) return "METAL";
        return "Lainnya";
    }

    function isNG(item) {
        const status = String(item.status || "").trim().toUpperCase();
        const actual = String(item.actual_inspec || "").trim().toUpperCase();
        const machineCondition = String(item.machine_condition || "").trim().toUpperCase();
        return status === "NG" || actual === "NG" || machineCondition === "STOP";
    }

    function renderGroup(label, machineList, submitted, prefix) {
        const completed = machineList.filter(name => submitted.has(name)).length;
        const percentage = Math.round(completed / machineList.length * 100);
        setText("dashboard" + prefix + "Summary", completed + " / " + machineList.length + " mesin");
        setText("dashboard" + prefix + "ProgressText", "Kelengkapan " + percentage + "%");
        setText("dashboard" + prefix + "Percent", percentage + "%");
        const bar = document.getElementById("dashboard" + prefix + "ProgressBar");
        if (bar) bar.style.width = percentage + "%";
    }

    // Pasang event handler satu kali, walaupun dashboard dibuka berulang kali.
    const dashboardRoot = document.getElementById("dashboardPage");
    if (dashboardRoot && dashboardRoot.dataset.refDashboardBound !== "1") {
        dashboardRoot.dataset.refDashboardBound = "1";
        dashboardRoot.addEventListener("click", function(event) {
            const rangeButton = event.target.closest("[data-dashboard-range]");
            if (rangeButton) {
                window.dashboardRangeDays = Number(rangeButton.dataset.dashboardRange) || 7;
                dashboardRoot.querySelectorAll("[data-dashboard-range]").forEach(button => {
                    button.classList.toggle("active", button === rangeButton);
                });
                loadProductionDashboard(window.dashboardRangeDays);
                return;
            }

            const attentionButton = event.target.closest("[data-attention-filter]");
            if (attentionButton) {
                window.dashboardAttentionFilter = attentionButton.dataset.attentionFilter || "all";
                dashboardRoot.querySelectorAll("[data-attention-filter]").forEach(button => {
                    button.classList.toggle("active", button === attentionButton);
                });
                renderDashboardAttention();
                return;
            }

            const machineButton = event.target.closest("[data-dashboard-open-machine]");
            if (machineButton) {
                const machineName = machineButton.dataset.dashboardOpenMachine || "";
                if (typeof showPage === "function") showPage("production");
                window.setTimeout(function() {
                    const card = Array.from(document.querySelectorAll(".production-machine-card"))
                        .find(element => String(element.dataset.machineName || "").trim().toLowerCase() === machineName.trim().toLowerCase());
                    if (card) {
                        card.scrollIntoView({ behavior: "smooth", block: "start" });
                        card.style.outline = "2px solid #28d9aa";
                        window.setTimeout(() => { card.style.outline = ""; }, 2500);
                    }
                }, 150);
                return;
            }

            if (event.target.closest("[data-dashboard-see-all]")) {
                if (typeof showPage === "function") showPage("production");
            }
        });
    }

    try {
        const result = await apiRequest(
            window.productionPublicMode ? "/public/production/checksheets" : "/production/checksheets"
        );
        const rawRows = Array.isArray(result.checksheets) ? result.checksheets : [];
        window.dashboardProductionRows = rawRows;

        // API mengirim satu baris per item; kelompokkan agar satu checksheet tidak dihitung berkali-kali.
        const sheetMap = new Map();
        rawRows.forEach(function(row) {
            const id = String(row.id ?? row.checksheet_id ?? (String(row.machine_name || "") + "|" + String(row.effective_date || "") + "|" + String(row.created_at || "")));
            if (!sheetMap.has(id)) sheetMap.set(id, { ...row, items: [] });
            if (row.item_no !== null && row.item_no !== undefined && row.item_check) {
                sheetMap.get(id).items.push(row);
            }
        });
        const checksheets = Array.from(sheetMap.values());
        const today = dateKey(new Date());
        const todaySheets = checksheets.filter(sheet => String(sheet.effective_date || "-").slice(0, 10) === today);
        const submittedToday = new Set(
            todaySheets.map(sheet => String(sheet.machine_name || "").trim()).filter(name => allMachines.includes(name))
        );
        const missingMachines = allMachines.filter(name => !submittedToday.has(name));
        const completed = submittedToday.size;
        const percentage = Math.round(completed / allMachines.length * 100);

        setText("dashboardCompletedToday", completed);
        setText("dashboardCompletedText", completed + " dari " + allMachines.length + " mesin");
        setText("dashboardCompletedPercent", percentage + "% selesai");
        setText("dashboardCompletedBar", "");
        const completedBar = document.getElementById("dashboardCompletedBar");
        if (completedBar) completedBar.style.width = percentage + "%";
        setText("dashboardTotalMachines", allMachines.length);
        setText("dashboardMissingCount", missingMachines.length);
        setText("dashboardLegendDone", completed);
        setText("dashboardLegendMissing", missingMachines.length);
        const missingBar = document.getElementById("dashboardMissingBar");
        if (missingBar) missingBar.style.width = (100 - percentage) + "%";
        const ring = document.getElementById("dashboardCompletionRing");
        if (ring) ring.style.background = "conic-gradient(#26d9a1 0% " + percentage + "%, #f59e0b " + percentage + "% 100%)";

        renderGroup("CYCLE", cycleMachines, submittedToday, "Cycle");
        renderGroup("METAL", metalMachines, submittedToday, "Metal");

        const timeEl = document.getElementById("dashboardDateTime");
        if (timeEl) {
            timeEl.textContent = new Intl.DateTimeFormat("id-ID", {
                weekday: "short", day: "2-digit", month: "long", year: "numeric",
                hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta"
            }).format(new Date()) + " WIB";
        }

        // Data untuk panel perhatian: mesin belum checklist dan item berstatus NG.
        const abnormalRows = [];
        todaySheets.forEach(function(sheet) {
            (sheet.items || []).forEach(function(item) {
                if (!isNG(item)) return;
                abnormalRows.push({
                    type: "abnormal",
                    machine: String(sheet.machine_name || "Mesin tidak diketahui"),
                    group: getMachineGroup(String(sheet.machine_name || "")),
                    condition: String(item.item_check || "Item pemeriksaan") + ": " + String(item.actual_inspec || item.status || "NG"),
                    status: "Abnormal"
                });
            });
        });
        const missingRows = missingMachines.map(name => ({
            type: "missing", machine: name, group: getMachineGroup(name), condition: "ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â", status: "Belum Checksheet"
        }));
        // Belum ada sumber data maintenance terpisah pada API yang digunakan dashboard ini.
        const maintenanceRows = [];
        window.dashboardAttentionData = {
            all: missingRows.concat(abnormalRows, maintenanceRows),
            missing: missingRows,
            abnormal: abnormalRows,
            maintenance: maintenanceRows
        };
        if (!window.dashboardAttentionFilter) window.dashboardAttentionFilter = "all";
        setText("dashboardAttentionAllCount", window.dashboardAttentionData.all.length);
        setText("dashboardAttentionMissingCount", missingRows.length);
        setText("dashboardAttentionAbnormalCount", abnormalRows.length);
        setText("dashboardAttentionMaintenanceCount", maintenanceRows.length);
        renderDashboardAttention();

        // Grafik aktivitas dalam rentang yang dipilih; total dihitung dari checksheet unik.
        const currentParts = today.split("-").map(Number);
        const daily = [];
        for (let offset = rangeDays - 1; offset >= 0; offset--) {
            const date = new Date(Date.UTC(currentParts[0], currentParts[1] - 1, currentParts[2] - offset, 12));
            const key = dateKey(date);
            daily.push({ date: key, count: 0 });
        }
        const countsByDate = {};
        checksheets.forEach(sheet => {
            const key = String(sheet.effective_date || "-").slice(0, 10);
            if (key) countsByDate[key] = (countsByDate[key] || 0) + 1;
        });
        daily.forEach(day => { day.count = countsByDate[day.date] || 0; });

        const bucketSize = rangeDays <= 30 ? 1 : rangeDays <= 90 ? 7 : rangeDays <= 180 ? 14 : 30;
        const buckets = [];
        for (let i = 0; i < daily.length; i += bucketSize) {
            const batch = daily.slice(i, i + bucketSize);
            buckets.push({
                date: batch[batch.length - 1].date,
                count: batch.reduce((sum, day) => sum + day.count, 0)
            });
        }
        const maxCount = Math.max(1, ...buckets.map(bucket => bucket.count));
        const periodTotal = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
        const rangeLabel = rangeDays === 7 ? "7 hari" : rangeDays === 30 ? "30 hari" : rangeDays === 90 ? "3 bulan" : rangeDays === 180 ? "6 bulan" : "1 tahun";
        dailySummary.textContent = "Total " + periodTotal + " checksheet selama " + rangeLabel;
        dailyChart.innerHTML = buckets.map(function(bucket) {
            const height = bucket.count ? Math.max(4, bucket.count / maxCount * 100) : 0;
            let label = bucket.date.slice(8, 10) + "/" + bucket.date.slice(5, 7);
            if (rangeDays > 180) {
                label = new Intl.DateTimeFormat("id-ID", { month: "short", year: "2-digit", timeZone: "Asia/Jakarta" })
                    .format(new Date(bucket.date + "T12:00:00+07:00"));
            }
            return `<div class="dashboard-day-column" title="${escapeDashboardText(bucket.date)}: ${bucket.count} checksheet">
                <div class="dashboard-day-value">${bucket.count}</div>
                <div class="dashboard-day-track"><div class="dashboard-day-fill" style="height:${height}%"></div></div>
                <div class="dashboard-day-label">${escapeDashboardText(label)}</div>
            </div>`;
        }).join("");

        // Tabel sepuluh checksheet paling baru, satu baris per checksheet.
        if (recentTable) {
            const recentSheets = checksheets.slice().sort((a, b) => {
                const ta = Date.parse(a.created_at || a.effective_date || "") || 0;
                const tb = Date.parse(b.created_at || b.effective_date || "") || 0;
                return tb - ta;
            });

            const recentPageSize = 5;
            const recentTotalPages = Math.max(1, Math.ceil(recentSheets.length / recentPageSize));
            const requestedRecentPage = Number.parseInt(window.dashboardRecentPage || "1", 10);
            const recentPage = Math.min(
                Math.max(Number.isFinite(requestedRecentPage) ? requestedRecentPage : 1, 1),
                recentTotalPages
            );
            window.dashboardRecentPage = recentPage;

            const recentStart = (recentPage - 1) * recentPageSize;
            const recentPageRows = recentSheets.slice(recentStart, recentStart + recentPageSize);
            if (!recentSheets.length) {
                recentTable.innerHTML = '<p class="dashboard-empty-state">Belum ada checksheet tersimpan.</p>';
            } else {
                recentTable.innerHTML = `<table class="data-table dashboard-ref-table"><thead><tr>
                    <th>Tanggal</th><th>Jam</th><th>Mesin</th><th>Kelompok</th><th>Operator</th><th>Status</th>
                    </tr></thead><tbody>${recentPageRows.map(sheet => {
                        const machine = String(sheet.machine_name || "Mesin tidak diketahui");
                        const ng = (sheet.items || []).some(isNG);
                        let time = "-";
                        if (sheet.created_at) {
                            const parsed = new Date(sheet.created_at);
                            if (!Number.isNaN(parsed.getTime())) time = new Intl.DateTimeFormat("id-ID", {
                                hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta"
                            }).format(parsed) + " WIB";
                        }
                        return `<tr><td>${escapeDashboardText(String(sheet.effective_date || "-").slice(0, 10))}</td>
                            <td>${escapeDashboardText(time)}</td><td>${escapeDashboardText(machine)}</td>
                            <td>${escapeDashboardText(getMachineGroup(machine))}</td>
                            <td>${escapeDashboardText(sheet.operator_name || "-")}</td>
                            <td><span class="dashboard-status-pill ${ng ? "review" : "done"}">Selesai</span></td></tr>`;
                    }).join("")}</tbody></table>
                    ${recentTotalPages > 1 ? '<div class="dashboard-recent-pagination" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px;padding:12px 4px;border-top:1px solid var(--border,#29445d);"><span style="font-size:12px;color:var(--muted,#94a3b8);">Halaman ' + recentPage + ' dari ' + recentTotalPages + ' | ' + recentSheets.length + ' checksheet</span><div style="display:flex;gap:8px;"><button type="button" id="dashboardRecentPrev" class="secondary-btn" ' + (recentPage <= 1 ? 'disabled' : '') + '>Sebelumnya</button><button type="button" id="dashboardRecentNext" class="secondary-btn" ' + (recentPage >= recentTotalPages ? 'disabled' : '') + '>Berikutnya</button></div></div>' : ''}`;
            }

            const recentPrev = recentTable.querySelector("#dashboardRecentPrev");
            const recentNext = recentTable.querySelector("#dashboardRecentNext");

            if (recentPrev) {
                recentPrev.addEventListener("click", function() {
                    window.dashboardRecentPage = recentPage - 1;
                    loadProductionDashboard();
                });
            }

            if (recentNext) {
                recentNext.addEventListener("click", function() {
                    window.dashboardRecentPage = recentPage + 1;
                    loadProductionDashboard();
                });
            }
        }
    } catch (error) {
        dailySummary.textContent = "Gagal memuat data: " + (error.message || "Kesalahan tidak diketahui.");
        dailyChart.innerHTML = "";
        setText("dashboardCompletedToday", "-");
        setText("dashboardCompletedText", "Data tidak tersedia");
        setText("dashboardMissingCount", "-");
        setText("dashboardCompletionRate", "-%");
        setText("dashboardCycleSummary", "Data gagal dimuat");
        setText("dashboardMetalSummary", "Data gagal dimuat");
        if (recentTable) recentTable.innerHTML = '<p class="dashboard-empty-state">Riwayat checksheet gagal dimuat.</p>';
        if (attentionTable) attentionTable.innerHTML = '<p class="dashboard-empty-state">Data perhatian gagal dimuat.</p>';
    }
}

function renderDashboardAttention() {
    const container = document.getElementById("dashboardAttentionTable");
    if (!container) return;

    const data = window.dashboardAttentionData || { all: [], missing: [], abnormal: [], maintenance: [] };
    const filter = window.dashboardAttentionFilter || "all";
    const records = Array.isArray(data[filter]) ? data[filter] : data.all;

    if (!records.length) {
        const messages = {
            all: "Tidak ada hal yang perlu ditindaklanjuti hari ini.",
            missing: "Semua mesin sudah mengisi checksheet hari ini.",
            abnormal: "Tidak ada item abnormal hari ini.",
            maintenance: "Belum ada data maintenance yang terhubung ke dashboard."
        };
        container.innerHTML = '<p class="dashboard-empty-state">' + escapeDashboardText(messages[filter] || messages.all) + '</p>';
        return;
    }

    container.innerHTML = `<table class="data-table dashboard-ref-table"><thead><tr>
        <th>No</th><th>Mesin</th><th>Kelompok</th><th>Kondisi / Item</th><th>Status</th><th>Tindakan</th>
        </tr></thead><tbody>${records.slice(0, 60).map((row, index) => {
            const statusClass = row.type === "abnormal" ? "abnormal" : row.type === "maintenance" ? "maintenance" : "missing";
            return `<tr><td>${index + 1}</td><td>${escapeDashboardText(row.machine)}</td>
                <td>${escapeDashboardText(row.group)}</td><td>${escapeDashboardText(row.condition)}</td>
                <td><span class="dashboard-status-pill ${statusClass}">${escapeDashboardText(row.status)}</span></td>
                <td><button type="button" class="dashboard-row-action" data-dashboard-open-machine="${escapeDashboardText(row.machine)}">Lihat</button></td></tr>`;
        }).join("")}</tbody></table>`;
}
function escapeDashboardText(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

const dashboardChartsOriginalShowPage = showPage;
showPage = function(page) {
    dashboardChartsOriginalShowPage(page);
    if (page === "dashboard") {
        loadProductionDashboard();
    }
};


// ===== Detail ketika angka grafik Status Mesin diklik =====
function showMachineStopDetails(machineName) {
    const container = document.getElementById("dashboardMachineDetails");
    const rows = window.dashboardProductionRows || [];

    if (!container) return;

    const matches = rows.filter(row =>
        String(row.machine_name || "Legacy / Tidak diketahui") === machineName &&
        String(row.machine_condition || "").toUpperCase() === "STOP"
    );

    container.hidden = false;

    if (!matches.length) {
        container.innerHTML = '<h4>Detail ' + escapeDashboardText(machineName) +
            '</h4><p>Tidak ada data STOP untuk mesin ini.</p>';
        return;
    }

    container.innerHTML = `
        <div class="dashboard-detail-heading">
            <div>
                <h4>Detail STOP: ${escapeDashboardText(machineName)}</h4>
                <p>${matches.length} data pemeriksaan</p>
            </div>
            <button type="button" class="secondary-btn" id="closeMachineDetails">Tutup</button>
        </div>
        <div class="table-wrapper">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Tanggal</th>
                        <th>Mesin</th>
                        <th>Operator</th>
                        <th>Shift</th>
                        <th>Item Pemeriksaan</th>
                        <th>Kondisi</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${matches.map(row => `
                        <tr>
                            <td>${escapeDashboardText(String(row.effective_date || "-").slice(0, 10))}</td>
                            <td>${escapeDashboardText(row.machine_name || "Legacy / Tidak diketahui")}</td>
                            <td>${escapeDashboardText(row.operator_name || "-")}</td>
                            <td>${escapeDashboardText(row.shift || "-")}</td>
                            <td>${escapeDashboardText(row.item_check || "-")}</td>
                            <td>${escapeDashboardText(row.condition || "-")}</td>
                            <td><strong style="color:#ff5263">STOP</strong></td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;

    const closeButton = document.getElementById("closeMachineDetails");
    if (closeButton) {
        closeButton.addEventListener("click", () => {
            container.hidden = true;
            container.innerHTML = "";
        });
    }

    container.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

document.addEventListener("click", function(event) {
    const button = event.target.closest(".dashboard-bar-click");
    if (button) {
        showMachineStopDetails(button.dataset.machine || "");
    }
});





// SANGIL_PRODUCTION_MISSING_CHECKSHEET_NOTIFICATION
(function initMissingChecksheetNotifications() {
    const allowedRoles = ["SUPER_ADMIN", "MANAGER_PRODUCTION"];
    const bell = document.getElementById("notificationBell");
    const count = document.getElementById("notificationCount");
    const panel = document.getElementById("missingChecksheetPanel");
    const message = document.getElementById("missingChecksheetMessage");
    const list = document.getElementById("missingChecksheetList");
    const checkedAt = document.getElementById("missingChecksheetTime");

    if (!bell || !count || !panel || !message || !list || !checkedAt) {
        console.warn("Elemen notifikasi checksheet tidak ditemukan.");
        return;
    }

    function hideNotification() {
        bell.style.display = "none";
        panel.classList.add("hidden");
        count.textContent = "0";
    }

    async function refreshMissingChecksheetNotifications() {
        if (
            window.productionPublicMode ||
            !currentUser ||
            !allowedRoles.includes(currentUser.role)
        ) {
            hideNotification();
            return;
        }

        try {
            const result = await apiRequest("/production/missing-checksheets");

            if (!result) {
                hideNotification();
                return;
            }

            if (!result.active) {
                const checkDate = result.date
                    ? new Date(result.date + "T12:00:00")
                    : new Date();
                const day = checkDate.getDay();

                // Sembunyikan pada Sabtu dan Minggu.
                if (day === 0 || day === 6) {
                    hideNotification();
                    return;
                }

                // Hari kerja sebelum pukul 09.00 WIB.
                bell.style.display = "inline-flex";
                count.textContent = "0";
                message.textContent =
                    "Pemantauan checksheet dimulai pukul 09.00 WIB.";
                checkedAt.textContent =
                    "Tanggal: " + result.date +
                    " | Status: menunggu waktu pemantauan";

                list.replaceChildren();
                const item = document.createElement("li");
                item.textContent =
                    "Daftar mesin yang belum mengisi akan diperiksa mulai pukul 09.00 WIB.";
                list.appendChild(item);
                panel.classList.remove("hidden");
                return;
            }

            bell.style.display = "inline-flex";
            count.textContent = String(result.missing_count || 0);
            message.textContent = result.message || "Status checksheet hari ini.";
            checkedAt.textContent =
                "Tanggal: " + result.date +
                " | Pemeriksaan terakhir: " + result.checked_at + " WIB";

            list.replaceChildren();

            const missingMachines = Array.isArray(result.missing_machines)
                ? result.missing_machines
                : [];

            const cycleMachines = [
                "Soldering",
                "Cutting Pipe Condenser",
                "Cutting Pipe Hotline",
                "Cutting Copper Tube",
                "Cutting & Notching",
                "Bending Auto Condensor Pipe"
            ];

            const metalMachines = [
                "300T-01", "300T-02", "400T-01", "400T-02",
                "400T-03", "400T-04",
                "250T-A01", "250T-A02", "250T-A03",
                "250T-A04", "250T-A05", "250T-A06",
                "250T-B01", "250T-B02", "250T-B03", "250T-B04",
                "250T-C01", "80T-01",
                "Spot Welding Siku Reinforce",
                "Spot Welding Hinge Part",
                "Spot Welding Nut Reinforce",
                "Spot Welding Reinforce R",
                "Spot Welding Reinforce L",
                "Spot Nut Hinge Upper",
                "Spot Nut Hinge Center",
                "45T-01", "40T-01", "45T-02", "Spot Welding Base Compresor"
            ];

            const cycleMissing = cycleMachines.filter(machine =>
                missingMachines.includes(machine)
            );
            const metalMissing = metalMachines.filter(machine =>
                missingMachines.includes(machine)
            );

            const cycleList = document.getElementById("cycleMissingList");
            const metalList = document.getElementById("metalMissingList");
            const cycleCount = document.getElementById("cycleMissingCount");
            const metalCount = document.getElementById("metalMissingCount");

            function renderMachineList(target, machines, categoryName) {
                if (!target) return;
                target.replaceChildren();

                if (machines.length === 0) {
                    const item = document.createElement("li");
                    item.className = "notification-ok";
                    item.textContent = "Semua mesin " + categoryName +
                        " sudah mengisi checksheet hari ini.";
                    target.appendChild(item);
                    return;
                }

                machines.forEach(function(machine) {
                    const item = document.createElement("li");
                    item.style.marginBottom = "6px";
                    item.textContent = machine + " ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â belum mengisi checksheet";
                    target.appendChild(item);
                });
            }

            if (cycleCount) {
                cycleCount.textContent = cycleMissing.length + " belum mengisi";
            }
            if (metalCount) {
                metalCount.textContent = metalMissing.length + " belum mengisi";
            }

            renderMachineList(cycleList, cycleMissing, "CYCLE");
            renderMachineList(metalList, metalMissing, "METAL");

            // Daftar lama tidak dipakai lagi untuk tampilan aktif.
            list.replaceChildren();
            list.hidden = true;
            panel.classList.remove("hidden");
        } catch (error) {
            console.warn("Gagal memperbarui notifikasi checksheet:", error);
        }
    }

    bell.addEventListener("click", function() {
        const shouldOpen = !panel.classList.contains("notification-panel-open");
        if (typeof showPage === "function") showPage("dashboard");
        if (shouldOpen) {
            panel.classList.add("notification-panel-open");
            panel.classList.remove("hidden");
            refreshMissingChecksheetNotifications();
        } else {
            panel.classList.remove("notification-panel-open");
            panel.classList.add("hidden");
        }
    });

    // Periksa lagi ketika Dashboard dibuka.
    const originalShowPage = showPage;
    showPage = function(page) {
        originalShowPage(page);
        if (page === "dashboard") {
            refreshMissingChecksheetNotifications();
        }
    };

    // Tunggu proses login selesai; periksa ulang setiap 30 detik.
    refreshMissingChecksheetNotifications();
    setInterval(refreshMissingChecksheetNotifications, 30000);
})();
// END SANGIL_PRODUCTION_MISSING_CHECKSHEET_NOTIFICATION
















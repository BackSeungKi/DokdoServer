// ==========================================
// 📌 1. 전역 상태 및 초기화 설정 (파이어베이스 제거 버전)
// ==========================================

// 현재 로그인한 사용자 정보 저장 변수
let currentUser = null;

// 앱 전체에서 사용하는 데이터 상태 (members.js의 clanData를 기본값으로 연동)
let state = window.clanData || {
    members: [],
    notices: [],
    attendance: {},
    accounts: {},
    attendanceConfigs: {}
};

// 비밀번호 암호화를 위한 SHA-256 비동기 함수
async function sha256(str) {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 📌 메인 관리자 계정 보장 함수
function ensureMainAdminExists() {
    state = state || {};
    state.accounts = state.accounts || {};
    state.members = state.members || [];

    state.accounts["seungki"] = state.accounts["seungki"] || {
        role: "메인 관리자",
        class: "블러드스테인",
        cp: 999999
    };

    if (!state.members.some(m => m.username === "seungki")) {
        state.members.unshift({
            username: "seungki",
            class: "블러드스테인",
            cp: 999999,
            role: "메인 관리자"
        });
    }
}

// 📌 페이지 로드 시 로컬 데이터 병합 및 초기화
window.addEventListener('DOMContentLoaded', () => {
    // 1. 로컬스토리지에 저장된 데이터가 있다면 병합
    const localData = localStorage.getItem("dokdo_state");
    if (localData) {
        try {
            const parsed = JSON.parse(localData);
            state = { ...state, ...parsed };
        } catch (e) {
            console.error("로컬 데이터 로드 실패", e);
        }
    }

    ensureMainAdminExists();
    renderApp();

    // ⏱️ 1초마다 남은 출석 카운트다운 타이머 UI 실시간 갱신
    setInterval(() => {
        if (currentUser) renderAttendance();
    }, 1000);
});

// 상태 데이터를 브라우저 로컬 스토리지에 저장하는 함수
function saveStateToLocalStorage() {
    localStorage.setItem("dokdo_state", JSON.stringify(state));
}


// ==========================================
// 📌 2. 인증(로그인 / 회원가입) 처리 로직
// ==========================================

function switchAuthTab(tab) {
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('signupForm').classList.toggle('hidden', tab !== 'signup');
    
    document.getElementById('loginTabBtn').className = tab === 'login' 
        ? 'flex-1 py-2 font-bold text-cyanAccent border-b-2 border-cyanAccent' 
        : 'flex-1 py-2 font-bold text-gray-400 border-b-2 border-transparent hover:text-white';
        
    document.getElementById('signupTabBtn').className = tab === 'signup' 
        ? 'flex-1 py-2 font-bold text-gold border-b-2 border-gold' 
        : 'flex-1 py-2 font-bold text-gray-400 border-b-2 border-transparent hover:text-white';
}

async function handleSignup() {
    const id = document.getElementById('signupId').value.trim();
    const pw = document.getElementById('signupPw').value.trim();
    const cls = document.getElementById('signupClass').value;

    if (!id || !pw) return alert("아이디와 비밀번호를 입력해주세요.");
    if (id === "seungki") return alert("해당 아이디는 예약된 메인 관리자 계정입니다.");
    if (state.accounts && state.accounts[id]) return alert("이미 존재하는 아이디입니다.");

    const pwHash = await sha256(pw);
    const defaultRole = '일반';

    state.accounts = state.accounts || {};
    state.accounts[id] = { passwordHash: pwHash, role: defaultRole, class: cls };

    state.members = state.members || [];
    if (!state.members.some(m => m.username === id)) {
        state.members.push({ username: id, class: cls, role: defaultRole });
    }

    saveStateToLocalStorage();
    alert("회원가입이 완료되었습니다!");
    currentUser = { username: id, role: defaultRole };
    renderApp();
}

window.handleSignup = handleSignup;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.switchAuthTab = switchAuthTab;

async function handleLogin() {
    const id = document.getElementById('loginId').value.trim();
    const pw = document.getElementById('loginPw').value.trim();

    if (!id || !pw) return alert("아이디와 비밀번호를 모두 입력해 주세요.");

    if (id === "seungki" && pw === "bski090805!") {
        currentUser = { username: "seungki", role: "메인 관리자" };
        renderApp();
        return;
    }

    const inputHash = await sha256(pw);

    if (state.accounts && state.accounts[id]) {
        const account = state.accounts[id];
        if (account.passwordHash === inputHash) {
            currentUser = { username: id, role: account.role || '일반' };
            renderApp();
            return;
        }
    }
    alert("아이디 또는 비밀번호가 올바르지 않습니다.");
}

function handleLogout() {
    currentUser = null;
    renderApp();
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
}


// ==========================================
// 📌 3. 출석 체크 시스템
// ==========================================

function toggleSingleOpen(key, isOpen) {
    if (!currentUser || !['메인 관리자', '마스터', '부마스터'].includes(currentUser.role)) {
        return alert("1~3순위 권한(메인 관리자, 마스터, 부마스터)을 가진 계정만 출석을 관리할 수 있습니다.");
    }

    const pwInput = document.getElementById(`pw-${key}`) ? document.getElementById(`pw-${key}`).value.trim() : "";
    state.attendanceConfigs = state.attendanceConfigs || {};

    if (isOpen) {
        const isMainAdmin = (currentUser.username === 'seungki');
        if (!isMainAdmin && !pwInput) {
            return alert("해당 항목을 오픈하려면 비밀번호를 입력해야 합니다.");
        }

        const expireTime = Date.now() + (10 * 60 * 1000);

        state.attendanceConfigs[key] = { 
            isOpen: true, 
            password: pwInput,
            expireAt: expireTime 
        };
        alert(`[${key}] 항목이 오픈되었습니다! (지금부터 10분간 출석 가능)`);
    } else {
        state.attendanceConfigs[key] = { isOpen: false, password: "", expireAt: null };
        alert(`[${key}] 항목이 마감(잠금)되었습니다.`);
    }

    saveStateToLocalStorage();
    renderAttendance();
}

function toggleAttendance(key) {
    if (!currentUser) return;

    const configs = state.attendanceConfigs || {};
    const config = configs[key] || { isOpen: false };

    if (!config.isOpen) {
        return alert("이 출석 항목은 아직 관리자에 의해 오픈되지 않았습니다!");
    }

    if (config.expireAt && Date.now() > config.expireAt) {
        config.isOpen = false;
        saveStateToLocalStorage();
        renderAttendance();
        return alert("출석 가능 시간(10분)이 지나 마감되었습니다!");
    }

    const username = currentUser.username;
    state.attendance = state.attendance || {};
    state.attendance[username] = state.attendance[username] || {};

    state.attendance[username][key] = !state.attendance[username][key];

    saveStateToLocalStorage();
    renderAttendance();
}

function renderAttendance() {
    if (!currentUser) return;

    const canManage = ['메인 관리자', '마스터', '부마스터'].includes(currentUser.role);
    
    document.querySelectorAll('.admin-control-box').forEach(el => {
        el.classList.toggle('hidden', !canManage);
    });

    const username = currentUser.username;
    const userAttendance = (state.attendance && state.attendance[username]) || {};
    const configs = state.attendanceConfigs || {};

    const keys = [
        'gehena_13_3rd', 'gehena_13_end', 
        'gehena_21_3rd', 'gehena_21_end', 
        'saturday_enoch', 'saturday_mashumid', 
        'pvp_taengtal', 'pvp_jeomryeong', 'pvp_vcc', 
        'clan_mission', 'clan_guardian'
    ];

    keys.forEach(key => {
        const btn = document.getElementById(`btn-${key}`);
        const status = document.getElementById(`status-${key}`);
        if (!btn || !status) return;

        const config = configs[key] || { isOpen: false };
        const isChecked = userAttendance[key];

        if (config.isOpen && config.expireAt && Date.now() > config.expireAt) {
            config.isOpen = false;
            saveStateToLocalStorage();
        }

        if (!config.isOpen) {
            btn.className = "w-full py-3 px-4 rounded text-sm font-bold bg-gray-900/50 text-gray-500 border border-gray-800 cursor-not-allowed flex justify-between items-center";
            status.innerText = "🔒 잠김";
        } else {
            const remainingSec = Math.max(0, Math.floor((config.expireAt - Date.now()) / 1000));
            const min = Math.floor(remainingSec / 60);
            const sec = remainingSec % 60;
            const timerStr = `⏱️ ${min}분 ${sec < 10 ? '0' : ''}${sec}초 남음`;

            if (isChecked) {
                btn.className = "w-full py-3 px-4 rounded text-sm font-bold bg-blue-600 text-white shadow transition flex justify-between items-center cursor-pointer";
                status.innerText = `완료됨 ✔️ (${timerStr})`;
            } else {
                btn.className = "w-full py-3 px-4 rounded text-sm font-bold bg-gray-800 text-gray-300 hover:bg-gray-700 transition flex justify-between items-center cursor-pointer";
                status.innerText = timerStr;
            }
        }
    });
}


// ==========================================
// 📌 4. 클랜원 관리 및 공지사항 기능
// ==========================================

function changeMemberRole(username, newRole) {
    if (username === 'seungki' && newRole !== '메인 관리자') {
        return alert("메인 관리자(seungki)의 등급은 변경할 수 없습니다.");
    }

    if (newRole === '마스터') {
        const existingMaster = state.members.find(m => m.role === '마스터' && m.username !== username);
        if (existingMaster) {
            return alert(`이미 마스터가 존재합니다 (${existingMaster.username}님). 마스터는 단 1명만 지정할 수 있습니다.`);
        }
    }

    if (newRole === '부마스터') {
        const subMasters = state.members.filter(m => m.role === '부마스터' && m.username !== username);
        if (subMasters.length >= 2) {
            return alert("부마스터는 최대 2명 까지만 지정할 수 있습니다.");
        }
    }

    const targetMember = state.members.find(m => m.username === username);
    if (targetMember) targetMember.role = newRole;

    if (state.accounts && state.accounts[username]) {
        state.accounts[username].role = newRole;
    }

    saveStateToLocalStorage();
    alert(`${username} 님의 등급이 [${newRole}] (으)로 변경되었습니다.`);
}

function deleteMember(username) {
    if (!currentUser || currentUser.role !== '메인 관리자') return alert("메인 관리자만 클랜원을 삭제할 수 있습니다.");
    if (username === 'seungki') return alert("메인 관리자 계정은 삭제할 수 없습니다.");
    
    if (!confirm(`${username} 님을 명단에서 삭제하시겠습니까?`)) return;
    state.members = state.members.filter(m => m.username !== username);
    delete state.accounts[username];
    saveStateToLocalStorage();
}

function addNotice() {
    const title = document.getElementById('noticeTitleInput').value.trim();
    const content = document.getElementById('noticeContentInput').value.trim();
    if (!title) return alert("공지 제목을 입력해 주세요.");

    state.notices = state.notices || [];
    state.notices.unshift({ id: Date.now(), title, content });
    saveStateToLocalStorage();

    document.getElementById('noticeTitleInput').value = '';
    document.getElementById('noticeContentInput').value = '';
}

function deleteNotice(id) {
    if (!currentUser || (currentUser.role !== '메인 관리자' && currentUser.role !== '마스터')) {
        return alert("관리자 또는 마스터만 공지를 삭제할 수 있습니다.");
    }

    if (!confirm("이 공지를 삭제하시겠습니까?")) return;
    state.notices = state.notices.filter(n => n.id !== id);
    saveStateToLocalStorage();
}


// ==========================================
// 📌 5. 전체 화면 렌더링
// ==========================================

function renderApp() {
    if (!currentUser) {
        document.getElementById('authModal

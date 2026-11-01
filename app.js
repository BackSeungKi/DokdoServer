// ==========================================
// 📌 1. 전역 상태 및 초기화 설정
// ==========================================

let currentUser = null;

let state = window.clanData || {
    members: [],
    notices: [],
    attendance: {},
    accounts: {},
    attendanceConfigs: {}
};

async function sha256(str) {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

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

// 📌 페이지 로드 시 파이어베이스 익명 로 그인 및 실시간 동기화(onSnapshot) 연동
window.addEventListener('DOMContentLoaded', () => {
    const localData = localStorage.getItem("dokdo_state");
    if (localData) {
        try {
            const parsed = JSON.parse(localData);
            state = { ...state, ...parsed };
        } catch (e) {
            console.error("로컬 데이터 로드 실패", e);
        }
    }

    if (window.signInAnonymously && window.auth) {
        window.signInAnonymously(window.auth).then(() => {
            if (window.onSnapshot && window.dbDocRef) {
                window.onSnapshot(window.dbDocRef, (snapshot) => {
                    if (snapshot.exists()) {
                        state = { ...state, ...snapshot.data() };
                        ensureMainAdminExists();
                        renderApp();
                    } else {
                        ensureMainAdminExists();
                        saveStateToFirestore();
                    }
                });
            } else {
                ensureMainAdminExists();
                renderApp();
            }
        }).catch((err) => {
            console.error("파이어베이스 인증 에러:", err);
            ensureMainAdminExists();
            renderApp();
        });
    } else {
        ensureMainAdminExists();
        renderApp();
    }

    setInterval(() => {
        if (currentUser) renderAttendance();
    }, 1000);
});

function saveStateToFirestore() {
    if (window.setDoc && window.dbDocRef) {
        window.setDoc(window.dbDocRef, state).catch(() => {
            localStorage.setItem("dokdo_state", JSON.stringify(state));
        });
    } else {
        localStorage.setItem("dokdo_state", JSON.stringify(state));
    }
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

    saveStateToFirestore();
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

    saveStateToFirestore();
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
        saveStateToFirestore();
        renderAttendance();
        return alert("출석 가능 시간(10분)이 지나 마감되었습니다!");
    }

    const username = currentUser.username;
    state.attendance = state.attendance || {};
    state.attendance[username] = state.attendance[username] || {};

    state.attendance[username][key] = !state.attendance[username][key];

    saveStateToFirestore();
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
            saveStateToFirestore();
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

// 📌 오픈/잠금 버튼과 출석 버튼이 나란히 배치되는 렌더링 예시
function renderControlPanel() {
    const isClanOpen = state.isClanOpen; // 현재 클랜 오픈 상태 여부

    return `
        <div class="flex items-center space-x-2 bg-darkCard p-3 rounded-xl border border-gray-800">
            <!-- 1. 기존 클랜 오픈/잠금 버튼 (관리자용) -->
            ${['메인 관리자', '마스터', '부마스터'].includes(currentUser?.role) ? `
                <button onclick="toggleClanOpenState()" class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    isClanOpen 
                        ? 'bg-red-900/30 border-red-600 text-red-400 hover:bg-red-900/50' 
                        : 'bg-green-900/30 border-green-600 text-green-400 hover:bg-green-900/50'
                }">
                    ${isClanOpen ? '🔓 클랜 오픈중 (잠그기)' : '🔒 클랜 잠금중 (열기)'}
                </button>
            ` : ''}

            <!-- 2. 오픈/잠금 버튼 바로 옆에 나란히 배치된 '출석하기' 버튼 -->
            <button onclick="handleAttendanceClick()" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyanAccent/20 border border-cyanAccent text-cyanAccent hover:bg-cyanAccent hover:text-darkBg transition flex items-center space-x-1">
                <span>📅 출석하기</span>
            </button>
        </div>
    `;
}

// 📌 출석 체크 버튼을 눌렀을 때 실행되는 함수
function handleAttendanceClick() {
if (!currentUser) {
        return alert("로그인 후 이용해주세요.");
    }

    // 클랜 비밀번호가 설정되어 있는 경우
    if (state.clanPassword && state.clanPassword.trim() !== "") {
        const isManager = ['메인 관리자', '마스터', '부마스터'].includes(currentUser.role);
        
        // 관리자가 아닐 경우(또는 모두 검증하고 싶다면 조건 수정 가능) 비밀번호 요구
        if (!isManager) {
            const inputPw = prompt("클랜 출석 비밀번호를 입력해주세요:");
            if (inputPw === null) return; // 취소 버튼 누른 경우
            
            if (inputPw !== state.clanPassword) {
                return alert("비밀번호가 일치하지 않습니다!");
            }
        }
    }

    // 오늘 날짜 기준 출석 처리
    const today = new Date().toISOString().split('T')[0];
    if (!state.attendance) state.attendance = {};
    if (!state.attendance[today]) state.attendance[today] = [];

    if (state.attendance[today].includes(currentUser.username)) {
        return alert("이미 오늘 출석체크를 완료하셨습니다!");
    }

    state.attendance[today].push(currentUser.username);
    
    // 파이어베이스(Firestore) 저장 및 화면 갱신
    saveStateToFirestore();
    renderApp();
    alert("출석체크가 완료되었습니다!");
}

// 전역 함수 등록
window.handleAttendanceClick = handleAttendanceClick;
window.renderControlPanel = renderControlPanel;

// 📌 실제 출석 데이터 처리 및 파이어베이스 저장 함수
function processAttendance() {
    const today = new Date().toISOString().split('T')[0]; // 오늘 날짜 (YYYY-MM-DD)
    
    if (!state.attendance) state.attendance = {};
    if (!state.attendance[today]) state.attendance[today] = [];

    // 이미 출석했는지 확인
    if (state.attendance[today].includes(currentUser.username)) {
        return alert("이미 오늘 출석체크를 완료하셨습니다!");
    }

    // 출석 명단에 추가
    state.attendance[today].push(currentUser.username);

    // 파이어베이스에 저장 및 화면 갱신
    saveStateToFirestore();
    renderApp();
    alert("출석체크가 완료되었습니다!");
}

window.handleAttendanceClick = handleAttendanceClick;


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

    saveStateToFirestore();
    alert(`${username} 님의 등급이 [${newRole}] (으)로 변경되었습니다.`);
}

function deleteMember(username) {
    if (!currentUser || currentUser.role !== '메인 관리자') return alert("메인 관리자만 클랜원을 삭제할 수 있습니다.");
    if (username === 'seungki') return alert("메인 관리자 계정은 삭제할 수 없습니다.");
    
    if (!confirm(`${username} 님을 명단에서 삭제하시겠습니까?`)) return;
    state.members = state.members.filter(m => m.username !== username);
    delete state.accounts[username];
    saveStateToFirestore();
}

function addNotice() {
    const title = document.getElementById('noticeTitleInput').value.trim();
    const content = document.getElementById('noticeContentInput').value.trim();
    if (!title) return alert("공지 제목을 입력해 주세요.");

    state.notices = state.notices || [];
    state.notices.unshift({ id: Date.now(), title, content });
    saveStateToFirestore();

    document.getElementById('noticeTitleInput').value = '';
    document.getElementById('noticeContentInput').value = '';
}

function deleteNotice(id) {
    if (!currentUser || (currentUser.role !== '메인 관리자' && currentUser.role !== '마스터')) {
        return alert("관리자 또는 마스터만 공지를 삭제할 수 있습니다.");
    }

    if (!confirm("이 공지를 삭제하시겠습니까?")) return;
    state.notices = state.notices.filter(n => n.id !== id);
    saveStateToFirestore();
}


// ==========================================
// 📌 5. 전체 화면 렌더링
// ==========================================

function renderApp() {
    if (!currentUser) {
        document.getElementById('authModal').classList.remove('hidden');
        document.getElementById('mainApp').classList.add('hidden');
        return;
    }

    document.getElementById('authModal').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');

    const isMainAdmin = (currentUser.role === '메인 관리자');
    const canManage = ['메인 관리자', '마스터', '부마스터'].includes(currentUser.role);

    document.getElementById('userDisplayName').innerText = currentUser.username;
    document.getElementById('userDisplayRole').innerText = currentUser.role;

    document.querySelectorAll('.admin-col').forEach(el => el.classList.toggle('hidden', !canManage));
    document.getElementById('adminNoticeForm').classList.toggle('hidden', !canManage);

    renderAttendance();

    const members = state.members || [];
    document.getElementById('dashTotalMembers').innerText = `${members.length} 명`;
    
    const totalCp = members.reduce((acc, cur) => acc + (cur.cp || 0), 0);
    document.getElementById('dashTotalCp').innerText = totalCp.toLocaleString();
    document.getElementById('dashAvgCp').innerText = members.length ? Math.round(totalCp / members.length).toLocaleString() : 0;

    const tableBody = document.getElementById('memberTableBody');
    tableBody.innerHTML = members.map(m => {
        let badgeColor = 'bg-gray-800 text-gray-300 border-gray-700';
        if (m.role === '메인 관리자') badgeColor = 'bg-red-900/50 text-red-400 border-red-600';
        else if (m.role === '마스터') badgeColor = 'bg-amber-900/50 text-gold border-amber-600';
        else if (m.role === '부마스터') badgeColor = 'bg-blue-900/50 text-cyanAccent border-blue-600';
        else if (m.role === '정예') badgeColor = 'bg-purple-900/50 text-purple-300 border-purple-600';

        return `
            <tr class="hover:bg-gray-800/50">
                <td class="p-3 font-bold text-white">${m.username}</td>
                <td class="p-3">${m.class}</td>
                <td class="p-3 font-mono text-gold">
                    ${canManage && m.username !== 'seungki' ? `
                        <input type="number" value="${m.cp || 0}" onchange="updateMemberCp('${m.username}', this.value)" class="w-28 bg-darkBg border border-gray-700 rounded p-1 text-xs text-gold outline-none focus:border-cyanAccent">
                    ` : `<span>${(m.cp || 0).toLocaleString()}</span>`}
                </td>
                <td class="p-3 text-xs">
                    <span class="${badgeColor} px-2 py-1 rounded border font-semibold">${m.role}</span>
                </td>
                ${canManage ? `
                    <td class="p-3 text-right space-x-2">
                        ${m.username !== 'seungki' ? `
                            <select onchange="changeMemberRole('${m.username}', this.value)" class="text-xs border border-gray-700 rounded p-1 outline-none">
                                <option value="" disabled selected>등급 변경</option>
                                <option value="마스터">마스터 (1명)</option>
                                <option value="부마스터">부마스터 (최대 2명)</option>
                                <option value="정예">정예</option>
                                <option value="일반">일반</option>
                            </select>
                            ${isMainAdmin ? `<button onclick="deleteMember('${m.username}')" class="text-xs text-red-400 hover:text-red-300 ml-1">삭제</button>` : ''}
                        ` : `<span class="text-xs text-gray-500">최고 관리자</span>`}
                    </td>
                ` : ''}
            </tr>
        `;
    }).join('');

    const notices = state.notices || [];
    const dashNoticeContainer = document.getElementById('dashNoticeContainer');
    if (notices.length > 0) {
        dashNoticeContainer.innerHTML = notices.slice(0, 3).map(n => `
            <div class="border-b border-gray-800 pb-2">
                <div class="font-bold text-cyanAccent">${n.title}</div>
                <div class="text-xs text-gray-400 mt-0.5">${n.content}</div>
            </div>
        `).join('');
    } else {
        dashNoticeContainer.innerHTML = `<p class="text-gray-500">등록된 공지사항이 없습니다.</p>`;
    }

    const noticeList = document.getElementById('noticeList');
    noticeList.innerHTML = notices.map(n => `
        <div class="border-b border-gray-800 pb-3 flex justify-between items-start">
            <div>
                <h4 class="font-bold text-white">${n.title}</h4>
                <p class="text-sm text-gray-400 mt-1">${n.content}</p>
            </div>
            ${canManage ? `<button onclick="deleteNotice(${n.id})" class="text-xs text-red-400 hover:text-red-300 ml-4">삭제</button>` : ''}
        </div>
    `).join('');

    lucide.createIcons();
}

function calculateDia() {
    const totalDia = parseInt(document.getElementById('totalDiaInput').value) || 0;
    const members = state.members || [];
    
    if (!members.length) return;
    const perMember = Math.floor(totalDia / members.length);

    document.getElementById('diaResultTable').innerHTML = `
        <table class="w-full text-left text-sm text-gray-300 mt-4">
            <thead class="bg-gray-900 text-gray-400 uppercase text-xs">
                <tr><th class="p-2">닉네임</th><th class="p-2">분배 수량</th></tr>
            </thead>
            <tbody class="divide-y divide-gray-800">
                ${members.map(m => `
                    <tr><td class="p-2">${m.username}</td><td class="p-2 font-bold text-cyanAccent">${perMember.toLocaleString()} 💎</td></tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// 📌 관리자(1~3순위)가 클원 전투력 수정 시 호출되는 함수
function updateMemberCp(username, newCp) {
    if (!currentUser || !['메인 관리자', '마스터', '부마스터'].includes(currentUser.role)) {
        return alert("관리자 권한이 없습니다.");
    }

    const targetMember = state.members.find(m => m.username === username);
    if (targetMember) {
        targetMember.cp = parseInt(newCp) || 0;
        
        // 계정 정보(accounts)에도 전투력이 있다면 함께 동기화
        if (state.accounts && state.accounts[username]) {
            state.accounts[username].cp = targetMember.cp;
        }

        // 파이어베이스(Firestore)에 즉시 저장 및 실시간 동기화 트리거
        saveStateToFirestore();
        renderApp();
    }
}

// HTML 등 외부에서 호출할 수 있도록 전역 등록
window.updateMemberCp = updateMemberCp;

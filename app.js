// ==========================================
// 📌 1. 전역 상태 및 초기화 설정
// ==========================================

// 현재 로그인한 사용자 정보 저장 변수
let currentUser = null;

// 앱 전체에서 사용하는 데이터 상태 (members.js의 clanData를 기본값으로 연동)
let state = window.clanData || {
    members: [],
    notices: [],
    attendance: {},
    accounts: {}
};

// 비밀번호 암호화를 위한 SHA-256 비동기 함수
async function sha256(str) {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 메인 관리자(seungki) 계정 및 권한이 누락되지 않도록 강제로 보장하는 함수
function ensureMainAdminExists() {
    state.accounts = state.accounts || {};
    state.members = state.members || [];

    state.accounts["seungki"] = {
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

// 웹페이지가 처음 로드될 때 실행 (파이어베이스 실시간 데이터 동기화 또는 로컬 스토리지 연동)
window.addEventListener('DOMContentLoaded', () => {
    if (window.signInAnonymously && window.auth) {
        window.signInAnonymously(window.auth).then(() => {
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
        }).catch(() => {
            const localData = localStorage.getItem("dokdo_state");
            if (localData) state = JSON.parse(localData);
            ensureMainAdminExists();
            renderApp();
        });
    }
});

// 현재 상태 데이터를 파이어베이스(또는 브라우저 로컬 스토리지)에 저장하는 함수
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

// 로그인 및 회원가입 화면 탭 전환 함수
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

// 신규 회원가입 처리 함수 (비밀번호 해시화 및 명단 추가)
async function handleSignup() {
    const id = document.getElementById('signupId').value.trim();
    const pw = document.getElementById('signupPw').value.trim();
    const cls = document.getElementById('signupClass').value;
    const cp = parseInt(document.getElementById('signupCp').value) || 0;

    if (!id || !pw) return alert("아이디와 비밀번호를 입력해주세요.");
    if (id === "seungki") return alert("해당 아이디는 예약된 메인 관리자 계정입니다.");
    if (state.accounts && state.accounts[id]) return alert("이미 존재하는 아이디입니다.");

    const pwHash = await sha256(pw);
    const defaultRole = '일반';

    state.accounts = state.accounts || {};
    state.accounts[id] = { passwordHash: pwHash, role: defaultRole, class: cls, cp: cp };

    state.members = state.members || [];
    if (!state.members.some(m => m.username === id)) {
        state.members.push({ username: id, class: cls, cp: cp, role: defaultRole });
    }

    saveStateToFirestore();
    alert("회원가입이 완료되었습니다!");
    currentUser = { username: id, role: defaultRole };
    renderApp();
}

// 로그인 처리 함수 (메인 관리자 예외 처리 및 일반 유저 해시 검증)
async function handleLogin() {
    const id = document.getElementById('loginId').value.trim();
    const pw = document.getElementById('loginPw').value.trim();

    if (!id || !pw) return alert("아이디와 비밀번호를 모두 입력해 주세요.");

    // 메인 관리자(seungki) 계정 다이렉트 로그인 예외 처리
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

// 로그아웃 처리 함수
function handleLogout() {
    currentUser = null;
    renderApp();
}

// 대시보드 메인 메뉴 탭 전환 함수
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
}


// ==========================================
// 📌 3. 출석 체크 및 권한 제어 시스템
// ==========================================

// 1~3순위 관리자가 출석 체크를 오픈(활성화) 또는 마감하는 함수
function toggleAttendanceStatus(isOpen) {
    if (!currentUser || !['메인 관리자', '마스터', '부마스터'].includes(currentUser.role)) {
        return alert("1~3순위 권한(메인 관리자, 마스터, 부마스터)을 가진 계정만 출석을 관리할 수 있습니다.");
    }

    const pwInput = document.getElementById('attendanceOpenPw').value.trim();

    if (isOpen) {
        if (!pwInput) return alert("출석을 활성화하려면 비밀번호를 입력해야 합니다.");
        state.attendanceConfig = {
            isOpen: true,
            password: pwInput
        };
        alert("오늘의 출석 체크가 정상적으로 활성화(오픈) 되었습니다!");
    } else {
        state.attendanceConfig = {
            isOpen: false,
            password: ""
        };
        alert("오늘의 출석 체크가 마감(잠금) 되었습니다.");
    }

    saveStateToFirestore();
    renderAttendance();
}

// 각 콘텐츠별 출석 버튼 클릭 시 완료/미완료 상태를 토글하는 함수 (출석 잠김 여부 검사)
function toggleAttendance(key) {
    if (!currentUser) return;

    const config = state.attendanceConfig || { isOpen: false };
    if (!config.isOpen) {
        return alert("현재 출석 체크가 활성화되지 않았습니다. 관리자(1~3순위)의 출석 오픈을 기다려주세요!");
    }

    const username = currentUser.username;
    state.attendance = state.attendance || {};
    state.attendance[username] = state.attendance[username] || {};

    state.attendance[username][key] = !state.attendance[username][key];

    saveStateToFirestore();
    renderAttendance();
}

// 출석 체크 화면의 UI 상태(잠김/진행중, 버튼 색상, 관리자 패널 표시 여부)를 갱신하는 함수
function renderAttendance() {
    if (!currentUser) return;

    const canManage = ['메인 관리자', '마스터', '부마스터'].includes(currentUser.role);
    const adminControl = document.getElementById('attendanceAdminControl');
    if (adminControl) {
        adminControl.classList.toggle('hidden', !canManage);
    }

    const config = state.attendanceConfig || { isOpen: false };
    const badge = document.getElementById('attendanceStatusBadge');
    
    if (badge) {
        if (config.isOpen) {
            badge.className = "text-xs bg-emerald-900/50 text-emerald-400 border border-emerald-600 px-3 py-1 rounded-full font-bold";
            badge.innerText = "🔓 출석 진행 중";
        } else {
            badge.className = "text-xs bg-red-900/50 text-red-400 border border-red-600 px-3 py-1 rounded-full font-bold";
            badge.innerText = "🔒 출석 마감/잠김";
        }
    }

    const username = currentUser.username;
    const userAttendance = (state.attendance && state.attendance[username]) || {};

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

        const isChecked = userAttendance[key];

        if (!config.isOpen) {
            btn.className = "w-full py-3 px-4 rounded text-sm font-bold bg-gray-900/50 text-gray-500 border border-gray-800 cursor-not-allowed flex justify-between items-center";
            status.innerText = "🔒 잠김";
        } else {
            if (isChecked) {
                btn.className = "w-full py-3 px-4 rounded text-sm font-bold bg-blue-600 text-white shadow transition flex justify-between items-center cursor-pointer";
                status.innerText = "완료됨 ✔️";
            } else {
                btn.className = "w-full py-3 px-4 rounded text-sm font-bold bg-gray-800 text-gray-300 hover:bg-gray-700 transition flex justify-between items-center cursor-pointer";
                status.innerText = "미완료";
            }
        }
    });
}


// ==========================================
// 📌 4. 클랜원 관리 및 공지사항 기능
// ==========================================

// 클랜원의 등급(역할)을 변경하는 함수 (마스터 1명, 부마스터 최대 2명 제한 검사 포함)
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

// 클랜원을 명단에서 삭제하는 함수 (메인 관리자 전용)
function deleteMember(username) {
    if (!currentUser || currentUser.role !== '메인 관리자') return alert("메인 관리자만 클랜원을 삭제할 수 있습니다.");
    if (username === 'seungki') return alert("메인 관리자 계정은 삭제할 수 없습니다.");
    
    if (!confirm(`${username} 님을 명단에서 삭제하시겠습니까?`)) return;
    state.members = state.members.filter(m => m.username !== username);
    delete state.accounts[username];
    saveStateToFirestore();
}

// 새로운 공지사항을 등록하는 함수
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

// 등록된 공지사항을 삭제하는 함수
function deleteNotice(id) {
    if (!currentUser || (currentUser.role !== '메인 관리자' && currentUser.role !== '마스터')) {
        return alert("관리자 또는 마스터만 공지를 삭제할 수 있습니다.");
    }

    if (!confirm("이 공지를 삭제하시겠습니까?")) return;
    state.notices = state.notices.filter(n => n.id !== id);
    saveStateToFirestore();
}


// ==========================================
// 📌 5. 전체 화면 렌더링 및 유틸리티
// ==========================================

// 로그인 상태에 따라 화면 구조를 바꾸고 대시보드 정보를 갱신하는 핵심 렌더링 함수
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
                <td class="p-3 font-mono text-gold">${(m.cp || 0).toLocaleString()}</td>
                <td class="p-3 text-xs">
                    <span class="${badgeColor} px-2 py-1 rounded border font-semibold">${m.role}</span>
                </td>
                ${canManage ? `
                    <td class="p-3 text-right space-x-2">
                        ${isMainAdmin && m.username !== 'seungki' ? `
                            <select onchange="changeMemberRole('${m.username}', this.value)" class="text-xs border border-gray-700 rounded p-1 outline-none">
                                <option value="" disabled selected>등급 변경</option>
                                <option value="마스터">2순위: 마스터 (1명)</option>
                                <option value="부마스터">3순위: 부마스터 (최대 2명)</option>
                                <option value="정예">4순위: 정예</option>
                                <option value="일반">5순위: 일반</option>
                            </select>
                            <button onclick="deleteMember('${m.username}')" class="text-xs text-red-400 hover:text-red-300 ml-1">삭제</button>
                        ` : `<span class="text-xs text-gray-500">${m.username === 'seungki' ? '최고 관리자' : '조회 전용'}</span>`}
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

// 입력한 총 다이아를 클랜원 수에 맞춰 엔분의일(1/N)로 공평하게 계산해주는 함수
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

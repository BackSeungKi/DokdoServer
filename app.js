// 전역 앱 상태
let currentUser = null;
let state = {
    members: [],
    notices: [
        { id: 1, title: "DOKDO 클랜 시스템에 오신 것을 환영합니다.", content: "출석체크 및 다이아 정산을 편리하게 이용하세요." }
    ],
    attendance: {},
    accounts: {}
};

// SHA-256 비동기 암호화 함수
async function sha256(str) {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 메인 관리자 계정(seungki) 존재 확인
function ensureMainAdminExists() {
    state.accounts = state.accounts || {};
    state.members = state.members || [];

    // bski090805! 의 SHA-256 해시값
    const adminHash = "29b8c04e22618991a0c7ed59b964fefb3ba4df8cf738ae8590bcbe8f0e5aa370";

    state.accounts["seungki"] = {
        passwordHash: adminHash,
        role: "메인 관리자",
        class: "검사",
        cp: 999999
    };

    if (!state.members.some(m => m.username === "seungki")) {
        state.members.unshift({
            username: "seungki",
            class: "검사",
            cp: 999999,
            role: "메인 관리자"
        });
    }
}

// Firebase 초기 동기화
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

function saveStateToFirestore() {
    if (window.setDoc && window.dbDocRef) {
        window.setDoc(window.dbDocRef, state).catch(() => {
            localStorage.setItem("dokdo_state", JSON.stringify(state));
        });
    } else {
        localStorage.setItem("dokdo_state", JSON.stringify(state));
    }
}

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

async function handleLogin() {
    const id = document.getElementById('loginId').value.trim();
    const pw = document.getElementById('loginPw').value.trim();

    if (!id || !pw) return alert("아이디와 비밀번호를 모두 입력해 주세요.");

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
                            <select onchange="changeMemberRole('${m.username}', this.value)" class="bg-darkBg text-xs text-white border border-gray-700 rounded p-1 outline-none">
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

/* ==========================================================================
   学習管理ツール (スタディマネージャー) - JavaScript ロジック (シンプル・軽量版)
   ========================================================================== */

// Firebaseの初期化とインスタンス
let firebaseEnabled = false;
let authInstance = null;
let dbInstance = null;
let storageInstance = null;

try {
  if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    authInstance = firebase.auth();
    dbInstance = firebase.firestore();
    storageInstance = firebase.storage();
    firebaseEnabled = true;
    console.log("[Firebase] Firebase initialized successfully.");
  } else {
    console.warn("[Firebase] Firebase Config is missing or SDK not loaded. Running in local storage mode.");
  }
} catch (e) {
  console.error("[Firebase] Initialization failed:", e);
}

// localStorageが使えない場合のフォールバック（メモリ保存）をサポートする安全なラッパー
const storage = {
  fallbackStore: {},
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn(`[Storage Warning] localStorage.getItem failed for key "${key}":`, e);
      return this.fallbackStore[key] || null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn(`[Storage Warning] localStorage.setItem failed for key "${key}":`, e);
      this.fallbackStore[key] = String(value);
    }
  }
};

// 1. 状態管理（State）- RPG/AI/チャット関連状態を完全排除
const gameState = {
  currentUser: "ゆうしゃ",      // デフォルトユーザー
  users: ["ゆうしゃ"],          // 登録ユーザーリスト
  proposedPostponeTask: null, // 延期提案中タスクの保持用
  currentCheckingTask: null,  // 答え合わせ中のタスク保持用
  currentCheckingImage: null, // 答え合わせ中のアップロード画像（一時キャッシュ用）
  mistakeRecords: [],         // 蓄積された間違いの記録（写真＋傾向）
  userProfile: null,          // ユーザーのプロフィール
  simulationMode: false,      // 翌日の予定シミュレーション表示モード
  weeklyReportMode: 'thisWeek',  // 'thisWeek' or 'lastWeek'
  allCompletedDates: [],       // すべてのタスクを完了した日の日付リスト
  weeklySchedules: []         // 時間割スケジュール初期化
};

// タスクリスト（カスタムタスク）の初期データ
const defaultTasks = [
  { id: 1, text: "つくえの うえを かたづける 🧹", status: 'active', drillId: null }
];

// ドリルの初期データ
const defaultDrills = [
  { id: 1, name: "さんすう ドリル", totalPages: 50, dailyAmount: 2, unit: "ページ", currentProgress: 0 },
  { id: 2, name: "かんじ ドリル", totalPages: 30, dailyAmount: 1, unit: "ページ", currentProgress: 0 }
];

let tasks = [];
let drills = [];
let completedTasks = []; // 過去の達成タスク
let history = []; // がんばり履歴データ
let currentCategoryFilter = 'all'; // 現在選択されているカテゴリフィルター


// 2. DOM要素の取得
const todayDateEl = document.getElementById('today-date');
const todayProgressBarEl = document.getElementById('today-progress-bar');
const todayProgressTextEl = document.getElementById('today-progress-text');

const taskListEl = document.getElementById('task-list');
const addTaskFormEl = document.getElementById('add-task-form');
const newTaskInputEl = document.getElementById('new-task-input');
const newTaskCategoryEl = document.getElementById('new-task-category');
const newTaskDescEl = document.getElementById('new-task-desc');
const newTaskDrillSelectEl = document.getElementById('new-task-drill-select');

// 設定関連のDOM
const drillFormEl = document.getElementById('drill-form');
const drillNameInputEl = document.getElementById('drill-name-input');
const drillTotalInputEl = document.getElementById('drill-total-input');
const drillDailyInputEl = document.getElementById('drill-daily-input');
const drillStartInputEl = document.getElementById('drill-start-input');
const drillTypeSelectEl = document.getElementById('drill-type-select');
const drillDurationInputEl = document.getElementById('drill-duration-input');
const drillTotalQuestionsInputEl = document.getElementById('drill-question-total-input');
const drillStartQuestionInputEl = document.getElementById('drill-question-start-input');
const drillDailyQuestionsInputEl = document.getElementById('drill-question-daily-input');
const registeredDrillsListEl = document.getElementById('registered-drills-list');
const drillCategorySelectEl = document.getElementById('drill-category-select');
const drillDescInputEl = document.getElementById('drill-desc-input');

// スケジュール設定関連のDOM
const scheduleFormEl = document.getElementById('schedule-form');
const scheduleCategorySelectEl = document.getElementById('schedule-category-select');
const scheduleNameInputEl = document.getElementById('schedule-name-input');
const scheduleDescInputEl = document.getElementById('schedule-desc-input');
const registeredSchedulesListEl = document.getElementById('registered-schedules-list');

// 答え合わせモーダル関連のDOM
const checkAnswerModalEl = document.getElementById('check-answer-modal');
const checkTaskNameEl = document.getElementById('check-task-name');
const checkFormEl = document.getElementById('check-form');
const mistakeInputEl = document.getElementById('mistake-input');
const btnAllCorrectEl = document.getElementById('btn-all-correct');
const btnTriggerUploadEl = document.getElementById('btn-trigger-upload');
const mistakeImageInputEl = document.getElementById('mistake-image-input');
const imagePreviewWrapperEl = document.getElementById('image-preview-wrapper');
const mistakeImagePreviewEl = document.getElementById('mistake-image-preview');
const btnRemoveImageEl = document.getElementById('btn-remove-image');
const btnCloseCheckModalEl = document.getElementById('btn-close-check-modal');

// にがてコンテナ関連のDOM
const nigateFoldersContainerEl = document.getElementById('nigate-folders-container');

// ユーザー管理関連のDOM
const btnUserSwitchEl = document.getElementById('btn-user-switch');
const userModalEl = document.getElementById('user-modal');
const btnCloseUserModalEl = document.getElementById('btn-close-user-modal');
const userFormEl = document.getElementById('user-form');


// 3. 初期化処理
function init() {
  if (firebaseEnabled) {
    setupAuthObserver();
  } else {
    // Firebaseが無効な場合は従来通りローカルモードで起動
    startLocalMode();
  }

  // 初期化中の部分エラーがあってもイベント登録と設定タブ描画は必ず実行する
  try {
    setupEventListeners();
    setupAuthFormListeners(); // Firebase認証関連のイベントリスナー登録
    renderSettingsTab(); // 設定タブの初期描画
    renderNewTaskDrillOptions(); // タスク追加用プルダウンの初期描画
  } catch (err) {
    console.error("EventListeners or settings tab setup failed:", err);
  }
}

// 従来のローカルモードでの初期化
function startLocalMode() {
  try {
    gameState.simulationMode = false;
    loadData();
    checkDateChange();
    generateDailyTasks();
    renderTasks();
    renderNigateBuster();
    updateUI();
    renderNewTaskDrillOptions();
  } catch (err) {
    console.error("Local Initialization warning:", err);
  }
}

// ==========================================================================
// Firebase 連携・データ同期処理
// ==========================================================================
let currentFirebaseUser = null;

// Firebase 認証状態の監視
function setupAuthObserver() {
  const authContainer = document.getElementById('auth-container');
  const cloudStatusSection = document.getElementById('cloud-status-section');
  const cloudUserEmail = document.getElementById('cloud-user-email');

  console.log("[Firebase Auth] Setting up observer. authContainer exists:", !!authContainer);

  authInstance.onAuthStateChanged(async (user) => {
    console.log("[Firebase Auth] Auth state changed. User:", user ? user.email : "null");
    if (user) {
      currentFirebaseUser = user;
      
      if (cloudUserEmail) cloudUserEmail.textContent = user.email;
      if (cloudStatusSection) cloudStatusSection.style.display = 'block';
      if (authContainer) {
        authContainer.classList.remove('active');
        authContainer.style.display = 'none';
      }

      // クラウドデータの読み込み
      showGameToast("データを同期しています...", "☁️");
      await loadCloudData();
      
      // アプリ画面の更新
      try {
        gameState.simulationMode = false;
        checkDateChange();
        generateDailyTasks();
        renderTasks();
        renderNigateBuster();
        updateUI();
        if (typeof renderCalendar === 'function') renderCalendar();
        renderNewTaskDrillOptions();
      } catch (e) {
        console.error("App render failed after cloud load:", e);
      }
    } else {
      currentFirebaseUser = null;
      if (cloudStatusSection) cloudStatusSection.style.display = 'none';

      console.log("[Firebase Auth] skip_login value:", sessionStorage.getItem('skip_login'));
      if (sessionStorage.getItem('skip_login') === 'true') {
        if (authContainer) {
          authContainer.classList.remove('active');
          authContainer.style.display = 'none';
        }
        startLocalMode();
      } else {
        if (authContainer) {
          console.log("[Firebase Auth] Displaying login screen (flex + active).");
          authContainer.style.display = 'flex';
          authContainer.classList.add('active');
        } else {
          console.warn("[Firebase Auth] Cannot find #auth-container element!");
        }
      }
    }
  });
}

// Firebase データのクラウド一括保存
async function saveAllDataToCloud() {
  if (!firebaseEnabled || !currentFirebaseUser) return;
  try {
    const userDocRef = dbInstance.collection("users").doc(currentFirebaseUser.uid);
    const payload = {
      gameState: {
        currentUser: gameState.currentUser,
        users: gameState.users,
        userProfile: gameState.userProfile,
        allCompletedDates: gameState.allCompletedDates || [],
        weeklyReportMode: gameState.weeklyReportMode || 'thisWeek',
        simulationMode: gameState.simulationMode || false
      },
      tasks: tasks,
      drills: drills,
      completedTasks: completedTasks,
      history: history,
      weeklySchedules: gameState.weeklySchedules || [],
      mistakeRecords: gameState.mistakeRecords || [],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await userDocRef.set(payload, { merge: true });
    console.log("[Firestore] Data successfully saved to cloud.");
  } catch (e) {
    console.error("[Firestore] Save failed:", e);
    showGameToast("同期に失敗しました。", "⚠️");
  }
}

// Firebase データのクラウド読み込み
async function loadCloudData() {
  if (!firebaseEnabled || !currentFirebaseUser) return;
  try {
    const userDocRef = dbInstance.collection("users").doc(currentFirebaseUser.uid);
    const doc = await userDocRef.get();
    if (doc.exists) {
      const data = doc.data();
      console.log("[Firestore] Loaded cloud data:", data);

      // 【強力な安全装置】
      // クラウドのデータが空（ドリルが0件）であり、かつローカルに既に学習データがある場合、
      // クラウドの空データでローカルを破壊するのを防ぐため、ローカルからクラウドへの移行確認を行います。
      try {
        const hasLocalDrills = storage.getItem(getUserKey('drills'));
        const localDrillsCount = (hasLocalDrills && hasLocalDrills !== '[]') ? (JSON.parse(hasLocalDrills) || []).length : 0;
        const cloudDrillsCount = data.drills ? data.drills.length : 0;

        if (cloudDrillsCount === 0 && localDrillsCount > 0) {
          const confirmMigration = confirm(
            "オンライン上に学習データが見つかりませんでしたが、この端末にこれまでのデータが残っています。\n\n端末のデータをオンラインにアップロード（引き継ぎ）して復元しますか？\n（『キャンセル』を選ぶと、オンラインの空データが優先されます）"
          );
          if (confirmMigration) {
            loadData(); // ローカルからロード
            await saveAllDataToCloud(); // クラウドへ保存
            saveLocalBackup();
            return;
          }
        }
      } catch (err) {
        console.error("[Auth Guard Error]", err);
      }
      
      // メモリ変数への反映
      if (data.tasks) tasks = data.tasks;
      if (data.drills) drills = data.drills;
      if (data.completedTasks) completedTasks = data.completedTasks;
      if (data.history) history = data.history;
      
      if (data.gameState) {
        if (data.gameState.currentUser) gameState.currentUser = data.gameState.currentUser;
        if (data.gameState.users) gameState.users = data.gameState.users;
        if (data.gameState.userProfile) gameState.userProfile = data.gameState.userProfile;
        if (data.gameState.allCompletedDates) gameState.allCompletedDates = data.gameState.allCompletedDates;
        if (data.gameState.weeklyReportMode) gameState.weeklyReportMode = data.gameState.weeklyReportMode;
        gameState.simulationMode = false;
      }
      if (data.weeklySchedules) gameState.weeklySchedules = data.weeklySchedules;
      if (data.mistakeRecords) gameState.mistakeRecords = data.mistakeRecords;

      // ログイン中ユーザー表示の更新
      const currentUserEl = document.getElementById('current-user-name');
      if (currentUserEl && gameState.currentUser) {
        currentUserEl.textContent = gameState.currentUser;
      }

      // ローカルストレージにもバックアップとして保存
      saveLocalBackup();
    } else {
      console.log("[Firestore] No cloud data found. This is a new user.");
      // 既存のローカルデータがある場合は移行を提案
      await checkAndMigrateLocalData();
    }
  } catch (e) {
    console.error("[Firestore] Load failed:", e);
    showGameToast("同期データの読み込みに失敗しました。ローカルデータで起動します。", "⚠️");
    startLocalMode();
  }
}

// 既存のローカルデータのクラウドへの移行（引き継ぎ）
async function checkAndMigrateLocalData() {
  // ローカルにデータが存在するかチェック
  const hasLocalTasks = storage.getItem(getUserKey('tasks'));
  const hasLocalDrills = storage.getItem(getUserKey('drills'));
  if (!hasLocalTasks && !hasLocalDrills) return;

  const confirmMigration = confirm(
    "この端末に保存されているこれまでの学習データを、新しく作成したオンラインアカウントに引き継ぎますか？\n\n※「はい」を選ぶと、現在のデータがクラウドに保存され、別の端末からでも見られるようになります。"
  );

  if (confirmMigration) {
    try {
      loadData(); // ローカルから現在データをメモリに読み込み
      await saveAllDataToCloud(); // クラウドへ一括アップロード
      showGameToast("データの引き継ぎが完了しました！☁️", "💮");
    } catch (e) {
      console.error("[Migration] Migration failed:", e);
      showGameToast("引き継ぎに失敗しました。", "⚠️");
    }
  }
}

// ローカルへのバックアップキャッシュ保存
function saveLocalBackup() {
  try {
    // 【強力な安全装置】
    // メモリ上のデータが完全に空（ドリルが0件）であり、かつローカルストレージに既にドリルデータが保存されている場合、
    // クラウドからの空データ同期による上書き破壊を防ぐため、書き込みを中止してデータを徹底保護します。
    const hasLocalDrills = storage.getItem(getUserKey('drills'));
    if ((!drills || drills.length === 0) && hasLocalDrills && hasLocalDrills !== '[]') {
      console.warn("[Local Backup] 空のデータによる上書きからローカルデータを保護しました。");
      return;
    }

    storage.setItem('study_rpg_users', JSON.stringify(gameState.users));
    storage.setItem('study_rpg_current_user', gameState.currentUser);
    storage.setItem(getUserKey('profile'), JSON.stringify(gameState.userProfile));
    storage.setItem(getUserKey('tasks'), JSON.stringify(tasks));
    storage.setItem(getUserKey('drills'), JSON.stringify(drills));
    storage.setItem(getUserKey('completed_tasks'), JSON.stringify(completedTasks));
    storage.setItem(getUserKey('history'), JSON.stringify(history));
    storage.setItem(getUserKey('weekly_schedule'), JSON.stringify(gameState.weeklySchedules));
    storage.setItem(getUserKey('all_completed_dates'), JSON.stringify(gameState.allCompletedDates));
    storage.setItem(getUserKey('mistake_records'), JSON.stringify(gameState.mistakeRecords));
  } catch (e) {
    console.warn("[Local Backup] Failed to save local backup:", e);
  }
}

// Firebase Storage への画像アップロード
async function uploadImageToStorage(base64Data, filename) {
  if (!firebaseEnabled || !currentFirebaseUser || !storageInstance) return null;
  try {
    // base64をBlobに変換
    const fetchRes = await fetch(base64Data);
    const blob = await fetchRes.blob();
    
    // パース: users/{uid}/mistakes/{filename}.jpg
    const fileRef = storageInstance.ref().child(`users/${currentFirebaseUser.uid}/mistakes/${filename}.jpg`);
    await fileRef.put(blob);
    const downloadURL = await fileRef.getDownloadURL();
    console.log("[Firebase Storage] Image uploaded. URL:", downloadURL);
    return downloadURL;
  } catch (e) {
    console.error("[Firebase Storage] Upload failed:", e);
    return null;
  }
}

// Firebase 認証関連のイベントリスナー
function setupAuthFormListeners() {
  const authForm = document.getElementById('auth-form');
  const btnAuthToggle = document.getElementById('btn-auth-toggle');
  const btnAuthSkip = document.getElementById('btn-auth-skip');
  const btnAuthLogout = document.getElementById('btn-auth-logout');

  let isSignUpMode = false; // 最初はログインモード

  if (btnAuthToggle) {
    btnAuthToggle.addEventListener('click', () => {
      isSignUpMode = !isSignUpMode;
      const title = document.getElementById('auth-title');
      const subtitle = document.getElementById('auth-subtitle');
      const submitBtn = document.getElementById('btn-auth-submit');
      const toggleText = document.getElementById('auth-toggle-text');

      if (isSignUpMode) {
        if (title) title.textContent = "アカウントを作ろう！";
        if (subtitle) subtitle.textContent = "データを安全に保存できます";
        if (submitBtn) submitBtn.textContent = "アカウントを作成";
        if (toggleText) toggleText.textContent = "すでにアカウントを持っていますか？";
        btnAuthToggle.textContent = "ログインする";
      } else {
        if (title) title.textContent = "スタディマネージャー";
        if (subtitle) subtitle.textContent = "ログインしてデータを同期しよう！";
        if (submitBtn) submitBtn.textContent = "ログイン";
        if (toggleText) toggleText.textContent = "アカウントを持っていませんか？";
        btnAuthToggle.textContent = "新規登録する";
      }
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;

      if (!firebaseEnabled || !authInstance) {
        showGameToast("Firebaseが利用できません。", "⚠️");
        return;
      }

      const submitBtn = document.getElementById('btn-auth-submit');
      const originalText = submitBtn.textContent;
      submitBtn.textContent = "処理中...";
      submitBtn.disabled = true;

      try {
        if (isSignUpMode) {
          // 新規登録
          await authInstance.createUserWithEmailAndPassword(email, password);
          showGameToast("アカウントを作成しました！✨", "💮");
        } else {
          // ログイン
          await authInstance.signInWithEmailAndPassword(email, password);
          showGameToast("ログインしました！☁️", "🔑");
        }
      } catch (err) {
        console.error("[Auth Error]", err);
        let errorMsg = "メールアドレスまたはパスワードが正しくありません。";
        if (err.code === "auth/email-already-in-use") {
          errorMsg = "このメールアドレスはすでに登録されています。";
        } else if (err.code === "auth/invalid-email") {
          errorMsg = "メールアドレスの形式が正しくありません。";
        } else if (err.code === "auth/weak-password") {
          errorMsg = "パスワードは6文字以上で設定してください。";
        }
        showGameToast(errorMsg, "⚠️");
      } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    });
  }

  if (btnAuthSkip) {
    btnAuthSkip.addEventListener('click', () => {
      sessionStorage.setItem('skip_login', 'true');
      const authContainer = document.getElementById('auth-container');
      if (authContainer) authContainer.style.display = 'none';
      startLocalMode();
      showGameToast("ローカルモードで起動しました。", "🏠");
    });
  }

  if (btnAuthLogout) {
    btnAuthLogout.addEventListener('click', async () => {
      if (await showGameConfirm("ログアウトしますか？")) {
        try {
          await authInstance.signOut();
          sessionStorage.removeItem('skip_login');
          showGameToast("ログアウトしました。", "🚪");
          window.location.reload(); // 状態を初期化するためにリロード
        } catch (e) {
          console.error("Logout failed:", e);
          showGameToast("ログアウトに失敗しました。", "⚠️");
        }
      }
    });
  }
}

// キー取得用プレフィックスユーティリティ (以前のキーをそのまま使用し互換性を維持)
function getUserKey(baseKey) {
  return `study_rpg_u_${gameState.currentUser}_${baseKey}`;
}

// データ読み込み (LocalStorage - 互換性維持)
function loadData() {
  // ユーザーリストのロード
  const savedUsers = storage.getItem('study_rpg_users');
  if (savedUsers) {
    gameState.users = JSON.parse(savedUsers);
  } else {
    gameState.users = ["ユーザー"];
    storage.setItem('study_rpg_users', JSON.stringify(gameState.users));
  }

  // 現在のアクティブユーザーのロード
  const savedCurrentUser = storage.getItem('study_rpg_current_user');
  if (savedCurrentUser && gameState.users.includes(savedCurrentUser)) {
    gameState.currentUser = savedCurrentUser;
  } else {
    gameState.currentUser = gameState.users[0];
    storage.setItem('study_rpg_current_user', gameState.currentUser);
  }

  // ログイン中ユーザー表示の更新
  const currentUserEl = document.getElementById('current-user-name');
  if (currentUserEl) {
    currentUserEl.textContent = gameState.currentUser;
  }

  // ユーザープロファイルのロード
  const savedProfile = storage.getItem(getUserKey('profile'));
  if (savedProfile) {
    gameState.userProfile = JSON.parse(savedProfile);
  } else {
    gameState.userProfile = {
      name: gameState.currentUser,
      avatar: "default_img"
    };
    saveUserProfile();
  }

  // ドリルマスタ
  const savedDrills = storage.getItem(getUserKey('drills'));
  if (savedDrills) {
    drills = JSON.parse(savedDrills);
    let drillUpdated = false;
    drills.forEach(d => {
      if (!d.category) {
        d.category = "べんきょう";
        drillUpdated = true;
      }
      if (d.description === undefined) {
        d.description = "";
        drillUpdated = true;
      }
      if (!d.days) {
        d.days = ["月", "火", "水", "木", "金", "土", "日"];
        drillUpdated = true;
      }
      if (!d.timing) {
        d.timing = "any";
        drillUpdated = true;
      }
      if (d.type === undefined) {
        d.type = "page";
        drillUpdated = true;
      }
      if (d.duration === undefined) {
        d.duration = 0;
        drillUpdated = true;
      }
      if (d.startPage === undefined) {
        d.startPage = d.currentProgress ? d.currentProgress + 1 : 1;
        drillUpdated = true;
      }
      if (d.totalQuestions === undefined) {
        d.totalQuestions = 0;
        drillUpdated = true;
      }
      if (d.startQuestion === undefined) {
        d.startQuestion = 0;
        drillUpdated = true;
      }
      if (d.dailyQuestionAmount === undefined) {
        d.dailyQuestionAmount = 0;
        drillUpdated = true;
      }
      if (d.currentQuestionProgress === undefined) {
        d.currentQuestionProgress = 0;
        drillUpdated = true;
      }
      if (d.type === "page" && d.unit !== "ページ") {
        d.unit = "ページ";
        drillUpdated = true;
      } else if (d.type === "time" && d.unit !== "分") {
        d.unit = "分";
        drillUpdated = true;
      }
      if (d.name && (d.name.includes('ぷん') || d.name.includes('ふん'))) {
        d.name = d.name.replace(/ぷん|ふん/g, '分');
        drillUpdated = true;
      }
      if (d.description && (d.description.includes('ぷん') || d.description.includes('ふん'))) {
        d.description = d.description.replace(/ぷん|ふん/g, '分');
        drillUpdated = true;
      }
      if (d.name && /<[^>]*>/.test(d.name)) {
        d.name = d.name.replace(/<\/?[^>]+(>|$)/g, "");
        drillUpdated = true;
      }
      if (d.description && /<[^>]*>/.test(d.description)) {
        d.description = d.description.replace(/<\/?[^>]+(>|$)/g, "");
        drillUpdated = true;
      }
      if (d.archived === undefined) {
        d.archived = false;
        drillUpdated = true;
      }
      if (d.tomorrowAmountOverride === undefined) {
        d.tomorrowAmountOverride = 0;
        drillUpdated = true;
      }
    });
    if (drillUpdated) saveDrills();
  } else {
    drills = JSON.parse(JSON.stringify(defaultDrills));
    drills.forEach(d => {
      d.category = "べんきょう";
      d.description = "";
      d.days = ["月", "火", "水", "木", "金", "土", "日"];
      d.timing = "any";
      d.startPage = 1;
      d.unit = "ページ";
      d.type = "page";
      d.duration = 0;
      d.totalQuestions = 0;
      d.startQuestion = 0;
      d.dailyQuestionAmount = 0;
      d.currentQuestionProgress = 0;
      d.archived = false;
      d.tomorrowAmountOverride = 0;
    });
    saveDrills();
  }

  // タスクリスト
  const savedTasks = storage.getItem(getUserKey('tasks'));
  if (savedTasks) {
    tasks = JSON.parse(savedTasks);
    let taskUpdated = false;
    const seenTaskKeys = new Set();
    const uniqueTasks = [];

    tasks.forEach(t => {
      if (!t.category) {
        t.category = (t.drillId !== null && t.drillId !== undefined) ? "べんきょう" : "おてつだい";
        taskUpdated = true;
      }
      if (t.description === undefined) {
        t.description = "";
        taskUpdated = true;
      }
      if (!t.date) {
        t.date = getTodayDateString();
        taskUpdated = true;
      }
      if (t.text && (t.text.includes('ぷん') || t.text.includes('ふん'))) {
        t.text = t.text.replace(/ぷん|ふん/g, '分');
        taskUpdated = true;
      }
      if (t.description && (t.description.includes('ぷん') || t.description.includes('ふん'))) {
        t.description = t.description.replace(/ぷん|ふん/g, '分');
        taskUpdated = true;
      }
      if (t.text && /<[^>]*>/.test(t.text)) {
        t.text = t.text.replace(/<\/?[^>]+(>|$)/g, "");
        taskUpdated = true;
      }
      if (t.description && /<[^>]*>/.test(t.description)) {
        t.description = t.description.replace(/<\/?[^>]+(>|$)/g, "");
        taskUpdated = true;
      }

      // 重複タスクの排除
      const key = `id_${t.id}_${t.date}`;
      if (!seenTaskKeys.has(key)) {
        seenTaskKeys.add(key);
        uniqueTasks.push(t);
      } else {
        taskUpdated = true;
      }
    });
    tasks = uniqueTasks;
    if (taskUpdated) saveTasks();
  } else {
    tasks = JSON.parse(JSON.stringify(defaultTasks));
    tasks.forEach(t => {
      t.category = "おてつだい";
      t.description = "";
    });
    saveTasks();
  }

  // 履歴データ
  const savedHistory = storage.getItem(getUserKey('history'));
  if (savedHistory) {
    history = JSON.parse(savedHistory);
    let historyUpdated = false;
    history.forEach(h => {
      if (h.taskText && (h.taskText.includes('ぷん') || h.taskText.includes('ふん'))) {
        h.taskText = h.taskText.replace(/ぷん|ふん/g, '分');
        historyUpdated = true;
      }
      if (h.unit === 'ぷん' || h.unit === 'ふん') {
        h.unit = '分';
        historyUpdated = true;
      }
      if (h.taskText && /<[^>]*>/.test(h.taskText)) {
        h.taskText = h.taskText.replace(/<\/?[^>]+(>|$)/g, "");
        historyUpdated = true;
      }
    });
    if (historyUpdated) saveHistory();
  } else {
    history = [];
  }

  // 過去の達成タスク
  const savedCompletedTasks = storage.getItem(getUserKey('completed_tasks'));
  if (savedCompletedTasks) {
    completedTasks = JSON.parse(savedCompletedTasks);
  } else {
    completedTasks = [];
  }

  // にがて傾向・写真のロード
  const savedMistakes = storage.getItem(getUserKey('mistake_records'));
  if (savedMistakes) {
    gameState.mistakeRecords = JSON.parse(savedMistakes);
    let updated = false;
    gameState.mistakeRecords.forEach(r => {
      if (!r.status) {
        r.status = "pending";
        updated = true;
      }
    });
    if (updated) {
      storage.setItem(getUserKey('mistake_records'), JSON.stringify(gameState.mistakeRecords));
    }
  } else {
    gameState.mistakeRecords = [];
  }

  // 1週間のスケジュール
  const savedSchedule = storage.getItem(getUserKey('weekly_schedule'));
  if (savedSchedule) {
    const parsed = JSON.parse(savedSchedule);
    if (!Array.isArray(parsed)) {
      // 移行ロジック
      const flatList = [];
      const days = ["月", "火", "水", "木", "金", "土", "日"];
      days.forEach(day => {
        const list = parsed[day] || [];
        list.forEach(item => {
          flatList.push({
            id: item.id || `weekly_s_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name: item.name,
            category: item.category,
            description: item.description || '',
            drillId: item.drillId || null,
            days: [day]
          });
        });
      });
      gameState.weeklySchedules = flatList;
      saveWeeklySchedule();
    } else {
      gameState.weeklySchedules = parsed;
    }
    
    let scheduleUpdated = false;
    gameState.weeklySchedules.forEach(s => {
      if (s.name && (s.name.includes('ぷん') || s.name.includes('ふん'))) {
        s.name = s.name.replace(/ぷん|ふん/g, '分');
        scheduleUpdated = true;
      }
      if (s.description && (s.description.includes('ぷん') || s.description.includes('ふん'))) {
        s.description = s.description.replace(/ぷん|ふん/g, '分');
        scheduleUpdated = true;
      }
      if (s.name && /<[^>]*>/.test(s.name)) {
        s.name = s.name.replace(/<\/?[^>]+(>|$)/g, "");
        scheduleUpdated = true;
      }
      if (s.description && /<[^>]*>/.test(s.description)) {
        s.description = s.description.replace(/<\/?[^>]+(>|$)/g, "");
        scheduleUpdated = true;
      }
    });
    if (scheduleUpdated) saveWeeklySchedule();
  } else {
    gameState.weeklySchedules = [];
    saveWeeklySchedule();
  }

  // はなまる獲得日（すべて完了した日）のロード
  const savedAllCompleted = storage.getItem(getUserKey('all_completed_dates'));
  if (savedAllCompleted) {
    gameState.allCompletedDates = JSON.parse(savedAllCompleted);
  } else {
    gameState.allCompletedDates = [];
  }
}

function saveUserProfile() {
  storage.setItem(getUserKey('profile'), JSON.stringify(gameState.userProfile));
  if (firebaseEnabled && currentFirebaseUser) saveAllDataToCloud();
}

function renameUserStorage(oldName, newName) {
  const keysToMigrate = [
    'drills', 'tasks', 'history', 'completed_tasks', 'weekly_schedule', 'profile', 'mistake_records', 'all_completed_dates'
  ];
  keysToMigrate.forEach(baseKey => {
    const oldKey = `study_rpg_u_${oldName}_${baseKey}`;
    const newKey = `study_rpg_u_${newName}_${baseKey}`;
    const value = storage.getItem(oldKey);
    if (value !== null) {
      storage.setItem(newKey, value);
      try {
        localStorage.removeItem(oldKey);
      } catch (e) {
        console.error(e);
      }
    }
  });
}

function saveTasks() {
  storage.setItem(getUserKey('tasks'), JSON.stringify(tasks));
  if (firebaseEnabled && currentFirebaseUser) saveAllDataToCloud();
}

function saveWeeklySchedule() {
  storage.setItem(getUserKey('weekly_schedule'), JSON.stringify(gameState.weeklySchedules));
  if (firebaseEnabled && currentFirebaseUser) saveAllDataToCloud();
}

function saveDrills() {
  storage.setItem(getUserKey('drills'), JSON.stringify(drills));
  if (firebaseEnabled && currentFirebaseUser) saveAllDataToCloud();
}

// クラウド用一括保存関数（後ほど定義されますが、事前に呼び出しを記載）
function saveHistory() {
  storage.setItem(getUserKey('history'), JSON.stringify(history));
  if (firebaseEnabled && currentFirebaseUser) saveAllDataToCloud();
}

function saveCompletedTasks() {
  storage.setItem(getUserKey('completed_tasks'), JSON.stringify(completedTasks));
  if (firebaseEnabled && currentFirebaseUser) saveAllDataToCloud();
}

function saveAllCompletedDates() {
  storage.setItem(getUserKey('all_completed_dates'), JSON.stringify(gameState.allCompletedDates));
  if (firebaseEnabled && currentFirebaseUser) saveAllDataToCloud();
}

function getCategoryEmoji(category) {
  if (category === "べんきょう") return "📚";
  if (category === "ならいごと") return "🏆";
  if (category === "しゅくだい") return "📝";
  if (category === "れんしゅう") return "🎹";
  if (category === "おてつだい") return "🏠";
  return "🏆";
}

function getScheduleEmojiByName(name) {
  if (!name) return "🎹";
  const match = gameState.weeklySchedules.find(s => s.name === name);
  if (match) {
    return getCategoryEmoji(match.category);
  }
  return "🎹";
}

function getTodayDayName() {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return days[new Date().getDay()];
}

function getTodayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

// 今日の実績データ（および間違いメモ）から「今日のすること」「カレンダー」「がんばり実績」を完全自動修復
function repairTodayCompletedTasks() {
  const todayDateStr = getTodayDateString();
  let repaired = false;

  // 【超強力救出エンジン】「にがて（間違い記録）」に存在するが、completedTasks / history から漏れている実績を完全に無条件救出！
  if (gameState.mistakeRecords && gameState.mistakeRecords.length > 0) {
    gameState.mistakeRecords.forEach(mistake => {
      if (!mistake.drillName) return;

      const matchedDrill = drills.find(d => 
        d.name === mistake.drillName || 
        d.name.includes(mistake.drillName) || 
        mistake.drillName.includes(d.name) ||
        (d.name && mistake.drillName && d.name.replace(/\s+/g, '') === mistake.drillName.replace(/\s+/g, ''))
      );

      const drillNameStr = matchedDrill ? matchedDrill.name : mistake.drillName;
      const drillIdVal = matchedDrill ? matchedDrill.id : `restored_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      const categoryVal = matchedDrill ? matchedDrill.category : "べんきょう";
      const mistakeDate = mistake.date || todayDateStr;

      const hasCompleted = completedTasks.some(t => 
        (t.text && t.text.includes(drillNameStr)) && 
        (t.completedDate === mistakeDate || t.date === mistakeDate)
      );

      if (!hasCompleted) {
        const emoji = getCategoryEmoji(categoryVal);
        const startP = matchedDrill ? (matchedDrill.startPage || 1) : 1;
        const endP = matchedDrill && matchedDrill.currentProgress > 0 ? matchedDrill.currentProgress : (startP + (matchedDrill ? (matchedDrill.dailyAmount || 1) : 1) - 1);
        const taskText = `${emoji} ${categoryVal}：${drillNameStr}（P:${startP}〜${endP}）`;

        const restoredTask = {
          id: `drill_${drillIdVal}_restored_${mistakeDate}`,
          text: taskText,
          status: 'completed',
          drillId: drillIdVal,
          startPage: startP,
          endPage: endP,
          category: categoryVal,
          description: '',
          date: mistakeDate,
          completedDate: mistakeDate
        };

        completedTasks.push(restoredTask);
        
        const hasHistory = history.some(h => h.taskText && h.taskText.includes(drillNameStr) && h.date === mistakeDate);
        if (!hasHistory) {
          history.push({
            id: restoredTask.id,
            date: mistakeDate,
            taskText: taskText,
            type: 'drill',
            amount: matchedDrill ? (matchedDrill.dailyAmount || 1) : 1,
            unit: matchedDrill ? (matchedDrill.unit || 'ページ') : 'ページ'
          });
        }
        repaired = true;
      }
    });
  }

  if (!completedTasks || completedTasks.length === 0) {
    if (repaired) {
      saveCompletedTasks();
      saveHistory();
    }
    return;
  }

  const todayCompletedDrillTasks = completedTasks.filter(t => 
    t.completedDate === todayDateStr && t.drillId !== null && t.drillId !== undefined
  );

  todayCompletedDrillTasks.forEach(completedTask => {
    const drillId = completedTask.drillId;

    // 1. 誤って active（未達成・明日の範囲）になっている同じドリルのタスクを今日から消去
    tasks = tasks.filter(t => !(t.drillId === drillId && t.date === todayDateStr && t.status === 'active'));

    // 2. 達成済みタスク（status: 'completed'）が存在しなければ今日の実績から復元
    const existingIndex = tasks.findIndex(t => t.drillId === drillId && t.date === todayDateStr && t.status === 'completed');
    if (existingIndex === -1) {
      tasks.push({
        id: completedTask.id || `drill_${drillId}_completed_${todayDateStr}`,
        text: completedTask.text,
        status: 'completed',
        drillId: drillId,
        startPage: completedTask.startPage || 0,
        endPage: completedTask.endPage || 0,
        startQuestion: completedTask.startQuestion || 0,
        endQuestion: completedTask.endQuestion || 0,
        category: completedTask.category || 'べんきょう',
        description: completedTask.description || '',
        date: todayDateStr,
        completedDate: todayDateStr
      });
      repaired = true;
    } else {
      tasks[existingIndex].text = completedTask.text;
      tasks[existingIndex].status = 'completed';
      repaired = true;
    }

    // 3. ドリルの進捗も今日達成した実績に合わせて修復
    const drill = drills.find(d => d.id === drillId || d.id.toString() === drillId.toString());
    if (drill) {
      if (completedTask.endPage > 0 && drill.totalPages > 0) {
        drill.currentProgress = Math.min(completedTask.endPage, drill.totalPages);
      }
      if (completedTask.endQuestion > 0 && drill.totalQuestions > 0) {
        drill.currentQuestionProgress = Math.min(completedTask.endQuestion, drill.totalQuestions);
      }
    }
  });

  if (repaired) {
    saveTasks();
    saveDrills();
    saveCompletedTasks();
    saveHistory();
    console.log("[Data Repair] 間違いメモから算数ラボ等の実績・カレンダー・今日のする事を完全復元しました。");
  }
}

// 今日のタスクを自動生成
function generateDailyTasks(isNewDay = false) {
  repairTodayCompletedTasks();
  const todayDay = getTodayDayName();
  const todayDateStr = getTodayDateString();
  const todaySchedules = gameState.weeklySchedules.filter(s => s.days.includes(todayDay));

  let updated = false;

  // 今日すでに完了（completed）しているドリルを一覧化
  const completedDrillIdsToday = new Set(
    tasks.filter(t => t.date === todayDateStr && t.status === 'completed' && t.drillId).map(t => t.drillId)
  );

  // 今日の未完了スケジュールタスクを一旦削除して再生成（すでに同日完了しているドリルの未達成誤生成タスクも削除）
  const originalTaskCountForCleanup = tasks.length;
  tasks = tasks.filter(t => {
    // 今日すでに完了しているドリルの未達成タスクが残っていれば排除
    if (t.date === todayDateStr && t.status === 'active' && t.drillId && completedDrillIdsToday.has(t.drillId)) {
      return false;
    }
    if (t.date && t.date !== todayDateStr) return true;
    if (t.isManual) return true; // 手動追加されたタスクは自動削除・再生成しない
    if (t.status === 'completed' || t.status === 'postponed' || t.status === 'deleted') return true; // 完了・延期・削除済みのタスクは残す
    const isDrill = t.drillId !== null && t.drillId !== undefined;
    const isWeekly = t.id && t.id.toString().startsWith('weekly_');
    return !(isDrill || isWeekly);
  });
  if (tasks.length !== originalTaskCountForCleanup) {
    updated = true;
  }

  const activeDrillIdsToday = new Set();
  const activeWeeklyTaskIdsToday = new Set();

  todaySchedules.forEach(schedule => {
    if (schedule.drillId) {
      const drill = drills.find(d => d.id === schedule.drillId || d.id.toString() === schedule.drillId.toString());
      if (!drill || drill.archived) return;

      // 【超重要】今日すでにこのドリルを達成完了している場合、翌日分の未達成タスクを今日誤生成しない！
      if (completedDrillIdsToday.has(drill.id)) {
        return;
      }

      activeDrillIdsToday.add(drill.id);

      const isPageFinished = drill.totalPages > 0 && (drill.currentProgress || 0) >= drill.totalPages;
      const isQuestionFinished = drill.totalQuestions > 0 && (drill.currentQuestionProgress || 0) >= drill.totalQuestions;
      if (drill.type !== 'time' && (drill.totalPages > 0 ? isPageFinished : true) && (drill.totalQuestions > 0 ? isQuestionFinished : true)) {
        return;
      }

      let drillTaskId = "";
      let taskText = "";
      let startPageVal = 0;
      let endPageVal = 0;
      let startQuestionVal = 0;
      let endQuestionVal = 0;

      const emoji = getCategoryEmoji(drill.category);

      let timingSuffix = "";
      if (drill.timing === 'before_lesson') {
        timingSuffix = " (ならいごとのまえ)";
      } else if (drill.timing === 'after_lesson') {
        timingSuffix = " (ならいごとのあと)";
      } else if (drill.timing && drill.timing.startsWith('before_schedule:')) {
        const lessonName = drill.timing.split(':')[1];
        const hasLessonToday = todaySchedules.some(s => s.name === lessonName);
        if (hasLessonToday) {
          timingSuffix = ` (${getScheduleEmojiByName(lessonName)} ${lessonName} のまえ)`;
        }
      } else if (drill.timing && drill.timing.startsWith('after_schedule:')) {
        const lessonName = drill.timing.split(':')[1];
        const hasLessonToday = todaySchedules.some(s => s.name === lessonName);
        if (hasLessonToday) {
          timingSuffix = ` (${getScheduleEmojiByName(lessonName)} ${lessonName} のあと)`;
        }
      }

      if (drill.type === 'time') {
        drillTaskId = `drill_${drill.id}_time`;
        const duration = (isNewDay && drill.tomorrowAmountOverride > 0) ? drill.tomorrowAmountOverride : drill.duration;
        taskText = `${emoji} ${drill.category}：${drill.name}（${duration}分）`;
      } else {
        let pageText = "";
        if (drill.totalPages > 0) {
          const startP = (drill.currentProgress || 0) + 1;
          const extraAmount = drill.postponedAmount || 0;
          const baseDailyP = (isNewDay && drill.tomorrowAmountOverride > 0) ? drill.tomorrowAmountOverride : drill.dailyAmount;
          const totalDailyP = baseDailyP + extraAmount;
          const endP = Math.min(startP + totalDailyP - 1, drill.totalPages);
          pageText = `P:${startP}〜${endP}`;
          
          startPageVal = startP;
          endPageVal = endP;
        }

        let questionText = "";
        if (drill.totalQuestions > 0) {
          const startQ = (drill.currentQuestionProgress || 0) + 1;
          const baseDailyQ = (isNewDay && drill.tomorrowAmountOverride > 0) ? drill.tomorrowAmountOverride : (drill.dailyQuestionAmount || 0);
          const endQ = Math.min(startQ + baseDailyQ - 1, drill.totalQuestions);
          questionText = `Q:${startQ}〜${endQ}`;
          
          startQuestionVal = startQ;
          endQuestionVal = endQ;
        }

        let rangeText = "";
        if (pageText && questionText) {
          rangeText = `（${pageText} / ${questionText}）`;
        } else if (pageText) {
          rangeText = `（${pageText}）`;
        } else if (questionText) {
          rangeText = `（${questionText}）`;
        }

        drillTaskId = `drill_${drill.id}_${startPageVal}_${endPageVal}_${startQuestionVal}_${endQuestionVal}`;
        taskText = `${emoji} ${drill.category}：${drill.name}${rangeText}`;

        const extraAmount = drill.postponedAmount || 0;
        const baseDailyP = (isNewDay && drill.tomorrowAmountOverride > 0) ? drill.tomorrowAmountOverride : drill.dailyAmount;
        if (extraAmount > 0 && baseDailyP > 0) {
          const daysCount = 1 + Math.ceil(extraAmount / baseDailyP);
          taskText += ` (${daysCount}日分！)`;
        }
      }

      taskText += timingSuffix;

      const existIndex = tasks.findIndex(t => t.drillId === drill.id && t.date === todayDateStr);
      if (existIndex === -1) {
        tasks.push({
          id: drillTaskId,
          text: taskText,
          status: 'active',
          drillId: drill.id,
          startPage: startPageVal,
          endPage: endPageVal,
          startQuestion: startQuestionVal,
          endQuestion: endQuestionVal,
          category: drill.category || "べんきょう",
          description: drill.description || "",
          date: todayDateStr
        });
        updated = true;
      } else {
        const existingTask = tasks[existIndex];
        if (existingTask.status === 'active') {
          existingTask.id = drillTaskId;
          existingTask.text = taskText;
          existingTask.startPage = startPageVal;
          existingTask.endPage = endPageVal;
          existingTask.startQuestion = startQuestionVal;
          existingTask.endQuestion = endQuestionVal;
          existingTask.category = drill.category || "べんきょう";
          existingTask.description = drill.description || "";
          existingTask.date = todayDateStr;
          updated = true;
        }
      }
      if (isNewDay && drill.tomorrowAmountOverride > 0) {
        drill.tomorrowAmountOverride = 0;
      }
      drill.postponedAmount = 0;
    } else {
      // 2. 通常の予定
      const weeklyTaskId = `weekly_${schedule.id}_${todayDateStr}`;
      const existsAsReplaced = tasks.some(t => t.id && t.id.toString().startsWith(`weekly_${schedule.id}`) && t.postponeMode === 'replace');
      if (existsAsReplaced) return;

      activeWeeklyTaskIdsToday.add(weeklyTaskId);

      const exist = tasks.some(t => t.id === weeklyTaskId && t.date === todayDateStr);
      if (!exist) {
        tasks.push({
          id: weeklyTaskId,
          text: schedule.name,
          status: 'active',
          drillId: null,
          category: schedule.category || 'ならいごと',
          description: schedule.description || '',
          date: todayDateStr
        });
        updated = true;
      }
    }
  });

  const originalTaskCount = tasks.length;
  tasks = tasks.filter(task => {
    if (task.date && task.date !== todayDateStr) {
      return true;
    }
    if (task.isManual) {
      return true; // 手動追加されたタスクは自動削除・再生成しない
    }
    if (task.drillId !== null && task.drillId !== undefined) {
      return activeDrillIdsToday.has(task.drillId) || task.status === 'completed' || task.status === 'postponed' || task.status === 'deleted';
    } else if (task.id && task.id.toString().startsWith('weekly_')) {
      return activeWeeklyTaskIdsToday.has(task.id) || task.status === 'completed' || task.status === 'postponed' || task.status === 'deleted';
    }
    return true;
  });

  if (tasks.length !== originalTaskCount) {
    updated = true;
  }

  if (updated) {
    saveDrills();
    saveTasks();
  }
}

function addHistoryRecord(task, type = 'custom', actualAmount = null) {
  if (history.some(h => h.id === task.id)) return;

  let amount = 1;
  let unit = 'かい';
  
  if (task.drillId !== null && task.drillId !== undefined) {
    type = 'drill';
    const drill = drills.find(d => d.id === task.drillId);
    if (drill) {
      if (actualAmount !== null && actualAmount !== undefined) {
        amount = parseInt(actualAmount, 10);
      } else {
        if (drill.type === 'time') {
          amount = drill.duration;
        } else {
          amount = drill.dailyAmount;
        }
      }
      
      if (drill.type === 'time') {
        unit = drill.unit || '分';
      } else {
        if (drill.totalPages > 0) {
          unit = 'ページ';
        } else if (drill.totalQuestions > 0) {
          unit = '問';
        } else {
          unit = drill.unit || 'ページ';
        }
      }
    }
  } else {
    if (actualAmount !== null && actualAmount !== undefined) {
      amount = parseInt(actualAmount, 10);
    }
  }

  const record = {
    id: task.id,
    date: new Date().toLocaleDateString('ja-JP'),
    taskText: task.text,
    type: type,
    amount: amount,
    unit: unit
  };

  history.push(record);
  saveHistory();
}

function removeHistoryRecord(taskId) {
  history = history.filter(h => h.id !== taskId && h.id.toString() !== taskId.toString());
  saveHistory();
}

function addCompletedTask(task) {
  const todayStr = getTodayDateString();
  task.completedDate = todayStr;
  
  completedTasks = completedTasks.filter(t => t.id !== task.id && t.id.toString() !== task.id.toString());
  
  const taskClone = { ...task };
  completedTasks.push(taskClone);
  saveCompletedTasks();
}

function removeCompletedTask(task) {
  if (!task) return;
  const taskId = task.id;
  const todayStr = getTodayDateString();
  
  completedTasks = completedTasks.filter(t => {
    if (t.id === taskId || t.id.toString() === taskId.toString()) {
      return false;
    }
    
    if (t.completedDate === todayStr) {
      if (task.drillId !== null && task.drillId !== undefined) {
        if (t.drillId === task.drillId || (t.drillId && t.drillId.toString() === task.drillId.toString())) {
          return false;
        }
      }
      
      if (task.id && task.id.toString().startsWith('weekly_') && t.id && t.id.toString().startsWith('weekly_')) {
        const taskScheduleId = task.id.toString().split('_')[1];
        const tScheduleId = t.id.toString().split('_')[1];
        if (taskScheduleId && taskScheduleId === tScheduleId) {
          return false;
        }
      }
      
      if ((task.drillId === null || task.drillId === undefined) && !task.id.toString().startsWith('weekly_')) {
        if (t.text === task.text) {
          return false;
        }
      }
    }
    return true;
  });
  
  saveCompletedTasks();
}

function getTaskDuration(task) {
  const hist = history.find(h => h.id === task.id || h.id.toString() === task.id.toString());
  if (hist && (hist.unit === 'ぷん' || hist.unit === 'ふん' || hist.unit === '分')) {
    return parseInt(hist.amount, 10) || 0;
  }
  if (task.text) {
    const match = task.text.match(/(\d+)分/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  if (task.drillId !== null && task.drillId !== undefined) {
    const drill = drills.find(d => d.id === task.drillId);
    if (drill && drill.type === 'time') {
      return drill.duration;
    }
  }
  return 0;
}

function getWeeklyReportData() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thisWeekTasks = [];
  const lastWeekTasks = [];

  completedTasks.forEach(task => {
    if (!task.completedDate) return;

    const parts = task.completedDate.split('-');
    if (parts.length !== 3) return;
    const taskDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    taskDate.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - taskDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays >= 0 && diffDays < 7) {
      thisWeekTasks.push(task);
    } else if (diffDays >= 7 && diffDays < 14) {
      lastWeekTasks.push(task);
    }
  });

  return { thisWeekTasks, lastWeekTasks };
}

// がんばり記録（実績データ）のリセット処理
async function handleResetRecords() {
  const confirm1 = await showGameConfirm("これまでの がんばりのきろく（達成したミッション、がんばった時間、カレンダーの記録）を すべて消す？");
  if (confirm1) {
    const confirm2 = await showGameConfirm("本当に消しちゃう？ 消したきろくは もとに戻せないよ！ ⚠️");
    if (confirm2) {
      completedTasks = [];
      history = [];
      saveCompletedTasks();
      saveHistory();

      renderRecordTab();
      renderCalendar();
      updateUI(); // 進捗率リセット対応

      showGameToast("がんばり記録を リセットしたよ！🧹", "✨");
    }
  }
}

function updateTaskProgress(taskId, updates) {
  let task = tasks.find(t => t.id === taskId || t.id.toString() === taskId.toString());
  
  if (!task) {
    const cleanId = String(taskId).trim().toLowerCase();
    task = tasks.find(t => {
      if (t.status !== 'active') return false;
      if (t.drillId !== null && t.drillId !== undefined) {
        if (cleanId === t.drillId.toString() || cleanId === `drill_${t.drillId}`) {
          return true;
        }
        if (t.id && t.id.toString().toLowerCase().includes(cleanId)) {
          return true;
        }
      }
      if (t.text && t.text.toLowerCase().includes(cleanId)) {
        return true;
      }
      return false;
    });
  }
  
  if (!task) return false;
  
  let rangeChanged = false;
  if (updates.endPage !== undefined && updates.endPage !== null) {
    task.endPage = parseInt(updates.endPage, 10);
    rangeChanged = true;
  }
  if (updates.endQuestion !== undefined && updates.endQuestion !== null) {
    task.endQuestion = parseInt(updates.endQuestion, 10);
    rangeChanged = true;
  }
  if (updates.description !== undefined) {
    task.description = updates.description;
  }
  if (updates.status !== undefined) {
    task.status = updates.status;
  }
  
  if (rangeChanged && updates.text === undefined) {
    if (task.drillId !== null && task.drillId !== undefined) {
      const drill = drills.find(d => d.id === task.drillId);
      if (drill) {
        const emoji = getCategoryEmoji(task.category);
        let pageText = "";
        if (drill.totalPages > 0 && task.endPage > 0) {
          pageText = `P:${task.startPage}〜${task.endPage}`;
        }
        let questionText = "";
        if (drill.totalQuestions > 0 && task.endQuestion > 0) {
          questionText = `Q:${task.startQuestion}〜${task.endQuestion}`;
        }
        let rangeText = "";
        if (pageText && questionText) {
          rangeText = `（${pageText} / ${questionText}）`;
        } else if (pageText) {
          rangeText = `（${pageText}）`;
        } else if (questionText) {
          rangeText = `（${questionText}）`;
        }
        
        let timingSuffix = "";
        const suffixMatch = task.text.match(/\s*\([^)]+の(?:まえ|あと)\)$/);
        if (suffixMatch) {
          timingSuffix = suffixMatch[0];
        }
        
        task.text = `${emoji} ${task.category}：${drill.name}${rangeText}${timingSuffix}`;
      }
    }
  } else if (updates.text !== undefined) {
    task.text = updates.text;
  }
  
  saveTasks();
  renderTasks();
  return true;
}

function updateDrillDailyAmount(drillId, amount, isTemporary = false) {
  const drill = drills.find(d => d.id === drillId || d.id.toString() === drillId.toString());
  if (!drill) return false;
  
  if (isTemporary) {
    drill.tomorrowAmountOverride = parseInt(amount, 10);
  } else {
    drill.dailyAmount = parseInt(amount, 10);
  }
  
  saveDrills();
  return true;
}

function applyPartialPostpone(mode) {
  // AIチャット廃止のため、このロジックは単純に答え合わせ時の手動調整などで使用できるように残します
  if (!gameState.proposedPartialPostpone) return;
  
  const { taskId, completedEndPage, completedEndQuestion, remainingAmount } = gameState.proposedPartialPostpone;
  const task = tasks.find(t => t.id === taskId || t.id.toString() === taskId.toString());
  if (!task) return;

  const drill = drills.find(d => d.id === task.drillId);
  if (drill) {
    const updates = {};
    let rangeText = "";
    
    if (completedEndPage !== null && completedEndPage !== undefined) {
      updates.endPage = completedEndPage;
      rangeText += `P:${task.startPage}〜${completedEndPage}`;
    }
    if (completedEndQuestion !== null && completedEndQuestion !== undefined) {
      updates.endQuestion = completedEndQuestion;
      if (rangeText) rangeText += " / ";
      rangeText += `Q:${task.startQuestion}〜${completedEndQuestion}`;
    }
    
    const emoji = getCategoryEmoji(task.category);
    if (rangeText) {
      const drillName = task.text.split('：')[1] ? task.text.split('：')[1].split('（')[0].split('(')[0] : drill.name;
      updates.text = `${emoji} ${task.category}：${drillName}（${rangeText}）`;
    }
    
    updateTaskProgress(taskId, updates);
    
    task.status = 'completed';
    completeDrillTask(task);
    saveTasks();
    renderTasks();
    
    addHistoryRecord(task, 'drill');
    addCompletedTask(task);
    
    if (mode === 'add') {
      drill.postponedAmount = (drill.postponedAmount || 0) + remainingAmount;
      saveDrills();
    }
  }
  
  gameState.proposedPartialPostpone = null;
}

// 日付変更チェック
function checkDateChange() {
  const todayStr = new Date().toDateString();
  const lastOpened = storage.getItem('study_rpg_last_opened');
  
  if (lastOpened && lastOpened !== todayStr) {
    applyNextDayProgress();
  }
  storage.setItem('study_rpg_last_opened', todayStr);
}

// 日付変更時の進捗更新
function applyNextDayProgress() {
  const todayStr = getTodayDateString();
  tasks = tasks.filter(task => {
    if (task.status === 'deleted') {
      return false;
    }
    if (task.drillId !== null && task.drillId !== undefined) {
      if (task.status === 'postponed') {
        task.status = 'active';
        task.date = todayStr;
        return true;
      }
      return false;
    } else if (task.id && task.id.toString().startsWith('weekly_')) {
      if (task.status === 'postponed') {
        task.status = 'active';
        task.date = todayStr;
        return true;
      }
      return false;
    } else {
      if (task.status === 'completed') {
        return false;
      } else {
        task.status = 'active'; 
        task.date = todayStr;
        return true;
      }
    }
  });

  generateDailyTasks(true);
  saveTasks();
  renderTasks();
}

// 4. タスクの描画処理
function renderTasks() {
  const toggleBtn = document.getElementById('btn-toggle-simulation');
  if (toggleBtn) {
    if (gameState.simulationMode) {
      toggleBtn.textContent = '🏠 今日を見る';
      toggleBtn.style.backgroundColor = 'var(--color-primary-light)';
      toggleBtn.style.color = 'var(--color-primary)';
    } else {
      toggleBtn.textContent = '🌅 明日の予定';
      toggleBtn.style.backgroundColor = 'var(--color-secondary-light)';
      toggleBtn.style.color = 'var(--color-secondary)';
    }
  }

  taskListEl.innerHTML = '';
  
  if (gameState.simulationMode) {
    const banner = document.createElement('div');
    banner.className = 'simulation-banner';
    banner.innerHTML = `
      <div style="font-size: 0.95rem; font-weight: 700; color: var(--color-secondary);">🌅 翌日の予定シミュレーション中</div>
      <div style="font-size: 0.75rem; color: var(--color-text-light); margin-top: 2px;">「明日はこれだけ実施すれば完了」のリストです</div>
    `;
    taskListEl.appendChild(banner);
  }

  const todayDateStr = getTodayDateString();
  const tasksToRender = gameState.simulationMode ? getTomorrowSimulatedTasks() : tasks.filter(t => (!t.date || t.date === todayDateStr) && t.status !== 'deleted');
  
  tasksToRender.forEach(task => {
    if (currentCategoryFilter !== 'all' && task.category !== currentCategoryFilter) {
      return;
    }

    const li = document.createElement('li');
    let catClass = 'cat-help';
    if (task.category === 'べんきょう') catClass = 'cat-study';
    else if (task.category === 'ならいごと') catClass = 'cat-lesson';
    else if (task.category === 'しゅくだい') catClass = 'cat-homework';
    else if (task.category === 'れんしゅう') catClass = 'cat-practice';
    
    li.className = `task-item ${task.status} ${catClass}`;
    
    let leftControlHtml = '';
    if (gameState.simulationMode) {
      leftControlHtml = `<span class="postponed-badge" style="padding: 4px 8px; margin-right: 8px; font-size: 0.7rem;">明日</span>`;
    } else if (task.status === 'postponed') {
      leftControlHtml = `<span class="postponed-badge" style="background-color: #e9ecef; color: var(--color-text-light); border-radius: 4px; padding: 2px 6px; font-size: 0.7rem; margin-right: 8px;">明日実施</span>`;
    } else {
      const isChecked = task.status === 'completed' ? 'checked' : '';
      leftControlHtml = `
        <input type="checkbox" class="task-checkbox" data-id="${task.id}" ${isChecked}>
        <span class="custom-checkbox"></span>
      `;
    }
    
    let badgeHtml = '';
    if (task.category === 'べんきょう') badgeHtml = '<span class="task-cat-badge study" title="勉強">📚</span>';
    else if (task.category === 'ならいごと') badgeHtml = '<span class="task-cat-badge lesson" title="予定">🏆</span>';
    else if (task.category === 'しゅくだい') badgeHtml = '<span class="task-cat-badge homework" title="宿題">📝</span>';
    else if (task.category === 'れんしゅう') badgeHtml = '<span class="task-cat-badge practice" title="練習">🎹</span>';
    else if (task.category === 'おてつだい') badgeHtml = '<span class="task-cat-badge help" title="手伝い">🏠</span>';

    const hasDesc = task.description && task.description.trim().length > 0;
    const textClass = hasDesc ? 'task-text task-text-clickable' : 'task-text';
    const arrowHtml = hasDesc ? '<span class="task-desc-toggle-indicator">▶</span>' : '';
    
    const descHtml = hasDesc ? `<div class="task-desc-panel" style="display: none;">💡 メモ：${escapeHTML(task.description)}</div>` : '';

    const isSim = gameState.simulationMode;
    const canPostpone = !isSim && task.status === 'active';
    const canDelete = !isSim;

    let displayText = escapeHTML(task.text);
    const prefixRegex = /^([\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])?\s*(しゅくだい|べんきょう|れんしゅう|ならいごと|おてつだい)[\uff1a:]\s*/;
    displayText = displayText.replace(prefixRegex, "");

    let goalBadgeHtml = '';
    const isDone = task.status === 'completed';
    const hist = isDone ? history.find(h => h.id === task.id || h.id.toString() === task.id.toString()) : null;
    
    const pageMatch = displayText.match(/(?:（|\()(P:\d+(?:〜\d+)?)(?:）|\))/);
    if (pageMatch) {
      const val = pageMatch[1];
      if (isDone) {
        const displayVal = hist ? `実績: ${hist.amount}${hist.unit}` : `実績: ${(task.startPage && task.endPage) ? `P:${task.startPage}〜${task.endPage}` : val}`;
        goalBadgeHtml += `<span class="task-goal-badge page done">✅ ${displayVal}</span>`;
      } else {
        goalBadgeHtml += `<span class="task-goal-badge page">${val}</span>`;
      }
      displayText = displayText.replace(pageMatch[0], "").trim();
    }
    
    const questionMatch = displayText.match(/(?:（|\()(Q:\d+(?:〜\d+)?)(?:）|\))/);
    if (questionMatch) {
      const val = questionMatch[1];
      if (isDone) {
        const displayVal = hist ? `実績: ${hist.amount}${hist.unit}` : `実績: ${(task.startQuestion && task.endQuestion) ? `Q:${task.startQuestion}〜${task.endQuestion}` : val}`;
        goalBadgeHtml += `<span class="task-goal-badge question done">✅ ${displayVal}</span>`;
      } else {
        goalBadgeHtml += `<span class="task-goal-badge question">${val}</span>`;
      }
      displayText = displayText.replace(questionMatch[0], "").trim();
    }
    
    const timeMatch = displayText.match(/(?:（|\()(\d+分)(?:）|\))/);
    if (timeMatch) {
      const val = timeMatch[1];
      if (isDone) {
        const displayVal = hist ? `実績: ${hist.amount}${hist.unit}` : `実績: ${val}`;
        goalBadgeHtml += `<span class="task-goal-badge time done">✅ ${displayVal}</span>`;
      } else {
        goalBadgeHtml += `<span class="task-goal-badge time">${val}</span>`;
      }
      displayText = displayText.replace(timeMatch[0], "").trim();
    }

    displayText = displayText.replace(/(P:\d+〜\d+|P:\d+)/g, '<span class="task-page-highlight">$1</span>');
    displayText = displayText.replace(/(Q:\d+〜\d+|Q:\d+)/g, '<span class="task-question-highlight">$1</span>');
    displayText = displayText.replace(/(（|\()(\d+分)(）|\))/g, '$1<span class="task-time-highlight">$2</span>$3');

    li.innerHTML = `
      <div class="task-item-main">
        <label class="task-label">
          ${leftControlHtml}
          ${goalBadgeHtml}
          ${badgeHtml}
          <span class="task-text-wrapper">
            <span class="${textClass}">${displayText}${arrowHtml}</span>
          </span>
        </label>
        <div style="display: flex; gap: 4px; align-items: center;">
          ${task.status === 'postponed' ? `<button type="button" class="btn-revert-task" data-id="${task.id}" title="今日やる！に戻す" style="font-size:0.8rem; background:none; border:none; cursor:pointer;">↩️</button>` : ''}
          ${canPostpone ? `<button type="button" class="btn-postpone-task" data-id="${task.id}" title="明日に回す">📅</button>` : ''}
          ${canDelete ? `<button type="button" class="btn-delete-task" data-id="${task.id}" title="消去">🗑️</button>` : ''}
        </div>
      </div>
      ${descHtml}
    `;
    
    if (hasDesc) {
      const textEl = li.querySelector('.task-text');
      const descPanel = li.querySelector('.task-desc-panel');
      const arrowEl = li.querySelector('.task-desc-toggle-indicator');
      
      if (textEl && descPanel) {
        textEl.addEventListener('click', (e) => {
          e.preventDefault();
          const isVisible = descPanel.style.display === 'block';
          descPanel.style.display = isVisible ? 'none' : 'block';
          if (arrowEl) {
            if (isVisible) {
              arrowEl.classList.remove('open');
            } else {
              arrowEl.classList.add('open');
            }
          }
        });
      }
    }
    
    taskListEl.appendChild(li);
  });

  // 進捗率と日付をヘッダーに反映
  updateUI();
}

// 5. UIの更新処理 (進捗率の計算と描画)
function updateUI() {
  // 今日の日付の反映
  if (todayDateEl) {
    const today = new Date();
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    todayDateEl.textContent = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 (${days[today.getDay()]})`;
  }

  // 今日のタスク進捗率の反映
  const todayDateStr = getTodayDateString();
  const todayTasks = tasks.filter(t => (!t.date || t.date === todayDateStr) && t.status !== 'deleted');
  const totalCount = todayTasks.length;
  const completedCount = todayTasks.filter(t => t.status === 'completed').length;

  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  if (todayProgressBarEl) {
    todayProgressBarEl.style.width = `${percent}%`;
  }
  if (todayProgressTextEl) {
    todayProgressTextEl.textContent = `${percent}% (${completedCount}/${totalCount})`;
  }

  // はなまる・全完了判定
  if (totalCount > 0 && completedCount === totalCount) {
    if (!gameState.allCompletedDates.includes(todayDateStr)) {
      gameState.allCompletedDates.push(todayDateStr);
      saveAllCompletedDates();
      showCongratulationsModal();
      renderCalendar();
    }
  } else {
    // 完了を取り消した場合はリストから外す
    if (gameState.allCompletedDates.includes(todayDateStr)) {
      gameState.allCompletedDates = gameState.allCompletedDates.filter(d => d !== todayDateStr);
      saveAllCompletedDates();
      renderCalendar();
    }
  }
}

// 6. イベントリスナーの設定
function setupEventListeners() {
  // カテゴリ切り替えタブの監視
  const categoryTabContainer = document.getElementById('task-category-tabs');
  if (categoryTabContainer) {
    categoryTabContainer.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.category-tab-btn');
      if (tabBtn) {
        currentCategoryFilter = tabBtn.dataset.category;
        categoryTabContainer.querySelectorAll('.category-tab-btn').forEach(btn => {
          btn.classList.remove('active');
        });
        tabBtn.classList.add('active');
        renderTasks();
      }
    });
  }

  // タスク完了監視
  taskListEl.addEventListener('change', handleTaskCheck);
  // タスクの削除ボタン監視
  taskListEl.addEventListener('click', handleTaskDeleteClick);
  // タスク追加
  addTaskFormEl.addEventListener('submit', handleAddTask);

  // タスク追加用プルダウンの連動
  const newTaskDrillSelectEl = document.getElementById('new-task-drill-select');
  if (newTaskDrillSelectEl) {
    newTaskDrillSelectEl.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'custom') {
        newTaskInputEl.value = '';
        newTaskInputEl.disabled = false;
        newTaskCategoryEl.disabled = false;
      } else if (val.startsWith('drill:')) {
        const drillId = parseInt(val.split(':')[1], 10);
        const drill = drills.find(d => d.id === drillId);
        if (drill) {
          let startPageVal = (drill.currentProgress || 0) + 1;
          let startQuestionVal = (drill.currentQuestionProgress || 0) + 1;
          let taskText = "";
          
          if (drill.type === 'time') {
            taskText = `${drill.name}（${drill.duration}分）`;
          } else {
            let pageText = "";
            if (drill.totalPages > 0) {
              const tomorrowPages = drill.tomorrowAmountOverride > 0 ? drill.tomorrowAmountOverride : drill.dailyAmount;
              const endP = Math.min(startPageVal + tomorrowPages - 1, drill.totalPages);
              pageText = `P:${startPageVal}〜${endP}`;
            }
            let questionText = "";
            if (drill.totalQuestions > 0) {
              const tomorrowQs = (drill.tomorrowAmountOverride > 0 && drill.type === 'question') ? drill.tomorrowAmountOverride : drill.dailyQuestionAmount;
              const endQ = Math.min(startQuestionVal + tomorrowQs - 1, drill.totalQuestions);
              questionText = `Q:${startQuestionVal}〜${endQ}`;
            }
            let rangeText = "";
            if (pageText && questionText) {
              rangeText = `（${pageText} / ${questionText}）`;
            } else if (pageText) {
              rangeText = `（${pageText}）`;
            } else if (questionText) {
              rangeText = `（${questionText}）`;
            }
            taskText = `${drill.name}${rangeText}`;
          }
          newTaskInputEl.value = taskText;
          newTaskInputEl.disabled = true;
          newTaskCategoryEl.value = drill.category;
          newTaskCategoryEl.disabled = true;
        }
      } else if (val.startsWith('schedule:')) {
        const scheduleId = val.split(':')[1];
        const schedule = gameState.weeklySchedules.find(s => s.id === scheduleId || s.id.toString() === scheduleId);
        if (schedule) {
          newTaskInputEl.value = schedule.name;
          newTaskInputEl.disabled = true;
          newTaskCategoryEl.value = schedule.category;
          newTaskCategoryEl.disabled = true;
        }
      }
    });
  }

  // ドリル設定の制御
  drillFormEl.addEventListener('submit', handleAddDrill);

  // スケジュール設定の制御
  if (scheduleFormEl) scheduleFormEl.addEventListener('submit', handleAddWeeklySchedule);

  // 時間割タブの切り替え制御
  const scheduleTabContainer = document.querySelector('.schedule-tab-container');
  if (scheduleTabContainer) {
    scheduleTabContainer.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.btn-choice');
      if (tabBtn) {
        currentScheduleTabDay = tabBtn.dataset.day;
        scheduleTabContainer.querySelectorAll('.btn-choice').forEach(b => b.classList.remove('active'));
        tabBtn.classList.add('active');
        renderRegisteredSchedulesList();
      }
    });
  }

  // iPadOS Safariでの選択肢ピッカー表示バグ・キャッシュ対策：タップ・フォーカス時に最新選択肢を動的更新
  if (newTaskDrillSelectEl) {
    const refreshDrillOptions = () => renderNewTaskDrillOptions();
    newTaskDrillSelectEl.addEventListener('focus', refreshDrillOptions);
    newTaskDrillSelectEl.addEventListener('pointerdown', refreshDrillOptions);
    newTaskDrillSelectEl.addEventListener('touchstart', refreshDrillOptions);
  }

  // 答え合わせモーダル制御
  btnAllCorrectEl.addEventListener('click', handleAllCorrect);
  checkFormEl.addEventListener('submit', handleSubmitMistake);
  if (btnCloseCheckModalEl) btnCloseCheckModalEl.addEventListener('click', closeCheckAnswerModal);

  // タブ切り替え
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.dataset.tab;
      
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const tabContents = document.querySelectorAll('.tab-content');
      tabContents.forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
      });
      
      const targetContent = document.getElementById(targetTabId);
      if (targetContent) {
        targetContent.classList.add('active');
        targetContent.style.display = 'flex';
      }
      
      if (targetTabId === 'record-tab') {
        renderRecordTab();
      } else if (targetTabId === 'settings-tab') {
        renderSettingsTab();
      }
    });
  });

  // ユーザー管理モーダルの制御
  if (btnUserSwitchEl) btnUserSwitchEl.addEventListener('click', openUserModal);
  if (btnCloseUserModalEl) btnCloseUserModalEl.addEventListener('click', closeUserModal);
  if (userFormEl) userFormEl.addEventListener('submit', handleAddUser);

  // 達成おめでとうモーダルの制御
  const btnCloseCongratulations = document.getElementById('btn-close-congratulations');
  if (btnCloseCongratulations) {
    btnCloseCongratulations.addEventListener('click', closeCongratulationsModal);
  }

  // ウィークリーレポート（週次集計）のトグル切り替え
  const btnToggleWeeklyReport = document.getElementById('btn-toggle-weekly-report');
  if (btnToggleWeeklyReport) {
    btnToggleWeeklyReport.addEventListener('click', () => {
      gameState.weeklyReportMode = gameState.weeklyReportMode === 'thisWeek' ? 'lastWeek' : 'thisWeek';
      renderRecordTab();
    });
  }

  // がんばり記録（実績データ）のリセットボタン
  const btnResetRecords = document.getElementById('btn-reset-records');
  if (btnResetRecords) {
    btnResetRecords.addEventListener('click', handleResetRecords);
  }

  // プロフィール編集モーダルの制御
  const btnUserEditEl = document.getElementById('btn-user-edit');
  const btnCloseProfileModalEl = document.getElementById('btn-close-profile-modal');
  const btnCancelProfileEl = document.getElementById('btn-cancel-profile');
  const profileFormEl = document.getElementById('profile-form');

  if (btnUserEditEl) btnUserEditEl.addEventListener('click', openProfileModal);
  if (btnCloseProfileModalEl) btnCloseProfileModalEl.addEventListener('click', closeProfileModal);
  if (btnCancelProfileEl) btnCancelProfileEl.addEventListener('click', closeProfileModal);
  if (profileFormEl) profileFormEl.addEventListener('submit', handleSaveProfile);

  // タスク繰り越し（延期）モーダルの制御
  const btnCloseCarryoverModalEl = document.getElementById('btn-close-carryover-modal');
  const btnCancelCarryoverEl = document.getElementById('btn-cancel-carryover');
  const btnCarryoverAddEl = document.getElementById('btn-carryover-add');
  const btnCarryoverReplaceEl = document.getElementById('btn-carryover-replace');

  if (btnCloseCarryoverModalEl) btnCloseCarryoverModalEl.addEventListener('click', closeCarryoverModal);
  if (btnCancelCarryoverEl) btnCancelCarryoverEl.addEventListener('click', closeCarryoverModal);
  if (btnCarryoverAddEl) btnCarryoverAddEl.addEventListener('click', () => handleCarryoverChoice('add'));
  if (btnCarryoverReplaceEl) btnCarryoverReplaceEl.addEventListener('click', () => handleCarryoverChoice('replace'));

  // タスクリストの「明日に回す」ボタンイベント委譲
  taskListEl.addEventListener('click', handleTaskPostponeClick);
  taskListEl.addEventListener('click', handleTaskRevertClick);

  // シミュレーション切り替えボタンの制御
  const btnToggleSimulationEl = document.getElementById('btn-toggle-simulation');
  if (btnToggleSimulationEl) {
    btnToggleSimulationEl.addEventListener('click', handleToggleSimulation);
  }

  // 答え合わせモーダル内の写真アップロード制御
  if (btnTriggerUploadEl) {
    btnTriggerUploadEl.addEventListener('click', () => {
      if (mistakeImageInputEl) mistakeImageInputEl.click();
    });
  }
  if (mistakeImageInputEl) {
    mistakeImageInputEl.addEventListener('change', handleImageSelect);
  }
  if (btnRemoveImageEl) {
    btnRemoveImageEl.addEventListener('click', handleImageRemove);
  }

  // 設定内子タブ切り替え
  const settingsTabButtons = document.querySelectorAll('#settings-tab .sub-tab-btn');
  settingsTabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchSettingsSubTab(btn.dataset.subtab);
    });
  });

  // きろく内子タブ切り替え
  const recordsSubTabButtons = document.querySelectorAll('.records-sub-tab-btn');
  recordsSubTabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchRecordsSubTab(btn.dataset.subtab);
    });
  });

  // カレンダーの前月・翌月切り替えボタンの監視
  const btnPrevMonth = document.getElementById('btn-prev-month');
  const btnNextMonth = document.getElementById('btn-next-month');
  if (btnPrevMonth) {
    btnPrevMonth.addEventListener('click', () => {
      calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() - 1);
      renderCalendar();
    });
  }
  if (btnNextMonth) {
    btnNextMonth.addEventListener('click', () => {
      calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + 1);
      renderCalendar();
    });
  }

  // 目標タイプ選択切り替え制御
  if (drillTypeSelectEl) {
    drillTypeSelectEl.addEventListener('change', (e) => {
      const type = e.target.value;
      const pageRow = document.getElementById('drill-page-fields-row');
      const questionRow = document.getElementById('drill-question-fields-row');
      const timeRow = document.getElementById('drill-time-fields-row');
      const pageLabel = document.getElementById('drill-page-fields-label');
      const questionLabel = document.getElementById('drill-question-fields-label');
      
      if (pageRow && questionRow && timeRow) {
        if (type === 'page') {
          pageRow.style.display = 'flex';
          questionRow.style.display = 'flex';
          timeRow.style.display = 'none';
          if (pageLabel) pageLabel.style.display = 'block';
          if (questionLabel) questionLabel.style.display = 'block';
          
          if (drillTotalInputEl) drillTotalInputEl.required = false;
          if (drillStartInputEl) drillStartInputEl.required = false;
          if (drillDailyInputEl) drillDailyInputEl.required = false;
          if (drillTotalQuestionsInputEl) drillTotalQuestionsInputEl.required = false;
          if (drillStartQuestionInputEl) drillStartQuestionInputEl.required = false;
          if (drillDailyQuestionsInputEl) drillDailyQuestionsInputEl.required = false;
          if (drillDurationInputEl) drillDurationInputEl.required = false;
        } else {
          pageRow.style.display = 'none';
          questionRow.style.display = 'none';
          timeRow.style.display = 'block';
          if (pageLabel) pageLabel.style.display = 'none';
          if (questionLabel) questionLabel.style.display = 'none';
          
          if (drillTotalInputEl) drillTotalInputEl.required = false;
          if (drillStartInputEl) drillStartInputEl.required = false;
          if (drillDailyInputEl) drillDailyInputEl.required = false;
          if (drillTotalQuestionsInputEl) drillTotalQuestionsInputEl.required = false;
          if (drillStartQuestionInputEl) drillStartQuestionInputEl.required = false;
          if (drillDailyQuestionsInputEl) drillDailyQuestionsInputEl.required = false;
          if (drillDurationInputEl) drillDurationInputEl.required = true;
        }
      }

      const btns = document.querySelectorAll('.goal-type-btn');
      btns.forEach(b => {
        if (b.dataset.type === type) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
    });
  }

  // もくひょうの種類ボタン
  const goalTypeBtns = document.querySelectorAll('.goal-type-btn');
  if (goalTypeBtns.length > 0 && drillTypeSelectEl) {
    goalTypeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        drillTypeSelectEl.value = btn.dataset.type;
        drillTypeSelectEl.dispatchEvent(new Event('change'));
      });
    });
  }

  // カテゴリ選択ボタン
  const categoryChoiceBtns = document.querySelectorAll('.category-choice-btn');
  if (categoryChoiceBtns.length > 0 && drillCategorySelectEl) {
    categoryChoiceBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        drillCategorySelectEl.value = btn.dataset.category;
        drillCategorySelectEl.dispatchEvent(new Event('change'));
      });
    });
  }

  if (drillCategorySelectEl) {
    drillCategorySelectEl.addEventListener('change', (e) => {
      const cat = e.target.value;
      const btns = document.querySelectorAll('.category-choice-btn');
      btns.forEach(b => {
        if (b.dataset.category === cat) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
    });
  }

  // 時間割登録でのドリル選択
  const scheduleDrillSelectEl = document.getElementById('schedule-drill-select');
  if (scheduleDrillSelectEl) {
    scheduleDrillSelectEl.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'custom') {
        scheduleNameInputEl.value = '';
        scheduleNameInputEl.disabled = false;
        scheduleCategorySelectEl.disabled = false;
      } else {
        const drill = drills.find(d => d.id === parseInt(val, 10));
        if (drill) {
          scheduleNameInputEl.value = drill.name;
          scheduleNameInputEl.disabled = true;
          scheduleCategorySelectEl.value = drill.category;
          scheduleCategorySelectEl.disabled = true;
        }
      }
    });
  }

  // アーカイブアコーディオン
  const archiveAccordionHeader = document.getElementById('archive-accordion-header');
  const archivedDrillsList = document.getElementById('archived-drills-list');
  if (archiveAccordionHeader && archivedDrillsList) {
    archiveAccordionHeader.addEventListener('click', () => {
      const isHidden = window.getComputedStyle(archivedDrillsList).display === 'none';
      archivedDrillsList.style.display = isHidden ? 'flex' : 'none';
      const arrow = archiveAccordionHeader.querySelector('.archive-accordion-arrow');
      if (arrow) {
        arrow.textContent = isHidden ? '▲' : '▼';
      }
    });
  }

  // 登録済みドリルアコーディオン
  const registeredDrillsAccordionHeader = document.getElementById('registered-drills-accordion-header');
  const registeredDrillsList = document.getElementById('registered-drills-list');
  if (registeredDrillsAccordionHeader && registeredDrillsList) {
    registeredDrillsAccordionHeader.addEventListener('click', () => {
      const isHidden = window.getComputedStyle(registeredDrillsList).display === 'none';
      registeredDrillsList.style.display = isHidden ? 'flex' : 'none';
      const arrow = registeredDrillsAccordionHeader.querySelector('.active-drills-accordion-arrow');
      if (arrow) {
        arrow.textContent = isHidden ? '▲' : '▼';
      }
    });
  }
}

// ドリルの新規追加・更新処理
function handleAddDrill(event) {
  event.preventDefault();

  const idInput = document.getElementById('drill-id-input');
  const editingId = idInput ? idInput.value : "";

  const name = drillNameInputEl.value.trim();
  const type = drillTypeSelectEl.value;
  const category = drillCategorySelectEl.value;
  const timing = document.getElementById('drill-timing-select').value;
  const description = drillDescInputEl.value.trim();

  if (!name) {
    showGameToast("ドリルのなまえを 入力してね！", "⚠️");
    return;
  }

  let drillObj;
  let isEditing = false;

  if (editingId) {
    const drillIdNum = parseInt(editingId, 10);
    const existing = drills.find(d => d.id === drillIdNum);
    if (existing) {
      drillObj = existing;
      isEditing = true;
    }
  }

  if (!isEditing) {
    drillObj = {
      id: Date.now(),
      currentProgress: 0,
      currentQuestionProgress: 0,
      postponedAmount: 0
    };
  }

  drillObj.name = name;
  drillObj.type = type;
  drillObj.category = category;
  drillObj.timing = timing;
  drillObj.description = description;

  if (type === 'page') {
    const totalPages = parseInt(drillTotalInputEl.value, 10) || 0;
    const startPage = parseInt(drillStartInputEl.value, 10) || 1;
    const dailyAmount = parseInt(drillDailyInputEl.value, 10) || 0;

    const totalQuestions = parseInt(drillTotalQuestionsInputEl.value, 10) || 0;
    const startQuestion = parseInt(drillStartQuestionInputEl.value, 10) || 1;
    const dailyQuestionAmount = parseInt(drillDailyQuestionsInputEl.value, 10) || 0;

    const hasPageConfig = totalPages > 0 && dailyAmount > 0;
    const hasQuestionConfig = totalQuestions > 0 && dailyQuestionAmount > 0;

    if (!hasPageConfig && !hasQuestionConfig) {
      showGameToast("ページ数 または 問題数を 設定してね！", "⚠️");
      return;
    }

    drillObj.totalPages = totalPages;
    drillObj.startPage = startPage;
    drillObj.dailyAmount = dailyAmount;
    drillObj.unit = "ページ";

    drillObj.totalQuestions = totalQuestions;
    drillObj.startQuestion = startQuestion;
    drillObj.dailyQuestionAmount = dailyQuestionAmount;

    if (!isEditing) {
      drillObj.currentProgress = Math.max(0, startPage - 1);
      drillObj.currentQuestionProgress = Math.max(0, startQuestion - 1);
    } else {
      drillObj.currentProgress = Math.max(0, startPage - 1);
      drillObj.currentProgress = Math.min(drillObj.currentProgress, totalPages);
      drillObj.currentQuestionProgress = Math.max(0, startQuestion - 1);
      drillObj.currentQuestionProgress = Math.min(drillObj.currentQuestionProgress, totalQuestions);
    }
    drillObj.duration = 0;
  } else {
    const duration = parseInt(drillDurationInputEl.value, 10) || 0;
    if (duration <= 0) {
      showGameToast("1回に何分するかを 入力してね！", "⏱️");
      return;
    }

    drillObj.duration = duration;
    drillObj.unit = "分";
    drillObj.totalPages = 0;
    drillObj.startPage = 0;
    drillObj.dailyAmount = 0;
    drillObj.totalQuestions = 0;
    drillObj.startQuestion = 0;
    drillObj.dailyQuestionAmount = 0;
    if (isEditing) {
      drillObj.currentProgress = 0;
      drillObj.currentQuestionProgress = 0;
    }
  }

  if (!isEditing) {
    drills.push(drillObj);
  }

  saveDrills();

  if (isEditing) {
    let scheduleUpdated = false;
    gameState.weeklySchedules.forEach(schedule => {
      if (schedule.drillId === drillObj.id || (schedule.drillId && schedule.drillId.toString() === drillObj.id.toString())) {
        schedule.name = drillObj.name;
        schedule.category = drillObj.category;
        scheduleUpdated = true;
      }
    });
    if (scheduleUpdated) {
      saveWeeklySchedule();
    }
    
    generateDailyTasks();
    renderTasks();
    showGameToast("ドリルを更新したよ！✨", "🎒");
  } else {
    showGameToast("ドリルを登録したよ！✨", "🎒");
  }
  
  renderDrillSettingsList();
  renderScheduleDrillOptions();
  renderNewTaskDrillOptions();
  
  drillFormEl.reset();
  if (idInput) idInput.value = "";
  
  const addDrillBtn = document.getElementById('btn-add-drill');
  if (addDrillBtn) addDrillBtn.textContent = '✨ 登録する';

  const formTitle = drillFormEl.querySelector('.form-sub-title');
  if (formTitle) formTitle.textContent = '✏️ あたらしく 登録する';
  
  drillCategorySelectEl.value = "べんきょう";
  drillCategorySelectEl.dispatchEvent(new Event('change'));
  drillTypeSelectEl.value = "page";
  drillTypeSelectEl.dispatchEvent(new Event('change'));
  document.getElementById('drill-timing-select').value = "any";
}

// 画像圧縮 & プレビュー表示
function handleImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const maxDim = 300;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxDim) {
          height *= maxDim / width;
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
      gameState.currentCheckingImage = compressedBase64;
      
      if (mistakeImagePreviewEl) mistakeImagePreviewEl.src = compressedBase64;
      if (imagePreviewWrapperEl) imagePreviewWrapperEl.style.display = 'block';
      if (btnTriggerUploadEl) btnTriggerUploadEl.style.display = 'none';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function handleImageRemove() {
  gameState.currentCheckingImage = null;
  if (mistakeImagePreviewEl) mistakeImagePreviewEl.src = '';
  if (imagePreviewWrapperEl) imagePreviewWrapperEl.style.display = 'none';
  if (btnTriggerUploadEl) btnTriggerUploadEl.style.display = 'flex';
  if (mistakeImageInputEl) mistakeImageInputEl.value = '';
}

// 間違いの記録保存
function addMistakeRecord(drillName, mistakeText, mistakeType, imageBase64, status = "pending") {
  const record = {
    id: `mistake_${Date.now()}`,
    date: new Date().toLocaleDateString('ja-JP'),
    drillName: drillName,
    mistakeText: mistakeText,
    mistakeType: mistakeType || "その他",
    imageUrl: imageBase64 || null,
    status: status
  };

  gameState.mistakeRecords.push(record);
  
  if (gameState.mistakeRecords.length > 30) { // シンプル版では履歴数を30までに拡張
    gameState.mistakeRecords.shift();
  }

  storage.setItem(getUserKey('mistake_records'), JSON.stringify(gameState.mistakeRecords));
  if (firebaseEnabled && currentFirebaseUser) saveAllDataToCloud();
}

// タスクの手動削除処理
async function handleTaskDeleteClick(event) {
  const deleteBtn = event.target.closest('.btn-delete-task');
  if (deleteBtn) {
    const taskIdStr = deleteBtn.dataset.id;
    const task = tasks.find(t => t.id === taskIdStr || t.id.toString() === taskIdStr);
    
    let taskName = "このタスク";
    if (task) {
      taskName = task.text.replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "").trim();
      const parts = taskName.split('：');
      taskName = parts[parts.length - 1] || taskName;
      taskName = taskName.split('（')[0].split('(')[0].trim();
    }
    
    if (await showGameConfirm(`「${taskName}」を本当に削除しますか？`)) {
      if (task) {
        // もし完了済みのタスクを削除する場合、実績と履歴からも削除する
        if (task.status === 'completed') {
          removeHistoryRecord(task.id);
          removeCompletedTask(task);
          
          if (task.drillId !== null && task.drillId !== undefined) {
            revertDrillTask(task);
          }
        }
      }

      if (task) {
        task.status = 'deleted';
      } else {
        tasks = tasks.filter(t => t.id !== taskIdStr && t.id.toString() !== taskIdStr);
      }
      saveTasks();
      renderTasks();
      updateUI();

      // きろくタブ表示中の場合はリアルタイムでカレンダーなどを更新
      const recordTab = document.getElementById('record-tab');
      if (recordTab && recordTab.classList.contains('active')) {
        renderRecordTab();
      }
    }
  }
}

// タスクのチェック処理 (答え合わせモーダルの割り込み)
function handleTaskCheck(event) {
  if (event.target.classList.contains('task-checkbox')) {
    const checkbox = event.target;
    const taskIdStr = checkbox.dataset.id;

    const task = tasks.find(t => t.id === taskIdStr || t.id.toString() === taskIdStr);
    if (!task) return;

    if (checkbox.checked) {
      if (task.drillId !== null && task.drillId !== undefined) {
        const drill = drills.find(d => d.id === task.drillId);
        if (drill) {
          checkbox.checked = false;
          openCheckAnswerModal(task);
          return;
        }
      }

      task.status = 'completed';
      const taskItem = checkbox.closest('.task-item');
      if (taskItem) {
        taskItem.classList.add('completed');
      }

      addHistoryRecord(task, 'custom');
      addCompletedTask(task);
      updateUI();
      
      // きろくタブ表示中の場合はリアルタイムでカレンダーなどを更新
      const recordTab = document.getElementById('record-tab');
      if (recordTab && recordTab.classList.contains('active')) {
        renderRecordTab();
      }
    } else {
      task.status = 'active';
      const taskItem = checkbox.closest('.task-item');
      if (taskItem) {
        taskItem.classList.remove('completed');
      }

      removeHistoryRecord(task.id);
      removeCompletedTask(task);
      
      if (task.drillId !== null && task.drillId !== undefined) {
        revertDrillTask(task);
      }
      updateUI();
      
      // きろくタブ表示中の場合はリアルタイムでカレンダーなどを更新
      const recordTab = document.getElementById('record-tab');
      if (recordTab && recordTab.classList.contains('active')) {
        renderRecordTab();
      }
    }
    
    saveTasks();
  }
}

// 新規カスタムタスクの追加
function handleAddTask(event) {
  event.preventDefault();
  
  const taskText = newTaskInputEl.value.trim();
  const categoryValue = newTaskCategoryEl ? newTaskCategoryEl.value : "おてつだい";
  const descValue = newTaskDescEl ? newTaskDescEl.value.trim() : "";
  
  if (taskText) {
    const newTaskDrillSelectEl = document.getElementById('new-task-drill-select');
    const selectVal = newTaskDrillSelectEl ? newTaskDrillSelectEl.value : 'custom';
    
    let drillId = null;
    let taskId = `custom_${Date.now()}`;
    
    let startPageVal = 0;
    let endPageVal = 0;
    let startQuestionVal = 0;
    let endQuestionVal = 0;

    if (selectVal.startsWith('drill:')) {
      drillId = parseInt(selectVal.split(':')[1], 10);
      const drill = drills.find(d => d.id === drillId);
      if (drill) {
        startPageVal = (drill.currentProgress || 0) + 1;
        startQuestionVal = (drill.currentQuestionProgress || 0) + 1;
        
        let tomorrowPages = drill.tomorrowAmountOverride > 0 ? drill.tomorrowAmountOverride : drill.dailyAmount;
        let tomorrowQs = (drill.tomorrowAmountOverride > 0 && drill.type === 'question') ? drill.tomorrowAmountOverride : drill.dailyQuestionAmount;
        
        endPageVal = Math.min(startPageVal + tomorrowPages - 1, drill.totalPages);
        endQuestionVal = Math.min(startQuestionVal + tomorrowQs - 1, drill.totalQuestions);
        
        taskId = `drill_${drill.id}_${startPageVal}_${endPageVal}_${startQuestionVal}_${endQuestionVal}`;
      }
    } else if (selectVal.startsWith('schedule:')) {
      const scheduleId = selectVal.split(':')[1];
      taskId = `weekly_${scheduleId}_${getTodayDateString()}`;
    }
    
    const taskObj = {
      id: taskId,
      text: taskText,
      status: 'active',
      drillId: drillId,
      category: categoryValue,
      description: descValue,
      date: getTodayDateString(),
      isManual: true
    };

    if (drillId !== null && drillId !== undefined) {
      taskObj.startPage = startPageVal;
      taskObj.endPage = endPageVal;
      taskObj.startQuestion = startQuestionVal;
      taskObj.endQuestion = endQuestionVal;
    }

    tasks.push(taskObj);
    
    saveTasks();
    renderTasks();
    
    // リセット処理
    newTaskInputEl.value = '';
    newTaskInputEl.disabled = false;
    if (newTaskDescEl) newTaskDescEl.value = '';
    if (newTaskCategoryEl) {
      newTaskCategoryEl.value = 'おてつだい';
      newTaskCategoryEl.disabled = false;
    }
    if (newTaskDrillSelectEl) {
      newTaskDrillSelectEl.value = 'custom';
    }
    
    updateUI();
  }
}

// 設定サブタブの切り替え
function switchSettingsSubTab(subTabName) {
  const subTabButtons = document.querySelectorAll('#settings-tab .sub-tab-btn');
  subTabButtons.forEach(btn => {
    if (btn.dataset.subtab === subTabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const allSubContents = document.querySelectorAll('#settings-tab .settings-sub-content');
  allSubContents.forEach(el => { el.style.display = 'none'; });

  const targetEl = document.getElementById('sub-tab-' + subTabName);
  if (targetEl) {
    targetEl.style.display = 'flex';
  }

  if (subTabName === 'drills') {
    renderDrillSettingsList();
  } else if (subTabName === 'schedule') {
    renderScheduleDrillOptions();
    renderRegisteredSchedulesList();
  }
}

// きろくサブタブの切り替え
function switchRecordsSubTab(subTabName) {
  const subTabButtons = document.querySelectorAll('.records-sub-tab-btn');
  subTabButtons.forEach(btn => {
    if (btn.dataset.subtab === subTabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const subTabSummary = document.getElementById('sub-tab-records-summary');
  const subTabNigate = document.getElementById('sub-tab-records-nigate');
  const subTabCalendar = document.getElementById('sub-tab-records-calendar');
  
  if (subTabSummary && subTabNigate) {
    if (subTabName === 'records-summary') {
      subTabSummary.style.display = 'flex';
      subTabNigate.style.display = 'none';
      if (subTabCalendar) subTabCalendar.style.display = 'none';
    } else if (subTabName === 'records-nigate') {
      subTabSummary.style.display = 'none';
      subTabNigate.style.display = 'flex';
      if (subTabCalendar) subTabCalendar.style.display = 'none';
      renderNigateReport();
      renderNigateBuster();
    } else if (subTabName === 'records-calendar') {
      subTabSummary.style.display = 'none';
      subTabNigate.style.display = 'none';
      if (subTabCalendar) {
        subTabCalendar.style.display = 'flex';
        renderCalendar();
      }
    }
  }
}

// 設定タブの初期描画
function renderSettingsTab() {
  updateDrillTimingSelectOptions();
  renderDrillSettingsList();
  renderScheduleDrillOptions();
  renderRegisteredSchedulesList();

  const activeSubTab = document.querySelector('.sub-tab-btn.active');
  const activeSubTabName = activeSubTab ? activeSubTab.dataset.subtab : 'drills';
  switchSettingsSubTab(activeSubTabName);
}

function updateDrillTimingSelectOptions() {
  const selectEl = document.getElementById('drill-timing-select');
  if (!selectEl) return;

  const currentValue = selectEl.value;
  selectEl.innerHTML = `
    <option value="any" selected>⏰ 指定なし</option>
    <option value="before_lesson">🎒 予定（習い事等）の前</option>
    <option value="after_lesson">🎒 予定（習い事等）の後</option>
  `;

  const addedLessons = new Set();
  const schedules = gameState.weeklySchedules || [];
  schedules.forEach(schedule => {
    if (schedule.name) {
      const name = schedule.name.trim();
      if (!addedLessons.has(name)) {
        addedLessons.add(name);
        
        let catEmoji = getCategoryEmoji(schedule.category);
        const beforeOpt = document.createElement('option');
        beforeOpt.value = `before_schedule:${name}`;
        beforeOpt.textContent = `${catEmoji} ${name} の前`;

        const afterOpt = document.createElement('option');
        afterOpt.value = `after_schedule:${name}`;
        afterOpt.textContent = `${catEmoji} ${name} の後`;

        selectEl.appendChild(beforeOpt);
        selectEl.appendChild(afterOpt);
      }
    }
  });

  const options = Array.from(selectEl.options).map(o => o.value);
  if (options.includes(currentValue)) {
    selectEl.value = currentValue;
  }
}

let currentScheduleTabDay = "all";

// 登録済み固定スケジュール一覧の描画
function renderRegisteredSchedulesList() {
  if (!registeredSchedulesListEl) return;
  registeredSchedulesListEl.innerHTML = '';
  
  const days = ["月", "火", "水", "木", "金", "土", "日"];
  let hasItems = false;
  
  days.forEach(day => {
    if (currentScheduleTabDay !== "all" && currentScheduleTabDay !== day) return;
    
    const daySchedules = gameState.weeklySchedules.filter(s => s.days.includes(day));
    daySchedules.forEach(schedule => {
      hasItems = true;
      const li = document.createElement('li');
      li.className = 'schedule-settings-item';
      
      const descText = schedule.description ? `<span class="schedule-item-desc">💡 ${escapeHTML(schedule.description)}</span>` : '';
      let catEmoji = getCategoryEmoji(schedule.category);
      let nameText = escapeHTML(schedule.name);
      
      if (schedule.drillId) {
        nameText = `📚 ${nameText} (ドリル)`;
      } else {
        nameText = `${catEmoji} ${nameText}`;
      }

      li.innerHTML = `
        <div class="schedule-item-info">
          <div class="schedule-item-name-row">
            <span class="schedule-day-badge" style="background:#e9ecef; padding:2px 6px; font-size:0.75rem; font-weight:700; margin-right:6px; border-radius:4px;">${day}</span>
            <span class="schedule-item-name">${nameText}</span>
          </div>
          ${descText}
        </div>
        <div class="schedule-item-actions" style="display:flex; gap:4px;">
          <button type="button" class="btn-edit-schedule" data-id="${schedule.id}" style="background:none; border:none; cursor:pointer;" title="編集">✏️</button>
          <button type="button" class="btn-delete-schedule" data-id="${schedule.id}" style="background:none; border:none; cursor:pointer;" title="削除">🗑️</button>
        </div>
      `;
      
      li.querySelector('.btn-edit-schedule').addEventListener('click', (e) => {
        const id = e.target.closest('.btn-edit-schedule').dataset.id;
        startEditWeeklySchedule(id);
      });
      
      li.querySelector('.btn-delete-schedule').addEventListener('click', (e) => {
        const id = e.target.closest('.btn-delete-schedule').dataset.id;
        deleteWeeklySchedule(id);
      });
      
      registeredSchedulesListEl.appendChild(li);
    });
  });
  
  if (!hasItems) {
    registeredSchedulesListEl.innerHTML = `<li style="font-size:0.85rem; color:var(--color-text-light); text-align:center; padding:10px;">登録されている予定はありません。</li>`;
  }
}

// 固定スケジュールの追加・更新
function handleAddWeeklySchedule(event) {
  event.preventDefault();
  
  const checkedBoxes = document.querySelectorAll('input[name="schedule-days"]:checked');
  const days = Array.from(checkedBoxes).map(cb => cb.value);
  
  if (days.length === 0) {
    showGameToast("実施する曜日を選択してください。", "⚠️");
    return;
  }
  
  const drillSelectEl = document.getElementById('schedule-drill-select');
  const drillIdVal = drillSelectEl ? drillSelectEl.value : "custom";
  
  let category = scheduleCategorySelectEl.value;
  let name = scheduleNameInputEl.value.trim();
  const desc = scheduleDescInputEl.value.trim();
  let targetDrillId = null;

  if (drillIdVal !== "custom") {
    const drill = drills.find(d => d.id === parseInt(drillIdVal, 10));
    if (drill) {
      name = drill.name;
      category = drill.category;
      targetDrillId = drill.id;
    }
  }

  if (name) {
    const idInput = document.getElementById('schedule-id-input');
    const editingId = idInput ? idInput.value : "";
    
    const scheduleData = {
      id: editingId || `weekly_s_${Date.now()}`,
      name: name,
      category: category,
      description: desc,
      drillId: targetDrillId,
      days: days
    };
    
    if (editingId) {
      const idx = gameState.weeklySchedules.findIndex(s => s.id === editingId);
      if (idx !== -1) {
        gameState.weeklySchedules[idx] = scheduleData;
      }
      showGameToast("予定を更新しました。✨", "📅");
    } else {
      gameState.weeklySchedules.push(scheduleData);
      showGameToast("予定を保存しました。✨", "📅");
    }
    
    saveWeeklySchedule();
    renderRegisteredSchedulesList();
    
    const todayDay = getTodayDayName();
    if (days.includes(todayDay)) {
      generateDailyTasks();
      renderTasks();
    }
    
    scheduleNameInputEl.value = '';
    scheduleDescInputEl.value = '';
    if (idInput) idInput.value = '';
    document.querySelectorAll('input[name="schedule-days"]').forEach(cb => cb.checked = false);
    
    const saveBtn = document.getElementById('btn-add-schedule');
    if (saveBtn) saveBtn.textContent = '✨ 保存する';
    
    if (drillSelectEl) {
      drillSelectEl.value = 'custom';
      drillSelectEl.dispatchEvent(new Event('change'));
    }
    updateDrillTimingSelectOptions();
    renderNewTaskDrillOptions();
  }
}

// 新しいタスク追加用プルダウンの生成 (iPadOS Safariのoptgroup非表示バグ＆キャッシュ対策対応)
function renderNewTaskDrillOptions() {
  const selectEl = document.getElementById('new-task-drill-select');
  if (!selectEl) return;

  const currentVal = selectEl.value;
  selectEl.innerHTML = '<option value="custom">✏️ 自分で決める (カスタム)</option>';

  const categoryMap = {
    'べんきょう': '勉強',
    'しゅくだい': '宿題',
    'れんしゅう': '練習',
    'ならいごと': '予定',
    'おてつだい': '手伝い'
  };

  const activeDrills = drills.filter(d => !d.archived);
  if (activeDrills.length > 0) {
    const disabledHeader = document.createElement('option');
    disabledHeader.disabled = true;
    disabledHeader.textContent = '── 📚 登録済みのドリル ──';
    selectEl.appendChild(disabledHeader);

    activeDrills.forEach(drill => {
      const opt = document.createElement('option');
      opt.value = `drill:${drill.id}`;
      const catLabel = categoryMap[drill.category] || drill.category;
      opt.textContent = `📚 ${drill.name} (${catLabel})`;
      selectEl.appendChild(opt);
    });
  }

  const uniqueLessons = [];
  const addedLessonNames = new Set();
  gameState.weeklySchedules.forEach(s => {
    if (!s.drillId && s.name) {
      const name = s.name.trim();
      if (!addedLessonNames.has(name)) {
        addedLessonNames.add(name);
        uniqueLessons.push(s);
      }
    }
  });

  if (uniqueLessons.length > 0) {
    const disabledHeader = document.createElement('option');
    disabledHeader.disabled = true;
    disabledHeader.textContent = '── 🏆 時間割の予定 ──';
    selectEl.appendChild(disabledHeader);

    uniqueLessons.forEach(schedule => {
      const opt = document.createElement('option');
      opt.value = `schedule:${schedule.id}`;
      const catLabel = categoryMap[schedule.category] || schedule.category;
      opt.textContent = `🏆 ${schedule.name} (${catLabel})`;
      selectEl.appendChild(opt);
    });
  }

  if (Array.from(selectEl.options).some(o => o.value === currentVal)) {
    selectEl.value = currentVal;
  } else {
    selectEl.value = 'custom';
  }
}

// 予定の編集モード開始
function startEditWeeklySchedule(id) {
  const schedule = gameState.weeklySchedules.find(s => s.id === id);
  if (!schedule) return;

  const idInput = document.getElementById('schedule-id-input');
  if (idInput) idInput.value = schedule.id;

  document.querySelectorAll('input[name="schedule-days"]').forEach(cb => {
    cb.checked = schedule.days.includes(cb.value);
  });

  const drillSelectEl = document.getElementById('schedule-drill-select');
  if (drillSelectEl) {
    if (schedule.drillId) {
      drillSelectEl.value = schedule.drillId;
    } else {
      drillSelectEl.value = 'custom';
    }
    drillSelectEl.dispatchEvent(new Event('change'));
  }

  scheduleNameInputEl.value = schedule.name;
  scheduleCategorySelectEl.value = schedule.category;
  scheduleDescInputEl.value = schedule.description || '';

  const saveBtn = document.getElementById('btn-add-schedule');
  if (saveBtn) saveBtn.textContent = '✨ 更新する';

  if (scheduleFormEl) {
    scheduleFormEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// 予定の削除
async function deleteWeeklySchedule(dayOrId, targetId) {
  const id = targetId || dayOrId;
  if (await showGameConfirm("この予定を時間割から削除しますか？")) {
    const todayDay = getTodayDayName();
    const todayDateStr = getTodayDateString();
    const targetSchedule = gameState.weeklySchedules.find(s => s.id === id);
    
    if (targetSchedule) {
      gameState.weeklySchedules = gameState.weeklySchedules.filter(s => s.id !== id);
      saveWeeklySchedule();
      
      if (targetSchedule.days.includes(todayDay)) {
        if (targetSchedule.drillId) {
          tasks = tasks.filter(t => t.drillId !== targetSchedule.drillId);
        } else {
          const weeklyTaskId = `weekly_${id}_${todayDateStr}`;
          tasks = tasks.filter(t => t.id !== weeklyTaskId);
        }
        saveTasks();
        renderTasks();
      }
      
      renderRegisteredSchedulesList();
      updateDrillTimingSelectOptions();
      showGameToast("予定を削除しました。🗑️", "📅");
    }
  }
}

// 登録済みドリル一覧の描画
function renderDrillSettingsList() {
  const registeredList = document.getElementById('registered-drills-list');
  const archivedList = document.getElementById('archived-drills-list');
  const archivedCountEl = document.getElementById('archived-drills-count');
  
  if (!registeredList || !archivedList) return;
  
  registeredList.innerHTML = '';
  archivedList.innerHTML = '';
  
  const activeDrills = drills.filter(d => !d.archived);
  const archivedDrills = drills.filter(d => d.archived);
  
  const activeCountEl = document.getElementById('active-drills-count');
  if (activeCountEl) {
    activeCountEl.textContent = activeDrills.length;
  }

  if (archivedCountEl) {
    archivedCountEl.textContent = archivedDrills.length;
  }
  
  if (activeDrills.length === 0) {
    registeredList.innerHTML = `<li style="font-size:0.85rem; color:var(--color-text-light); text-align:center; padding:10px;">学習中のドリル・宿題はありません。</li>`;
  } else {
    activeDrills.forEach(drill => {
      let progressPercent = 0;
      if (drill.type !== 'time') {
        if (drill.totalPages > 0) {
          progressPercent = Math.min((drill.currentProgress / drill.totalPages) * 100, 100);
        } else if (drill.totalQuestions > 0) {
          progressPercent = Math.min((drill.currentQuestionProgress / drill.totalQuestions) * 100, 100);
        }
      }
      
      const li = document.createElement('li');
      li.className = 'drill-settings-item';
      
      let timingText = '指定なし';
      if (drill.timing === 'before_lesson') timingText = '🎒 予定（習い事等）の前';
      else if (drill.timing === 'after_lesson') timingText = '🎒 予定（習い事等）の後';
      else if (drill.timing && drill.timing.startsWith('before_schedule:')) {
        const lessonName = drill.timing.split(':')[1];
        timingText = `${getScheduleEmojiByName(lessonName)} ${lessonName} の前`;
      } else if (drill.timing && drill.timing.startsWith('after_schedule:')) {
        const lessonName = drill.timing.split(':')[1];
        timingText = `${getScheduleEmojiByName(lessonName)} ${lessonName} の後`;
      }

      let detailsHtml = "";
      let progressHtml = "";

      if (drill.type === 'time') {
        detailsHtml = `
          <div style="display: flex; justify-content: space-between;">
            <span>⏱️ 時間タイプ</span>
            <span>1回: ${drill.duration} 分</span>
          </div>
        `;
      } else {
        let pageDetails = "";
        if (drill.totalPages > 0) {
          pageDetails = `
            <div style="display: flex; justify-content: space-between;">
              <span>📄 ページ: 1日 ${drill.dailyAmount}P (開始: ${drill.startPage}/全体: ${drill.totalPages}P)</span>
            </div>
          `;
        }
        let questionDetails = "";
        if (drill.totalQuestions > 0) {
          const borderStyle = pageDetails ? ' border-top: 1px dashed rgba(0,0,0,0.05); padding-top: 4px;' : '';
          questionDetails = `
            <div style="display: flex; justify-content: space-between;${borderStyle}">
              <span>❓ 問題: 1日 ${drill.dailyQuestionAmount}問 (開始: ${drill.startQuestion}/全体: ${drill.totalQuestions}問)</span>
            </div>
          `;
        }
        detailsHtml = `
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${pageDetails}
            ${questionDetails}
          </div>
        `;
        progressHtml = `
          <div class="drill-progress-container" style="margin-top: 4px;">
            <div class="drill-progress-fill" style="width: ${progressPercent}%;"></div>
          </div>
        `;
      }

      let statusBadge = "";
      const isCompleted = drill.type !== 'time' && 
                          ((drill.totalPages > 0 && drill.currentProgress >= drill.totalPages) ||
                           (drill.totalQuestions > 0 && drill.currentQuestionProgress >= drill.totalQuestions));
      if (isCompleted) {
        statusBadge = `<span style="background: var(--color-success); color: white; padding: 2px 6px; font-size: 0.65rem; font-weight: 700; margin-left: 6px; border-radius:4px;">完了！</span>`;
      }

      li.innerHTML = `
        <div class="drill-settings-header">
          <span class="drill-settings-name">${escapeHTML(drill.name)}${statusBadge}</span>
          <div class="drill-item-actions" style="display:flex; gap:6px;">
            <button type="button" class="btn-edit-drill" data-id="${drill.id}" title="編集">✏️</button>
            <button type="button" class="btn-archive-drill" data-id="${drill.id}" title="アーカイブ">📦</button>
            <button type="button" class="btn-delete-drill" data-id="${drill.id}">🗑️</button>
          </div>
        </div>
        <div class="drill-settings-info" style="display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem; color: var(--color-text-light);">
          ${detailsHtml}
          <div style="display: flex; justify-content: space-between; border-top: 1px dotted rgba(0,0,0,0.05); padding-top: 4px; font-weight: 500;">
            <span>⏰ タイミング: ${timingText}</span>
          </div>
        </div>
        ${progressHtml}
      `;
      
      li.querySelector('.btn-edit-drill').addEventListener('click', () => startEditDrill(drill.id));
      li.querySelector('.btn-archive-drill').addEventListener('click', () => archiveDrill(drill.id));
      li.querySelector('.btn-delete-drill').addEventListener('click', () => deleteDrill(drill.id));
      
      registeredList.appendChild(li);
    });
  }

  if (archivedDrills.length === 0) {
    archivedList.innerHTML = `<li style="font-size:0.85rem; color:var(--color-text-light); text-align:center; padding:10px;">完了した教材・ドリルはありません。</li>`;
  } else {
    archivedDrills.forEach(drill => {
      const li = document.createElement('li');
      li.className = 'drill-settings-item archived';
      li.style.opacity = '0.7';
      
      let detailsHtml = "";
      if (drill.type === 'time') {
        detailsHtml = `<span>⏱️ 時間タイプ (1回: ${drill.duration}分)</span>`;
      } else {
        let pageText = drill.totalPages > 0 ? `${drill.totalPages}P` : '';
        let qText = drill.totalQuestions > 0 ? `${drill.totalQuestions}問` : '';
        let details = [pageText, qText].filter(t => t).join('/');
        detailsHtml = `<span>📚 ページ/問題: ${details} (完了)</span>`;
      }

      li.innerHTML = `
        <div class="drill-settings-header">
          <span class="drill-settings-name" style="text-decoration: line-through; color: var(--color-text-light);">🏆 ${escapeHTML(drill.name)}</span>
          <div class="drill-item-actions" style="display:flex; gap:6px;">
            <button type="button" class="btn-unarchive-drill" data-id="${drill.id}" title="復元">🔄</button>
            <button type="button" class="btn-delete-drill" data-id="${drill.id}">🗑️</button>
          </div>
        </div>
        <div class="drill-settings-info" style="font-size: 0.75rem; color: var(--color-text-light);">
          ${detailsHtml}
        </div>
      `;
      
      li.querySelector('.btn-unarchive-drill').addEventListener('click', () => unarchiveDrill(drill.id));
      li.querySelector('.btn-delete-drill').addEventListener('click', () => deleteDrill(drill.id));
      
      archivedList.appendChild(li);
    });
  }
}

// ドリル選択プルダウン描画
function renderScheduleDrillOptions() {
  const drillSelectEl = document.getElementById('schedule-drill-select');
  if (!drillSelectEl) return;

  const currentVal = drillSelectEl.value;
  drillSelectEl.innerHTML = '<option value="custom" selected>✍️ 直接入力する</option>';

  drills.forEach(drill => {
    if (drill.archived) return;
    const opt = document.createElement('option');
    opt.value = drill.id;
    
    let label = `📚 ${drill.name}`;
    if (drill.type === 'time') {
      label = `🎹 ${drill.name} (${drill.duration}分)`;
    } else {
      let pageText = drill.totalPages > 0 ? `${drill.totalPages}P` : '';
      let qText = drill.totalQuestions > 0 ? `${drill.totalQuestions}問` : '';
      let details = [pageText, qText].filter(t => t).join('/');
      label = `📚 ${drill.name} (${details})`;
    }
    opt.textContent = label;
    drillSelectEl.appendChild(opt);
  });

  if (Array.from(drillSelectEl.options).some(o => o.value === currentVal)) {
    drillSelectEl.value = currentVal;
  }
}

function startEditDrill(id) {
  const drill = drills.find(d => d.id === id || d.id.toString() === id.toString());
  if (!drill) return;

  const idInput = document.getElementById('drill-id-input');
  if (idInput) idInput.value = drill.id;

  drillNameInputEl.value = drill.name;
  drillTypeSelectEl.value = drill.type;
  drillTypeSelectEl.dispatchEvent(new Event('change'));

  drillCategorySelectEl.value = drill.category;
  drillCategorySelectEl.dispatchEvent(new Event('change'));

  document.getElementById('drill-timing-select').value = drill.timing || 'any';
  drillDescInputEl.value = drill.description || '';

  if (drill.type === 'page') {
    drillTotalInputEl.value = drill.totalPages || '';
    drillStartInputEl.value = drill.startPage || '';
    drillDailyInputEl.value = drill.dailyAmount || '';

    drillTotalQuestionsInputEl.value = drill.totalQuestions || '';
    drillStartQuestionInputEl.value = drill.startQuestion || '';
    drillDailyQuestionsInputEl.value = drill.dailyQuestionAmount || '';

    drillDurationInputEl.value = '';
  } else {
    drillTotalInputEl.value = '';
    drillStartInputEl.value = '';
    drillDailyInputEl.value = '';

    drillTotalQuestionsInputEl.value = '';
    drillStartQuestionInputEl.value = '';
    drillDailyQuestionsInputEl.value = '';

    drillDurationInputEl.value = drill.duration || '';
  }

  const addDrillBtn = document.getElementById('btn-add-drill');
  if (addDrillBtn) addDrillBtn.textContent = '✨ 保存する';

  const formTitle = drillFormEl.querySelector('.form-sub-title');
  if (formTitle) formTitle.textContent = '✏️ ドリルを編集する';

  if (drillFormEl) {
    drillFormEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function deleteDrill(drillId) {
  if (await showGameConfirm("このドリルを削除しますか？（時間割のスケジュールからも削除されます）")) {
    drills = drills.filter(d => d.id !== drillId && d.id.toString() !== drillId.toString());
    saveDrills();
    
    gameState.weeklySchedules = gameState.weeklySchedules.filter(s => s.drillId !== drillId && (s.drillId && s.drillId.toString() !== drillId.toString()));
    saveWeeklySchedule();
    
    tasks = tasks.filter(t => t.drillId !== drillId && (t.drillId && t.drillId.toString() !== drillId.toString()));
    saveTasks();
    
    renderDrillSettingsList();
    renderRegisteredSchedulesList();
    renderTasks();
    renderScheduleDrillOptions();
    renderNewTaskDrillOptions();
    showGameToast("ドリルを削除しました。🗑️", "🎒");
  }
}

// 答え合わせモーダルの制御
function openCheckAnswerModal(task) {
  gameState.currentCheckingTask = task;
  const drillName = task.text.split('：')[1] ? task.text.split('：')[1].split('（')[0].split('(')[0] : task.text.split(' を ')[0];
  checkTaskNameEl.textContent = drillName;
  mistakeInputEl.value = '';
  
  const actualInput = document.getElementById('actual-amount-input');
  const actualLabel = document.getElementById('actual-amount-label');
  const drill = drills.find(d => d.id === task.drillId);
  
  if (actualInput && actualLabel) {
    let labelText = "実際にやった量";
    let defaultValue = 1;
    
    if (drill) {
      if (drill.type === 'time') {
        labelText = "実際にやった時間 (分)";
        defaultValue = getTaskDuration(task) || drill.duration || 1;
      } else {
        if (drill.totalPages > 0) {
          labelText = "実際にやったページ数 (ページ)";
          defaultValue = (task.endPage && task.startPage) ? (task.endPage - task.startPage + 1) : (drill.dailyAmount || 1);
        } else if (drill.totalQuestions > 0) {
          labelText = "実際にやった問題数 (問)";
          defaultValue = (task.endQuestion && task.startQuestion) ? (task.endQuestion - task.startQuestion + 1) : (drill.dailyQuestionAmount || 1);
        }
      }
    }
    
    actualLabel.textContent = labelText;
    actualInput.value = defaultValue;
  }
  
  const isPractice = (task.category === 'れんしゅう') || (drill && drill.category === 'れんしゅう');
  const subIntro = document.getElementById('check-modal-sub-intro');
  const mistakeGroup = document.getElementById('mistake-input-group');
  const photoGroup = document.getElementById('photo-upload-group');
  const btnSubmitMistake = document.getElementById('btn-submit-mistake');
  const btnAllCorrect = document.getElementById('btn-all-correct');

  if (isPractice) {
    if (subIntro) subIntro.style.display = 'none';
    if (mistakeGroup) mistakeGroup.style.display = 'none';
    if (photoGroup) photoGroup.style.display = 'none';
    if (btnSubmitMistake) btnSubmitMistake.style.display = 'none';
    if (btnAllCorrect) btnAllCorrect.textContent = '💮 できた！';
  } else {
    if (subIntro) subIntro.style.display = 'inline';
    if (mistakeGroup) mistakeGroup.style.display = 'block';
    if (photoGroup) photoGroup.style.display = 'block';
    if (btnSubmitMistake) btnSubmitMistake.style.display = 'inline-block';
    if (btnAllCorrect) btnAllCorrect.textContent = '💯 ぜんぶ合ってた！';
  }
  
  checkAnswerModalEl.classList.add('active');
}

function closeCheckAnswerModal() {
  checkAnswerModalEl.classList.remove('active');
  gameState.currentCheckingTask = null;
  handleImageRemove();
  
  const actualInput = document.getElementById('actual-amount-input');
  if (actualInput) actualInput.value = '';
  
  const subIntro = document.getElementById('check-modal-sub-intro');
  const mistakeGroup = document.getElementById('mistake-input-group');
  const photoGroup = document.getElementById('photo-upload-group');
  const btnSubmitMistake = document.getElementById('btn-submit-mistake');
  const btnAllCorrect = document.getElementById('btn-all-correct');
  
  if (subIntro) subIntro.style.display = 'inline';
  if (mistakeGroup) mistakeGroup.style.display = 'block';
  if (photoGroup) photoGroup.style.display = 'block';
  if (btnSubmitMistake) btnSubmitMistake.style.display = 'inline-block';
  if (btnAllCorrect) btnAllCorrect.textContent = '💯 ぜんぶ合ってた！';
}

// ドリルタスク完了処理
function completeDrillTask(task, actualAmount = null) {
  if (task.drillId !== null && task.drillId !== undefined) {
    const drill = drills.find(d => d.id === task.drillId);
    if (drill) {
      if (drill.type === 'time') return;
      
      const hasActual = actualAmount !== null && actualAmount !== undefined;
      const parsedActual = hasActual ? parseInt(actualAmount, 10) : null;
      
      if (drill.totalPages > 0 && task.endPage > 0) {
        if (hasActual && !isNaN(parsedActual)) {
          drill.currentProgress = Math.min(task.startPage + parsedActual - 1, drill.totalPages);
        } else {
          drill.currentProgress = parseInt(task.endPage, 10);
        }
        drill.currentProgress = Math.max(0, drill.currentProgress);
        drill.startPage = Math.min(drill.currentProgress + 1, drill.totalPages + 1);
      }
      
      if (drill.totalQuestions > 0 && task.endQuestion > 0) {
        if (hasActual && !isNaN(parsedActual)) {
          drill.currentQuestionProgress = Math.min(task.startQuestion + parsedActual - 1, drill.totalQuestions);
        } else {
          drill.currentQuestionProgress = parseInt(task.endQuestion, 10);
        }
        drill.currentQuestionProgress = Math.max(0, drill.currentQuestionProgress);
        drill.startQuestion = Math.min(drill.currentQuestionProgress + 1, drill.totalQuestions + 1);
      }
      
      saveDrills();
      checkAndAutoArchiveDrill(drill);
    }
  }
}

// ドリルタスク未完了に戻す時の復元処理
function revertDrillTask(task) {
  if (task.drillId !== null && task.drillId !== undefined) {
    const drill = drills.find(d => d.id === task.drillId);
    if (drill) {
      if (drill.type === 'time') return;
      
      if (drill.totalPages > 0 && task.startPage > 0) {
        drill.currentProgress = Math.max(0, parseInt(task.startPage, 10) - 1);
        drill.startPage = drill.currentProgress + 1;
      }
      
      if (drill.totalQuestions > 0 && task.startQuestion > 0) {
        drill.currentQuestionProgress = Math.max(0, parseInt(task.startQuestion, 10) - 1);
        drill.startQuestion = drill.currentQuestionProgress + 1;
      }
      
      saveDrills();
    }
  }
}

// 💮 全部合ってた！
function handleAllCorrect() {
  const task = gameState.currentCheckingTask;
  if (task) {
    const actualInput = document.getElementById('actual-amount-input');
    const actualAmount = actualInput ? parseInt(actualInput.value, 10) : null;

    task.status = 'completed';
    completeDrillTask(task, actualAmount);
    saveTasks();
    
    addHistoryRecord(task, 'drill', actualAmount);
    addCompletedTask(task);
    saveHistory();
    
    renderTasks();
    showGameToast("タスクを完了しました。💯", "✨");
  }
  closeCheckAnswerModal();
}

// 🚀 まちがいを記録して送信
function handleSubmitMistake(event) {
  event.preventDefault();
  const task = gameState.currentCheckingTask;
  const mistakeText = mistakeInputEl.value.trim();
  
  if (task) {
    const actualInput = document.getElementById('actual-amount-input');
    const actualAmount = actualInput ? parseInt(actualInput.value, 10) : null;

    task.status = 'completed';
    completeDrillTask(task, actualAmount);
    saveTasks();
    
    addHistoryRecord(task, 'drill', actualAmount);
    addCompletedTask(task);
    saveHistory();
    
    renderTasks();
    
    const finalMistakeText = mistakeText || "べんきょう";
    const drillName = task.text.split('：')[1] ? task.text.split('：')[1].split('（')[0].split('(')[0] : task.text.split(' を ')[0];
    
    let localType = "その他";
    const text = finalMistakeText.toLowerCase();
    if (text.includes("たし算") || text.includes("ひき算") || text.includes("くりあがり") || text.includes("くりさがり") || text.includes("算") || text.includes("計算") || text.includes("たす") || text.includes("ひく")) {
      localType = "計算ミス";
    } else if (text.includes("漢字") || text.includes("かんじ") || text.includes("書き") || text.includes("はね") || text.includes("はらい")) {
      localType = "漢字ミス";
    } else if (text.includes("読み") || text.includes("問題") || text.includes("文章")) {
      localType = "読み間違い";
    }
    
    // Storageを使わず、Base64文字列のまま直接Firestoreに保存
    const imageUrl = gameState.currentCheckingImage;
    
    addMistakeRecord(drillName, finalMistakeText, localType, imageUrl, "pending");
    showGameToast("間違いをアルバムに記録しました。📷", "📝");
  }
  closeCheckAnswerModal();
}

// デバッグ用の日付シミュレーション関数
function simulateNextDay() {
  applyNextDayProgress();
}

function switchToRecordTab() {
  const recordTabBtn = document.querySelector('.tab-btn[data-tab="record-tab"]');
  if (recordTabBtn) {
    recordTabBtn.click();
  }
}

function switchToAdventureTab() {
  const adventureTabBtn = document.querySelector('.tab-btn[data-tab="adventure-tab"]');
  if (adventureTabBtn) {
    adventureTabBtn.click();
  }
}

// にがてタブ（ドリル別まちがいメモ）の描画ロジック
function renderNigateBuster() {
  if (!nigateFoldersContainerEl) return;

  const pendingRecords = gameState.mistakeRecords ? gameState.mistakeRecords.filter(r => r.status === 'pending') : [];

  const groups = {};
  pendingRecords.forEach(record => {
    const key = record.drillName || "その他";
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(record);
  });

  nigateFoldersContainerEl.innerHTML = '';

  const keys = Object.keys(groups);
  if (keys.length === 0) {
    nigateFoldersContainerEl.innerHTML = `
      <div class="nigate-empty-card">
        ✨ 苦手な問題は登録されていません！ ✨
      </div>
    `;
    return;
  }

  keys.forEach(drillName => {
    const list = groups[drillName];
    const count = list.length;
    
    let emoji = "📚";
    if (drillName.includes("しゅくだい") || drillName.includes("宿題")) {
      emoji = "📝";
    } else if (drillName.includes("ならいごと") || drillName.includes("レッスン")) {
      emoji = "🏆";
    } else if (drillName.includes("れんしゅう") || drillName.includes("ピアノ")) {
      emoji = "🎹";
    }

    const card = document.createElement('div');
    card.className = 'nigate-folder-card';
    
    card.innerHTML = `
      <div class="nigate-folder-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; width: 100%;">
        <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px;">
          <span style="font-weight: 700; font-size: 0.9rem; color: var(--color-text);">${emoji} ${escapeHTML(drillName)}</span>
          <span style="font-size: 0.75rem; font-weight: 500; color: #8E78F9; display: flex; align-items: center;">👾 記録されている苦手: ${count}件 <span class="accordion-arrow" style="margin-left:4px; font-size:0.6rem;">▼</span></span>
        </div>
      </div>
      <div class="nigate-mistakes-list" style="display: none;">
      </div>
    `;

    const header = card.querySelector('.nigate-folder-header');
    const listEl = card.querySelector('.nigate-mistakes-list');
    const arrow = card.querySelector('.accordion-arrow');

    header.addEventListener('click', () => {
      const isVisible = listEl.style.display === 'flex';
      listEl.style.display = isVisible ? 'none' : 'flex';
      listEl.style.flexDirection = 'column';
      arrow.textContent = isVisible ? '▼' : '▲';
    });

    list.forEach(mistake => {
      const item = document.createElement('div');
      item.className = 'nigate-mistake-item';
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      
      const photoBadge = mistake.imageUrl ? '<span style="font-size: 0.7rem; color: var(--color-secondary); margin-left: 6px;">📷 あり</span>' : '';
      
      item.innerHTML = `
        <span style="flex-grow: 1; text-align: left; margin-right: 10px; word-break: break-all;">📌 ${escapeHTML(mistake.mistakeText)}${photoBadge}</span>
        <button type="button" class="btn btn-resolve-nigate" style="padding: 4px 8px; font-size: 0.7rem; background-color: var(--color-success-light); color: var(--color-success); border-radius: 4px; border:none; cursor:pointer;">克服！</button>
      `;

      // 克服ボタンを押した時の消去ロジック
      item.querySelector('.btn-resolve-nigate').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await showGameConfirm("この間違いメモを克服（クリア）しましたか？")) {
          mistake.status = 'cleared';
          storage.setItem(getUserKey('mistake_records'), JSON.stringify(gameState.mistakeRecords));
          if (firebaseEnabled && currentFirebaseUser) saveAllDataToCloud();
          renderRecordTab();
          showGameToast("苦手タスクをクリアしました。💯", "✨");
        }
      });

      listEl.appendChild(item);
    });

    nigateFoldersContainerEl.appendChild(card);
  });
}

// ユーザー切り替え・編集などの処理
function openUserModal() {
  renderModalUserList();
  if (userModalEl) userModalEl.classList.add('active');
}

function closeUserModal() {
  if (userModalEl) userModalEl.classList.remove('active');
}

function renderModalUserList() {
  const modalUserListEl = document.getElementById('modal-user-list');
  if (!modalUserListEl) return;
  modalUserListEl.innerHTML = '';

  gameState.users.forEach(user => {
    const li = document.createElement('li');
    li.style.width = '100%';
    const isActive = user === gameState.currentUser ? 'active' : '';

    // 現在のアクティブユーザー、およびユーザー数が1人の場合は削除できないようにする
    const showDelete = (user !== gameState.currentUser && gameState.users.length > 1);
    const deleteBtnHtml = showDelete ? `
      <button type="button" class="btn-delete-user" data-user="${escapeHTML(user)}" style="background:none; border:none; cursor:pointer; font-size:1.1rem; padding: 0 4px; display:flex; align-items:center;" title="削除">🗑️</button>
    ` : '';

    li.innerHTML = `
      <div style="display: flex; gap: 8px; width: 100%; align-items: center;">
        <button type="button" class="btn btn-select-user ${isActive}" style="flex-grow: 1; text-align: left; padding: 10px; border: 1px solid var(--color-border); background-color: #f8f9fa; cursor: pointer; display: flex; justify-content: space-between; border-radius:var(--radius-sm);">
          <span class="user-btn-name">👤 ${escapeHTML(user)}</span>
          ${user === gameState.currentUser ? '<span class="user-current-tag" style="font-size:0.7rem; color:var(--color-secondary); font-weight:700;">使用中</span>' : ''}
        </button>
        ${deleteBtnHtml}
      </div>
    `;

    li.querySelector('.btn-select-user').addEventListener('click', () => {
      switchUser(user);
      closeUserModal();
    });

    if (showDelete) {
      li.querySelector('.btn-delete-user').addEventListener('click', async (e) => {
        e.stopPropagation(); // 切り替えボタンへのクリック伝播を防ぐ
        if (await showGameConfirm(`ユーザー「${user}」と、その学習データを本当に削除しますか？\n（この操作はもとに戻せません）`)) {
          deleteUser(user);
        }
      });
    }

    modalUserListEl.appendChild(li);
  });
}

function switchUser(userName) {
  gameState.currentUser = userName;
  storage.setItem('study_rpg_current_user', userName);

  loadData();
  generateDailyTasks();
  renderTasks();
  renderNigateBuster();
  updateUI();

  const recordTab = document.getElementById('record-tab');
  if (recordTab && recordTab.classList.contains('active')) {
    renderRecordTab();
  }

  showGameToast(`ユーザーを「${userName}」に切り替えたよ！`, "👤");
}

function handleAddUser(event) {
  event.preventDefault();
  const newNameInput = document.getElementById('new-user-name-input');
  if (!newNameInput) return;

  const newName = newNameInput.value.trim();

  if (newName) {
    if (gameState.users.includes(newName)) {
      showGameToast("そのおなまえは すでに登録されているよ！", "⚠️");
      return;
    }

    gameState.users.push(newName);
    storage.setItem('study_rpg_users', JSON.stringify(gameState.users));
    newNameInput.value = '';
    
    renderModalUserList();
    switchUser(newName);
    closeUserModal();
  }
}

// ユーザー削除処理とローカルストレージ掃除
async function deleteUser(userName) {
  if (userName === gameState.currentUser) {
    showGameToast("使用中のユーザーは削除できません。", "⚠️");
    return;
  }

  // 1. ユーザーリストから除外
  gameState.users = gameState.users.filter(u => u !== userName);
  storage.setItem('study_rpg_users', JSON.stringify(gameState.users));

  // 2. ローカルストレージに残っているそのユーザーの学習データを消去
  const keysToRemove = [
    'drills', 'tasks', 'history', 'completed_tasks', 'weekly_schedule', 'profile', 'mistake_records', 'all_completed_dates'
  ];
  keysToRemove.forEach(baseKey => {
    try {
      localStorage.removeItem(`study_rpg_u_${userName}_${baseKey}`);
    } catch (e) {
      console.error("[Delete User Backup Fail]", e);
    }
  });

  // 3. オンライン同期（Firestore上の gameState.users なども最新化して上書き）
  if (firebaseEnabled && currentFirebaseUser) {
    await saveAllDataToCloud();
  }

  showGameToast(`ユーザー「${userName}」を削除しました。🗑️`, "👤");
  renderModalUserList();
}

// タスク繰り越し（延期）モーダルの制御
let pendingPostponeTask = null;

function openCarryoverModal(task) {
  pendingPostponeTask = task;
  const modal = document.getElementById('carryover-modal');
  const taskNameEl = document.getElementById('carryover-task-name');
  
  if (taskNameEl) {
    const cleanName = task.text.replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "").trim();
    taskNameEl.textContent = cleanName;
  }
  
  if (modal) {
    modal.classList.add('active');
  }
}

function closeCarryoverModal() {
  const modal = document.getElementById('carryover-modal');
  if (modal) {
    modal.classList.remove('active');
  }
  pendingPostponeTask = null;
}

function handleCarryoverChoice(mode) {
  if (!pendingPostponeTask) return;
  
  const task = pendingPostponeTask;
  task.postponeMode = mode;
  task.originalText = task.text;
  task.status = 'postponed';
  task.date = getTomorrowDateString();
  
  if (task.drillId !== null && task.drillId !== undefined) {
    const drill = drills.find(d => d.id === task.drillId);
    if (drill) {
      if (mode === 'add') {
        drill.postponedAmount = (drill.postponedAmount || 0) + drill.dailyAmount;
        saveDrills();
      }
      task.text = `${drill.name} は あしたにするよ！ 📅`;
    }
  }
  
  saveTasks();
  renderTasks();
  
  closeCarryoverModal();
  showGameToast("明日の予定を 更新したよ！", "📅");
  enterSimulationMode();
}

function enterSimulationMode() {
  gameState.simulationMode = true;
  renderTasks();
  switchToAdventureTab();
}

function exitSimulationMode() {
  gameState.simulationMode = false;
  renderTasks();
}

// ドリルのアーカイブ
function archiveDrill(id) {
  const drill = drills.find(d => d.id === id || d.id.toString() === id.toString());
  if (drill) {
    drill.archived = true;
    tasks = tasks.filter(t => t.drillId !== drill.id);
    saveDrills();
    saveTasks();
    renderTasks();
    renderDrillSettingsList();
    renderScheduleDrillOptions();
    updateDrillTimingSelectOptions();
    showGameToast("ドリルをアーカイブしたよ！📦", "🎒");
  }
}

function unarchiveDrill(id) {
  const drill = drills.find(d => d.id === id || d.id.toString() === id.toString());
  if (drill) {
    drill.archived = false;
    let resetProgress = false;
    if (drill.type === 'page') {
      const isCompleted = (drill.totalPages > 0 && drill.currentProgress >= drill.totalPages) ||
                          (drill.totalQuestions > 0 && drill.currentQuestionProgress >= drill.totalQuestions);
      if (isCompleted && confirm(`このドリル（${drill.name}）はすでに完了しています。進捗を0に戻して最初からやり直しますか？`)) {
        drill.currentProgress = Math.max(0, drill.startPage - 1);
        drill.currentQuestionProgress = Math.max(0, drill.startQuestion - 1);
        resetProgress = true;
      }
    }
    
    saveDrills();
    generateDailyTasks();
    saveTasks();
    renderTasks();
    renderDrillSettingsList();
    renderScheduleDrillOptions();
    updateDrillTimingSelectOptions();
    
    const msg = resetProgress ? "進捗をリセットしてドリルを復帰したよ！" : "ドリルを復帰したよ！";
    showGameToast(msg, "🎒");
  }
}

function checkAndAutoArchiveDrill(drill) {
  if (drill.archived) return;
  if (drill.type !== 'time') {
    const isCompleted = (drill.totalPages > 0 && drill.currentProgress >= drill.totalPages) ||
                        (drill.totalQuestions > 0 && drill.currentQuestionProgress >= drill.totalQuestions);
    if (isCompleted) {
      drill.archived = true;
      tasks = tasks.filter(t => t.drillId !== drill.id);
      saveDrills();
      saveTasks();
      
      setTimeout(() => {
        showGameToast(`『${drill.name}』を さいごまで クリアしたね！おめでとう！`, "🏆");
        renderTasks();
        renderDrillSettingsList();
        renderScheduleDrillOptions();
        updateDrillTimingSelectOptions();
      }, 500);
    }
  }
}

function getTomorrowDayName() {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return days[(new Date().getDay() + 1) % 7];
}

function getTomorrowDateString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

// 翌日シミュレーションタスクの生成
function getTomorrowSimulatedTasks() {
  const tomorrowDay = getTomorrowDayName();
  const tomorrowDateStr = getTomorrowDateString();
  const tomorrowSchedules = gameState.weeklySchedules.filter(s => s.days.includes(tomorrowDay));

  const simulatedTasks = [];
  const todayPostponed = tasks.filter(t => t.status === 'postponed');
  const replacedScheduleIds = new Set();
  
  todayPostponed.forEach(postponed => {
    if (postponed.drillId) {
      const drill = drills.find(d => d.id === postponed.drillId);
      if (!drill) return;
      
      const mode = postponed.postponeMode || 'add';
      const tomorrowDrillSchedule = tomorrowSchedules.find(s => s.drillId === drill.id);
      
      if (tomorrowDrillSchedule) {
        let startPageVal = postponed.startPage;
        let endPageVal = postponed.endPage;
        let startQuestionVal = postponed.startQuestion;
        let endQuestionVal = postponed.endQuestion;
        let taskText = "";
        const emoji = getCategoryEmoji(drill.category);
        
        if (drill.type === 'time') {
          const baseDuration = drill.tomorrowAmountOverride > 0 ? drill.tomorrowAmountOverride : drill.duration;
          if (mode === 'add') {
            taskText = `${emoji} ${drill.category}：${drill.name}（${baseDuration * 2}分 - 2日分！）`;
          } else {
            taskText = `${emoji} ${drill.category}：${drill.name}（${baseDuration}分）`;
          }
        } else {
          if (mode === 'add') {
            if (drill.totalPages > 0) {
              const todayPages = (postponed.endPage - postponed.startPage + 1);
              const tomorrowPages = drill.tomorrowAmountOverride > 0 ? drill.tomorrowAmountOverride : drill.dailyAmount;
              endPageVal = Math.min(startPageVal + todayPages + tomorrowPages - 1, drill.totalPages);
            }
            if (drill.totalQuestions > 0) {
              const todayQs = (postponed.endQuestion - postponed.startQuestion + 1);
              const tomorrowQs = (drill.tomorrowAmountOverride > 0 && drill.type === 'question') ? drill.tomorrowAmountOverride : drill.dailyQuestionAmount;
              endQuestionVal = Math.min(startQuestionVal + todayQs + tomorrowQs - 1, drill.totalQuestions);
            }
          }
          
          let pageText = "";
          if (drill.totalPages > 0) {
            pageText = `P:${startPageVal}〜${endPageVal}`;
          }
          let questionText = "";
          if (drill.totalQuestions > 0) {
            questionText = `Q:${startQuestionVal}〜${endQuestionVal}`;
          }
          let rangeText = "";
          if (pageText && questionText) {
            rangeText = `（${pageText} / ${questionText}）`;
          } else if (pageText) {
            rangeText = `（${pageText}）`;
          } else if (questionText) {
            rangeText = `（${questionText}）`;
          }
          
          taskText = `${emoji} ${drill.category}：${drill.name}${rangeText}`;
          if (mode === 'add') {
            taskText += ` (2日分！)`;
          }
        }
        
        simulatedTasks.push({
          id: `sim_drill_${drill.id}`,
          text: taskText,
          status: 'active',
          drillId: drill.id,
          category: drill.category || "べんきょう",
          description: drill.description || ""
        });
        
        replacedScheduleIds.add(tomorrowDrillSchedule.id);
      } else {
        simulatedTasks.push({
          id: `sim_postponed_${postponed.id}`,
          text: postponed.originalText || postponed.text,
          status: 'active',
          drillId: postponed.drillId,
          category: postponed.category,
          description: postponed.description
        });
      }
    } else if (postponed.id && postponed.id.toString().startsWith('weekly_')) {
      const mode = postponed.postponeMode || 'add';
      const scheduleId = postponed.id.split('_')[1];
      const tomorrowSchedule = tomorrowSchedules.find(s => s.id === scheduleId);
      
      if (tomorrowSchedule && mode === 'replace') {
        simulatedTasks.push({
          id: `sim_postponed_${postponed.id}`,
          text: postponed.originalText || postponed.text,
          status: 'active',
          drillId: null,
          category: postponed.category,
          description: postponed.description
        });
        replacedScheduleIds.add(tomorrowSchedule.id);
      } else {
        simulatedTasks.push({
          id: `sim_postponed_${postponed.id}`,
          text: postponed.originalText || postponed.text,
          status: 'active',
          drillId: null,
          category: postponed.category,
          description: postponed.description
        });
      }
    }
  });
  
  tomorrowSchedules.forEach(schedule => {
    if (replacedScheduleIds.has(schedule.id)) return;
    
    if (schedule.drillId) {
      const drill = drills.find(d => d.id === schedule.drillId);
      if (!drill) return;
      
      let startPageVal = (drill.currentProgress || 0) + 1;
      let startQuestionVal = (drill.currentQuestionProgress || 0) + 1;
      
      const tomorrowPages = drill.tomorrowAmountOverride > 0 ? drill.tomorrowAmountOverride : drill.dailyAmount;
      const tomorrowQs = (drill.tomorrowAmountOverride > 0 && drill.type === 'question') ? drill.tomorrowAmountOverride : drill.dailyQuestionAmount;
      
      const isPostponedToday = todayPostponed.some(t => t.drillId === drill.id);
      if (!isPostponedToday) {
        const todayActiveTask = tasks.find(t => t.drillId === drill.id && t.status === 'active' && t.date === getTodayDateString());
        if (todayActiveTask) {
          if (drill.totalPages > 0 && todayActiveTask.endPage > 0) {
            startPageVal = Math.min(todayActiveTask.endPage + 1, drill.totalPages + 1);
          }
          if (drill.totalQuestions > 0 && todayActiveTask.endQuestion > 0) {
            startQuestionVal = Math.min(todayActiveTask.endQuestion + 1, drill.totalQuestions + 1);
          }
        }
      }
      
      const isPageFinished = drill.totalPages > 0 && startPageVal > drill.totalPages;
      const isQuestionFinished = drill.totalQuestions > 0 && startQuestionVal > drill.totalQuestions;
      if (drill.type !== 'time' && (drill.totalPages > 0 ? isPageFinished : true) && (drill.totalQuestions > 0 ? isQuestionFinished : true)) {
        return;
      }
      
      let taskText = "";
      const emoji = getCategoryEmoji(drill.category);
      if (drill.type === 'time') {
        const duration = drill.tomorrowAmountOverride > 0 ? drill.tomorrowAmountOverride : drill.duration;
        taskText = `${emoji} ${drill.category}：${drill.name}（${duration}分）`;
      } else {
        let pageText = "";
        if (drill.totalPages > 0) {
          const endP = Math.min(startPageVal + tomorrowPages - 1, drill.totalPages);
          pageText = `P:${startPageVal}〜${endP}`;
        }
        let questionText = "";
        if (drill.totalQuestions > 0) {
          const endQ = Math.min(startQuestionVal + tomorrowQs - 1, drill.totalQuestions);
          questionText = `Q:${startQuestionVal}〜${endQ}`;
        }
        let rangeText = "";
        if (pageText && questionText) {
          rangeText = `（${pageText} / ${questionText}）`;
        } else if (pageText) {
          rangeText = `（${pageText}）`;
        } else if (questionText) {
          rangeText = `（${questionText}）`;
        }
        taskText = `${emoji} ${drill.category}：${drill.name}${rangeText}`;
      }
      
      simulatedTasks.push({
        id: `sim_drill_${drill.id}`,
        text: taskText,
        status: 'active',
        drillId: drill.id,
        category: drill.category || "べんきょう",
        description: drill.description || ""
      });
    } else {
      const weeklyTaskId = `sim_weekly_${schedule.id}_${tomorrowDateStr}`;
      simulatedTasks.push({
        id: weeklyTaskId,
        text: schedule.name,
        status: 'active',
        drillId: null,
        category: schedule.category || 'ならいごと',
        description: schedule.description || ''
      });
    }
  });

  const uncompletedCustomTasks = tasks.filter(t => t.drillId === null && !t.id.toString().startsWith('weekly_') && t.status === 'active');
  uncompletedCustomTasks.forEach(t => {
    simulatedTasks.push({
      id: `sim_custom_${t.id}`,
      text: t.text,
      status: 'active',
      drillId: null,
      category: t.category,
      description: t.description
    });
  });

  return simulatedTasks;
}

function handleTaskPostponeClick(event) {
  const postponeBtn = event.target.closest('.btn-postpone-task');
  if (postponeBtn) {
    const taskIdStr = postponeBtn.dataset.id;
    const task = tasks.find(t => t.id === taskIdStr || t.id.toString() === taskIdStr);
    if (task) {
      openCarryoverModal(task);
    }
  }
}

function handleTaskRevertClick(event) {
  const revertBtn = event.target.closest('.btn-revert-task');
  if (revertBtn) {
    const taskIdStr = revertBtn.dataset.id;
    revertPostponedTask(taskIdStr);
  }
}

function revertPostponedTask(taskIdStr) {
  const task = tasks.find(t => t.id === taskIdStr || t.id.toString() === taskIdStr);
  if (task && task.status === 'postponed') {
    task.status = 'active';
    task.date = getTodayDateString();
    if (task.originalText) {
      task.text = task.originalText;
    }

    if (task.drillId !== null && task.drillId !== undefined) {
      const drill = drills.find(d => d.id === task.drillId);
      if (drill) {
        const decreaseAmount = task.postponeMode === 'add' ? drill.dailyAmount : 0;
        drill.postponedAmount = Math.max(0, (drill.postponedAmount || 0) - decreaseAmount);
      }
    }

    saveDrills();
    saveTasks();
    renderTasks();
    updateUI();
    showGameToast("タスクを今日に戻しました。↩️", "🎒");
  }
}

function handleToggleSimulation() {
  if (gameState.simulationMode) {
    exitSimulationMode();
  } else {
    enterSimulationMode();
  }
}

// プロフィール編集の保存
function handleSaveProfile(event) {
  event.preventDefault();
  const nameInput = document.getElementById('profile-name-input');
  if (!nameInput) return;
  
  const newName = nameInput.value.trim();
  if (!newName) {
    showGameToast("名前を入力してください。", "⚠️");
    return;
  }
  
  const oldName = gameState.currentUser;
  
  if (newName !== oldName) {
    const otherUsers = gameState.users.filter(u => u !== oldName);
    if (otherUsers.includes(newName)) {
      showGameToast("その名前はすでに登録されています。", "⚠️");
      return;
    }
    
    const userIndex = gameState.users.indexOf(oldName);
    if (userIndex !== -1) {
      gameState.users[userIndex] = newName;
    } else {
      gameState.users.push(newName);
    }
    storage.setItem('study_rpg_users', JSON.stringify(gameState.users));
    renameUserStorage(oldName, newName);
    
    gameState.currentUser = newName;
    storage.setItem('study_rpg_current_user', newName);
  }
  
  gameState.userProfile = {
    name: newName,
    avatar: "default_img"
  };
  saveUserProfile();
  
  const currentUserEl = document.getElementById('current-user-name');
  if (currentUserEl) {
    currentUserEl.textContent = newName;
  }
  
  loadData();
  generateDailyTasks();
  renderTasks();
  updateUI();
  renderNewTaskDrillOptions();
  
  closeProfileModal();
  showGameToast("ユーザー情報を更新しました。", "👤");
}

function openProfileModal() {
  const profileEditModalEl = document.getElementById('profile-edit-modal');
  const profileNameInputEl = document.getElementById('profile-name-input');
  
  if (profileNameInputEl && gameState.userProfile) {
    profileNameInputEl.value = gameState.userProfile.name || gameState.currentUser;
  }
  if (profileEditModalEl) {
    profileEditModalEl.classList.add('active');
  }
}

function closeProfileModal() {
  const profileEditModalEl = document.getElementById('profile-edit-modal');
  if (profileEditModalEl) {
    profileEditModalEl.classList.remove('active');
  }
}

function showCongratulationsModal() {
  const congratulationsModalEl = document.getElementById('congratulations-modal');
  if (congratulationsModalEl) {
    congratulationsModalEl.classList.add('active');
  }
}

function closeCongratulationsModal() {
  const congratulationsModalEl = document.getElementById('congratulations-modal');
  if (congratulationsModalEl) {
    congratulationsModalEl.classList.remove('active');
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// がんばり記録画面のレンダリング
function renderRecordTab() {
  repairTodayCompletedTasks();
  const clearedTasksCountEl = document.getElementById('cleared-tasks-count');
  const studyTimeCountEl = document.getElementById('study-time-count');
  const recordDrillListEl = document.getElementById('record-drill-list');

  if (!clearedTasksCountEl || !studyTimeCountEl || !recordDrillListEl) return;

  const totalCleared = history.length;
  const totalStudyMinutes = history
    .filter(h => h.unit === 'ぷん' || h.unit === 'ふん' || h.unit === '分')
    .reduce((sum, h) => sum + (parseInt(h.amount, 10) || 0), 0);

  clearedTasksCountEl.textContent = totalCleared;
  studyTimeCountEl.textContent = totalStudyMinutes;

  const weeklyTitleEl = document.getElementById('weekly-report-title');
  const weeklyToggleBtn = document.getElementById('btn-toggle-weekly-report');
  const weeklyClearedCountEl = document.getElementById('weekly-cleared-count');
  const weeklyStudyTimeEl = document.getElementById('weekly-study-time');
  const weeklyCompletedListEl = document.getElementById('weekly-completed-list');

  if (weeklyTitleEl && weeklyToggleBtn && weeklyClearedCountEl && weeklyStudyTimeEl && weeklyCompletedListEl) {
    const { thisWeekTasks, lastWeekTasks } = getWeeklyReportData();
    const mode = gameState.weeklyReportMode || 'thisWeek';
    const activeReportTasks = mode === 'thisWeek' ? thisWeekTasks : lastWeekTasks;

    if (mode === 'thisWeek') {
      weeklyTitleEl.textContent = '📅 今週の振り返り';
      weeklyToggleBtn.textContent = '先週の記録 ◀';
    } else {
      weeklyTitleEl.textContent = '📅 先週の振り返り';
      weeklyToggleBtn.textContent = '今週の記録 ▶';
    }

    const reportCount = activeReportTasks.length;
    const reportDuration = activeReportTasks.reduce((sum, task) => sum + getTaskDuration(task), 0);

    weeklyClearedCountEl.textContent = reportCount;
    weeklyStudyTimeEl.textContent = reportDuration;

    weeklyCompletedListEl.innerHTML = '';
    if (activeReportTasks.length === 0) {
      weeklyCompletedListEl.innerHTML = `<li style="font-size: 0.75rem; color: var(--color-text-light); text-align: center; padding: 10px; list-style: none;">この週に達成したタスクはありません。</li>`;
    } else {
      const sortedTasks = [...activeReportTasks].reverse();
      sortedTasks.forEach(task => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.borderBottom = '1px dashed var(--color-border)';
        li.style.padding = '4px 0';
        li.style.alignItems = 'center';

        let badge = '🏠';
        if (task.category === 'べんきょう') badge = '📚';
        else if (task.category === 'ならいごと') badge = '🏆';
        else if (task.category === 'しゅくだい') badge = '📝';
        else if (task.category === 'れんしゅう') badge = '🎹';

        let displayText = escapeHTML(task.text);
        const prefixRegex = /^([\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])?\s*(しゅくだい|べんきょう|れんしゅう|ならいごと|おてつだい)[\uff1a:]\s*/;
        displayText = displayText.replace(prefixRegex, "");

        li.innerHTML = `
          <span style="font-weight: 500; color: var(--color-text);">${badge} ${displayText}</span>
          <span style="font-size: 0.7rem; color: var(--color-text-light); white-space: nowrap;">${escapeHTML(task.completedDate)}</span>
        `;
        weeklyCompletedListEl.appendChild(li);
      });
    }
  }

  // ドリル進捗の描画
  recordDrillListEl.innerHTML = '';
  const activeDrills = drills.filter(d => !d.archived);
  if (activeDrills.length === 0) {
    recordDrillListEl.innerHTML = `<li style="font-size:0.85rem; color:var(--color-text-light); text-align:center; padding:10px;">進行中のドリルはありません。</li>`;
  } else {
    drills.forEach(drill => {
      if (drill.archived) return;
      const li = document.createElement('li');
      li.className = 'drill-progress-item';
      li.style.backgroundColor = '#ffffff';
      li.style.border = '1px solid var(--color-border)';
      li.style.borderRadius = 'var(--radius-sm)';
      li.style.padding = '10px 12px';
      
      if (drill.type === 'time') {
        const totalMinutes = history
          .filter(h => h.type === 'drill' && h.taskText.includes(drill.name))
          .reduce((sum, h) => sum + (parseInt(h.amount, 10) || 0), 0);
        li.innerHTML = `
          <div class="drill-progress-header" style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; font-weight:700;">
            <span>⏱️ ${escapeHTML(drill.name)} (${escapeHTML(drill.category)})</span>
            <span class="drill-progress-percent" style="color:var(--color-secondary);">合計時間: ${totalMinutes} 分</span>
          </div>
        `;
      } else {
        let progressPercent = 0;
        let progressText = "";
        
        if (drill.totalPages > 0 && drill.totalQuestions > 0) {
          progressPercent = Math.min(Math.round((drill.currentProgress / drill.totalPages) * 100), 100);
          progressText = `P: ${drill.currentProgress}/${drill.totalPages} / Q: ${drill.currentQuestionProgress}/${drill.totalQuestions} (${progressPercent}%)`;
        } else if (drill.totalPages > 0) {
          progressPercent = Math.min(Math.round((drill.currentProgress / drill.totalPages) * 100), 100);
          progressText = `${drill.currentProgress} / ${drill.totalPages} ページ (${progressPercent}%)`;
        } else if (drill.totalQuestions > 0) {
          progressPercent = Math.min(Math.round((drill.currentQuestionProgress / drill.totalQuestions) * 100), 100);
          progressText = `${drill.currentQuestionProgress} / ${drill.totalQuestions} 問 (${progressPercent}%)`;
        }

        li.innerHTML = `
          <div class="drill-progress-header" style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; font-weight:700; margin-bottom:6px;">
            <span>📚 ${escapeHTML(drill.name)} (${escapeHTML(drill.category)})</span>
            <span class="drill-progress-percent" style="color:var(--color-text-light);">${progressText}</span>
          </div>
          <div class="drill-progress-container" style="background:#e9ecef; height:6px; border-radius:var(--radius-round); overflow:hidden;">
            <div class="drill-progress-fill" style="width: ${progressPercent}%; background-color:var(--color-success); height:100%; border-radius:var(--radius-round);"></div>
          </div>
        `;
      }
      recordDrillListEl.appendChild(li);
    });
  }

  renderNigateReport();
  renderNigateBuster();

  // （履歴リストの描画削除済み）

  const activeSubTab = document.querySelector('.records-sub-tab-btn.active');
  const activeSubTabName = activeSubTab ? activeSubTab.dataset.subtab : 'records-summary';
  switchRecordsSubTab(activeSubTabName);
}

// カレンダー表示・処理ロジック
let calendarCurrentDate = new Date();
let calendarSelectedDateStr = getTodayDateString();

function renderCalendar() {
  const monthYearEl = document.getElementById('calendar-month-year');
  const daysGridEl = document.getElementById('calendar-days-grid');
  
  if (!monthYearEl || !daysGridEl) return;

  const year = calendarCurrentDate.getFullYear();
  const month = calendarCurrentDate.getMonth();

  monthYearEl.textContent = `${year}年${month + 1}月`;
  daysGridEl.innerHTML = '';

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays = new Date(year, month, 0).getDate();
  const totalCells = 42;

  for (let i = 0; i < totalCells; i++) {
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day';

    let dayNumber;
    let cellDateStr = '';
    let isOtherMonth = false;

    if (i < firstDayIndex) {
      dayNumber = prevMonthTotalDays - firstDayIndex + i + 1;
      isOtherMonth = true;
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      cellDateStr = `${prevYear}-${(prevMonth + 1).toString().padStart(2, '0')}-${dayNumber.toString().padStart(2, '0')}`;
    } else if (i >= firstDayIndex && i < firstDayIndex + totalDays) {
      dayNumber = i - firstDayIndex + 1;
      cellDateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${dayNumber.toString().padStart(2, '0')}`;
    } else {
      dayNumber = i - firstDayIndex - totalDays + 1;
      isOtherMonth = true;
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      cellDateStr = `${nextYear}-${(nextMonth + 1).toString().padStart(2, '0')}-${dayNumber.toString().padStart(2, '0')}`;
    }

    dayCell.innerHTML = `<span class="calendar-day-num" style="position: relative; z-index: 2; pointer-events: none;">${dayNumber}</span>`;
    dayCell.dataset.date = cellDateStr;

    if (isOtherMonth) {
      dayCell.classList.add('other-month');
    }

    const todayStr = getTodayDateString();
    if (cellDateStr === todayStr) {
      dayCell.classList.add('today');
    }

    if (cellDateStr === calendarSelectedDateStr) {
      dayCell.classList.add('selected');
    }

    const hasCompleted = completedTasks.some(t => t.completedDate === cellDateStr);
    if (hasCompleted) {
      dayCell.classList.add('has-completed');
      const dot = document.createElement('div');
      dot.className = 'completed-dot';
      dayCell.appendChild(dot);
    }

    const isAllCompleted = gameState.allCompletedDates && gameState.allCompletedDates.includes(cellDateStr);
    if (isAllCompleted) {
      dayCell.classList.add('has-all-completed');
    }

    dayCell.addEventListener('click', () => {
      const oldSelected = daysGridEl.querySelector('.calendar-day.selected');
      if (oldSelected) {
        oldSelected.classList.remove('selected');
      }
      dayCell.classList.add('selected');
      calendarSelectedDateStr = cellDateStr;
      renderDayTasks(cellDateStr);
    });

    daysGridEl.appendChild(dayCell);
  }

  renderDayTasks(calendarSelectedDateStr);
}

function renderDayTasks(dateStr) {
  const completedListEl = document.getElementById('calendar-completed-list');
  const completedTitleEl = document.getElementById('completed-tasks-title');
  if (!completedListEl) return;

  if (completedTitleEl) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      completedTitleEl.textContent = `${parseInt(parts[0], 10)}年${parseInt(parts[1], 10)}月${parseInt(parts[2], 10)}日 の達成タスク`;
    } else {
      completedTitleEl.textContent = `${dateStr} の達成タスク`;
    }
  }

  completedListEl.innerHTML = '';
  const tasksForDay = completedTasks.filter(t => t.completedDate === dateStr);

  if (tasksForDay.length === 0) {
    completedListEl.innerHTML = `<li style="font-size:0.8rem; color:var(--color-text-light); text-align:center; padding:12px; list-style:none;">この日の達成タスクはありません。</li>`;
    return;
  }

  tasksForDay.forEach(task => {
    const li = document.createElement('li');
    li.className = 'completed-task-item';
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    li.style.borderBottom = '1px solid var(--color-border)';
    li.style.padding = '8px 0';

    let badgeHtml = '';
    if (task.category === 'べんきょう') badgeHtml = '<span class="task-cat-badge study" style="margin-right: 6px;">📚</span>';
    else if (task.category === 'ならいごと') badgeHtml = '<span class="task-cat-badge lesson" style="margin-right: 6px;">🏆</span>';
    else if (task.category === 'しゅくだい') badgeHtml = '<span class="task-cat-badge homework" style="margin-right: 6px;">📝</span>';
    else if (task.category === 'れんしゅう') badgeHtml = '<span class="task-cat-badge practice" style="margin-right: 6px;">🎹</span>';
    else if (task.category === 'おてつだい') badgeHtml = '<span class="task-cat-badge help" style="margin-right: 6px;">🏠</span>';

    let displayText = escapeHTML(task.text);
    const prefixRegex = /^([\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])?\s*(しゅくだい|べんきょう|れんしゅう|ならいごと|おてつだい)[\uff1a:]\s*/;
    displayText = displayText.replace(prefixRegex, "");

    li.innerHTML = `
      <div style="display: flex; align-items: center; text-align: left; font-size:0.8rem; font-weight:700;">
        ${badgeHtml}
        <span class="completed-task-title">${displayText}</span>
      </div>
      <span class="completed-task-meta" style="font-size:0.7rem; color:var(--color-success); font-weight:700;">💮 達成</span>
    `;

    completedListEl.appendChild(li);
  });
}

// にがてレポート＆写真アルバムの描画
function renderNigateReport() {
  const typesContainer = document.getElementById('nigate-types-container');
  const adviceTextEl = document.getElementById('nigate-ai-advice-text');
  const albumGridEl = document.getElementById('nigate-album-grid');

  if (!typesContainer || !adviceTextEl || !albumGridEl) return;

  const counts = { "計算ミス": 0, "漢字ミス": 0, "読み間違い": 0, "その他": 0 };
  if (gameState.mistakeRecords && gameState.mistakeRecords.length > 0) {
    gameState.mistakeRecords.forEach(r => {
      if (r.status === 'pending') {
        const type = r.mistakeType || "その他";
        if (counts.hasOwnProperty(type)) {
          counts[type]++;
        } else {
          counts["その他"]++;
        }
      }
    });
  }

  typesContainer.innerHTML = '';
  const badges = [
    { type: 'calc', name: '計算ミス', count: counts["計算ミス"] },
    { type: 'kanji', name: '漢字ミス', count: counts["漢字ミス"] },
    { type: 'reading', name: '読み間違い', count: counts["読み間違い"] },
    { type: 'other', name: 'その他', count: counts["その他"] }
  ];

  badges.forEach(b => {
    const span = document.createElement('span');
    span.className = `nigate-badge ${b.type}`;
    span.innerHTML = `${b.name}<span class="nigate-badge-count" style="margin-left:4px; font-size:0.65rem;">${b.count}</span>`;
    typesContainer.appendChild(span);
  });

  let maxType = "なし";
  let maxCount = 0;
  for (const [type, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      maxType = type;
    }
  }

  let advice = "間違えた問題があれば、答え合わせの際に写真やメモを記録してください。ここに苦手の傾向が表示されます。";
  if (maxCount > 0) {
    if (maxType === "計算ミス") {
      advice = `計算ミスが少し多いようです。十の位の繰り上がりをメモしておくのがおすすめです。丁寧に計算しましょう。`;
    } else if (maxType === "漢字ミス") {
      advice = `漢字の書き間違いが少し多いようです。漢字の「とめ」「はね」「はらい」を意識して、丁寧に書いて覚え直しましょう。`;
    } else if (maxType === "読み間違い") {
      advice = `問題文の読み間違いが多いようです。問われている重要な部分（〜ではないもの、等）に下線を引いて読む習慣をつけましょう。`;
    } else {
      advice = `間違えた問題は克服のチャンスです。どこで間違えたのかを確認し、同じ間違いを防ぎましょう。`;
    }
  }
  adviceTextEl.textContent = advice;

  albumGridEl.innerHTML = '';
  const pendingMistakes = gameState.mistakeRecords ? gameState.mistakeRecords.filter(r => r.status === 'pending') : [];
  
  if (pendingMistakes.length === 0) {
    albumGridEl.innerHTML = `<p style="font-size:0.75rem; color:var(--color-text-light); grid-column: 1/-1; text-align:center; padding:10px;">アルバムに登録されている写真はありません 📷</p>`;
  } else {
    const reversedMistakes = [...pendingMistakes].reverse();
    reversedMistakes.forEach(record => {
      if (record.imageUrl) {
        const item = document.createElement('div');
        item.className = 'nigate-album-item';
        item.title = `${record.date} - ${record.drillName}: ${record.mistakeText}`;
        item.innerHTML = `<img src="${record.imageUrl}" class="nigate-album-img" alt="間違い写真">`;
        
        item.addEventListener('click', () => {
          alert(`📷 ${record.date}の ${record.drillName} の間違い\n【メモ】\n${record.mistakeText}`);
        });

        albumGridEl.appendChild(item);
      }
    });

    if (albumGridEl.children.length === 0) {
      albumGridEl.innerHTML = `<p style="font-size:0.75rem; color:var(--color-text-light); grid-column: 1/-1; text-align:center; padding:10px;">写真はまだ登録されていません 📷</p>`;
    }
  }
}

// 確認ダイアログの表示 (Promiseベース - 以前のconfirm-modal要素を利用)
function showGameConfirm(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const msgEl = document.getElementById('confirm-modal-message');
    const btnYes = document.getElementById('btn-confirm-yes');
    const btnNo = document.getElementById('btn-confirm-no');
    
    if (!modal || !msgEl || !btnYes || !btnNo) {
      resolve(confirm(message));
      return;
    }
    
    msgEl.textContent = message;
    modal.classList.add('active');
    
    const cleanup = (result) => {
      modal.classList.remove('active');
      btnYes.removeEventListener('click', onYes);
      btnNo.removeEventListener('click', onNo);
      resolve(result);
    };
    
    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }
    
    btnYes.addEventListener('click', onYes);
    btnNo.addEventListener('click', onNo);
  });
}

// トースト通知の表示
function showGameToast(message, icon = '🔔') {
  const container = document.getElementById('game-toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = 'game-toast';
  toast.innerHTML = `
    <span class="game-toast-icon">${icon}</span>
    <span class="game-toast-text">${message}</span>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('show');
  }, 50);
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

// 実行！
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

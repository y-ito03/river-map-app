// wizard.js (機能ごとに分けたプログラム)

// 入力されたデータを一時的に保存する箱
let wizardData = {
    targetMarkerId: null,
    nickname: '',
    creature: '',
    image: null,
    comment: ''
};

// 外部からウィザードを開くための関数
export function openWizard(markerId) {
    wizardData.targetMarkerId = markerId; // どのピンに対して追加するかを記憶
    
    // 最初のステップを表示してモーダルを開く
    goToStep(1);
    document.getElementById('wizard-modal').classList.remove('hidden');
}

// ウィザードを閉じる・リセットする処理
document.getElementById('close-wizard').addEventListener('click', () => {
    document.getElementById('wizard-modal').classList.add('hidden');
    // データをリセットするなどの処理をここに追加できます
});

// ステップを切り替える関数
function goToStep(stepNumber) {
    document.querySelectorAll('.wizard-step').forEach(step => step.classList.remove('active'));
    document.getElementById(`step-${stepNumber}`).classList.add('active');

    // もし最終確認画面（ステップ5）なら、入力されたデータを表示する
    if (stepNumber === 5) {
        document.getElementById('confirm-nickname').innerText = document.getElementById('input-nickname').value || '（なし）';
        document.getElementById('confirm-creature').innerText = wizardData.creature || '（えらんでいない）';
        document.getElementById('confirm-comment').innerText = document.getElementById('input-comment').value || '（なし）';
    }
}

// 「つぎへ」「もどる」ボタンの設定
document.querySelectorAll('.next-btn').forEach(btn => {
    btn.addEventListener('click', (e) => goToStep(e.target.dataset.next));
});
document.querySelectorAll('.prev-btn').forEach(btn => {
    btn.addEventListener('click', (e) => goToStep(e.target.dataset.prev));
});

// 生物選択ボタンの動き
document.querySelectorAll('.creature-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        // 色を変える
        document.querySelectorAll('.creature-btn').forEach(b => b.classList.remove('selected'));
        e.target.classList.add('selected');
        // データを保存して、自動で次のステップへ進む
        wizardData.creature = e.target.dataset.name;
        goToStep(3);
    });
});

// 画像アップロードの動き（プレビュー表示）
document.getElementById('input-image').addEventListener('change', function(e) {
    if (this.files && this.files[0]) {
        let reader = new FileReader();
        reader.onload = function(event) {
            wizardData.image = event.target.result;
            document.getElementById('preview-image').src = wizardData.image;
            document.getElementById('preview-image').style.display = 'block';
            document.getElementById('confirm-image').src = wizardData.image; // 確認画面用
        };
        reader.readAsDataURL(this.files[0]);
    }
});

// 「とうろく！」ボタンを押したときの処理
document.getElementById('submit-btn').addEventListener('click', () => {
    // 最終的なテキストデータを収集
    wizardData.nickname = document.getElementById('input-nickname').value;
    wizardData.comment = document.getElementById('input-comment').value;

    console.log("【バックエンドに送信するデータ】", wizardData);
    alert(`バックエンド担当者へ:\n以下のデータを送信するAPIを呼び出します。\n\n投稿者: ${wizardData.nickname}\n生物: ${wizardData.creature}`);
    
    // 登録完了したらモーダルを閉じる
    document.getElementById('wizard-modal').classList.add('hidden');
});

// Leafletのポップアップ内ボタンから呼び出せるように、windowオブジェクトに登録する（超重要！）
window.openWizard = openWizard;
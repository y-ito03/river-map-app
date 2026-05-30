// frontend/wizard.js

// ウィザード内で入力・選択されたデータを一時的に保持するオブジェクト
window.wizardData = {
    targetMarkerId: null,
    creature: ""
};

// メインの地図（main.js）から呼び出されてウィザードを開く関数
window.openWizard = function(markerId) {
    window.wizardData.targetMarkerId = markerId;
    window.wizardData.creature = ""; // 生き物の選択をリセット
    
    // 入力欄のリセット
    document.getElementById('input-nickname').value = "";
    document.getElementById('input-comment').value = "";
    document.getElementById('input-image').value = "";
    document.getElementById('preview-image').style.display = "none";
    document.getElementById('preview-image').src = "";
    
    // いきものボタンの選択状態をリセット
    document.querySelectorAll('.creature-btn').forEach(btn => {
        btn.classList.remove('selected');
    });

    // 最初のステップ（ステップ1）を表示する
    document.querySelectorAll('.wizard-step').forEach(step => {
        step.classList.add('hidden');
        step.classList.remove('active');
    });
    document.getElementById('step-1').classList.remove('hidden');
    document.getElementById('step-1').classList.add('active');

    // モーダルを表示
    document.getElementById('wizard-modal').classList.remove('hidden');
};

// 「やめる」ボタンで閉じる
document.getElementById('close-wizard').addEventListener('click', () => {
    document.getElementById('wizard-modal').classList.add('hidden');
});

// 「つぎへ」ボタンの共通処理
document.querySelectorAll('.next-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const currentStepId = btn.closest('.wizard-step').id;
        const nextStepNum = btn.dataset.next;
        const nextStepId = `step-${nextStepNum}`;

        // 確認画面（ステップ5）に進む直前に、入力された内容を画面に反映させる
        if (nextStepNum === "5") {
            const nickname = document.getElementById('input-nickname').value || "（なまえなし）";
            const creature = window.wizardData.creature || "（えらんでないよ）";
            const comment = document.getElementById('input-comment').value || "（コメントなし）";

            // HTMLの確認用スパンテキストを書き換える
            document.getElementById('confirm-nickname').innerText = nickname;
            document.getElementById('confirm-creature').innerText = creature;
            document.getElementById('confirm-comment').innerText = comment;

            // かいた絵（写真）のプレビューを確認画面にも同期する
            const previewImg = document.getElementById('preview-image');
            const confirmImg = document.getElementById('confirm-image');
            if (previewImg.style.display !== 'none') {
                confirmImg.src = previewImg.src;
                confirmImg.style.display = 'block';
            } else {
                confirmImg.style.display = 'none';
                confirmImg.src = '';
            }
        }

        // 画面の表示切り替え
        document.getElementById(currentStepId).classList.remove('active');
        document.getElementById(currentStepId).classList.add('hidden');
        document.getElementById(nextStepId).classList.remove('hidden');
        document.getElementById(nextStepId).classList.add('active');
    });
});

// 「もどる」ボタンの共通処理
document.querySelectorAll('.prev-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const currentStepId = btn.closest('.wizard-step').id;
        const prevStepNum = btn.dataset.prev;
        const prevStepId = `step-${prevStepNum}`;

        document.getElementById(currentStepId).classList.remove('active');
        document.getElementById(currentStepId).classList.add('hidden');
        document.getElementById(prevStepId).classList.remove('hidden');
        document.getElementById(prevStepId).classList.add('active');
    });
});

// いきもの選択ボタンの処理
document.querySelectorAll('.creature-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // 他のいきものボタンの選択を一度すべて解除
        document.querySelectorAll('.creature-btn').forEach(b => b.classList.remove('selected'));
        // クリックされたボタンを選択状態にする
        btn.classList.add('selected');
        
        // 選択された生き物名前をデータに保持
        window.wizardData.creature = btn.dataset.name;

        // いきものを選んだら、少し待って自動で画像選択（ステップ3）に進む
        setTimeout(() => {
            document.getElementById('step-2').classList.remove('active');
            document.getElementById('step-2').classList.add('hidden');
            document.getElementById('step-3').classList.remove('hidden');
            document.getElementById('step-3').classList.add('active');
        }, 200);
    });
});

// 画像が選択された時のプレビュー処理
document.getElementById('input-image').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const preview = document.getElementById('preview-image');
    
    if (file) {
        const reader = new FileReader();
        reader.onload = function(event) {
            preview.src = event.target.result;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    } else {
        preview.src = '';
        preview.style.display = 'none';
    }
});

// 「とうろく！」ボタンを押したときのサーバー送信処理
// frontend/wizard.js の一番下（とうろくボタンの処理）をすべて上書き

document.getElementById('submit-btn').addEventListener('click', async () => {
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.innerText = "そうしんちゅう...";
    submitBtn.disabled = true;

    try {
        const formData = new FormData();
        formData.append('nickname', document.getElementById('input-nickname').value);
        formData.append('creature', window.wizardData.creature);
        formData.append('comment', document.getElementById('input-comment').value);

        const fileInput = document.getElementById('input-image');
        if (fileInput.files.length > 0) {
            formData.append('image', fileInput.files[0]);
        }

        //  スマホでもPCでも自動的に正しいサーバーを見つける魔法のURL
        const BACKEND_URL = `http://${window.location.hostname}:8000`;
        
        const response = await fetch(`${BACKEND_URL}/api/detections/${window.wizardData.targetMarkerId}/posts`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`サーバーエラー: ${response.status}`);
        }

        const result = await response.json();
        console.log("サーバーからの返答:", result);
        
        alert("とうろくが かんりょうしました！");
        document.getElementById('wizard-modal').classList.add('hidden');
        document.getElementById('btn-reload').click();

    } catch (error) {
        console.error("送信エラー:", error);
        alert("エラーがおきました。もういちどためしてね。");
    } finally {
        submitBtn.innerText = "とうろく！";
        submitBtn.disabled = false;
    }
});
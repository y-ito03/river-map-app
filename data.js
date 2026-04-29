// data.js

export const dummyData = {
    "group1": {
        name: "1班",
        gps_track: [
            [35.0655, 135.7846], [35.0657, 135.7847], [35.0659, 135.7847]
        ],
        detections: [
            { 
                id: "det_1_1", lat: 35.0656, lng: 135.78465, class_name: "サワガニ", timestamp: 12.5,
                // ↓ 児童からの投稿を配列で持てるようにします
                user_posts: [
                    { nickname: "ゆうき", creature: "サワガニ", comment: "いしのしたに かくれてたよ！", image: null },
                    { nickname: "はなこ", creature: "サワガニ", comment: "ハサミがおおきかった！", image: null }
                ]
            },
            { 
                id: "det_1_2", lat: 35.0658, lng: 135.7847, class_name: "コオニヤンマ", timestamp: 45.2,
                user_posts: [] // まだ誰も投稿していないケース
            }
        ]
    },
    "group2": {
        name: "2班",
        gps_track: [[35.0656, 135.7848], [35.0658, 135.7849], [35.0660, 135.7848]],
        detections: [
            { id: "det_2_1", lat: 35.0657, lng: 135.78485, class_name: "アカハライモリ", timestamp: 20.1, user_posts: [] }
        ]
    }
};
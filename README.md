# EasyKnob

EasyKnob は、ブラウザで動く声用カラオケエフェクターです。
マイク音声に `MIC` / `ECHO` / `REVERB` / `ROOM` / `WET` / `TONE` / `AIR` / `STABLE` / `DOUBLE` をかけ、VB-CABLE や BlackHole などの仮想オーディオデバイスへ出力できます。

- 公開URL: https://easyknob.web.app/
- GitHub: https://github.com/IGNORANZ-PROJECT/EasyKnob
- クレジット: ©IGNORANZ PROJECT

## 主な機能

- ブラウザ上でのリアルタイム音声処理
- 動画・ブラウザ・PC音声を共有し、マイク音声と一緒に仮想オーディオ出力へ送信
- カラオケ音源の遅延（0〜500ms）と音量を個別に調整
- エフェクト後の声とBGMを独立して音量調整
- MIC / ECHO / REVERB / ROOM / WET / TONE / AIR / STABLE / DOUBLE の9ノブ
- ROOM / WET / AIR による空間サイズ、エフェクト混ざり具合、高域の抜けの調整
- 100Hz 以下を抑え、後ろで小さく返る ECHO と、初期反射 / 拡散テール / ぼかしたサイド成分で作る REVERB
- REVERB 詳細設定による Hz 目盛り付きグラフ、複数ポイント、FREQ / GAIN / Q の専用EQ調整
- STABLE による強めの上限抑制、音量安定化、刺さる帯域の軽い圧縮
- Default / Sing / Talk のベースと My 1 / My 2 / My 3 のユーザープリセット
  - Default: 分かりやすいエコー
  - Sing: 歌用
  - Talk: 会話用
- 変更したプリセットのノブ値とON/OFFをブラウザに自動保存
- 音割れを避けるための CLIP 警告と、ハウリング抑制中の HOWL 表示
- ノブ本体、スライダー、キーボードでの操作
- エフェクトごとの有効 / 無効切り替え
- 起動状態、マイクレベル、処理負荷の簡易表示
- 設定で切り替えられるオーディオアナライザ
- 初めてでも接続手順を確認できる「初めての方へ」ガイド
- Knobを触らずに代表的な音を反映できる簡単設定ボタン
  - 決め台詞を決めたい
  - 神っぽく話したい
  - 普通に話したい
  - 歌いたい
  - ラジオっぽく話したい
- Firebase Hosting で配信できる静的 PWA 構成

## 推奨環境

- 推奨ブラウザ: デスクトップ版 Chrome / Edge
- Windows: VB-CABLE
- macOS: BlackHole

Safari や一部ブラウザでは、出力先デバイスの選択が使えない場合があります。その場合、Discord や VRChat へ渡す仮想マイク用途では正常に使えない可能性があります。

## 初回だけ必要な準備

仮想オーディオは、EasyKnobの音をVRChat、Discord、OBSへ渡すための「PC内の音のケーブル」です。物理的なケーブルは必要ありません。

### Windows

1. [VB-CABLE公式サイト](https://vb-audio.com/Cable/index.htm)からドライバーをダウンロードします。
2. ZIPを展開し、`VBCABLE_Setup_x64.exe`を管理者として実行します。
3. `Install Driver`を押してPCを再起動します。
4. EasyKnobの`Output`を`CABLE Input`、VRChatやDiscordのマイクを`CABLE Output`にします。

### Mac

1. [BlackHole公式サイト](https://existential.audio/blackhole/download/)から`BlackHole 2ch`をダウンロードします。
2. パッケージを開いてインストールし、Chromeと使用するアプリを開き直します。
3. EasyKnobの`Output`とVRChatやDiscordのマイクを`BlackHole 2ch`にします。

## 低遅延と音質の推奨設定

- BluetoothイヤホンのマイクをInputにすると、OSの通話モードによって再生音まで大きく劣化する場合があります。Bluetoothイヤホンは再生専用にし、InputにはPC内蔵マイクまたはUSBマイクを選んでください。
- Discord、OBS、VRChat などの入力側で、ノイズ抑制、エコー除去、自動ゲイン調整、音量自動調整を OFF にしてください。
- Windows のサウンド設定やメーカー製ユーティリティで、音声拡張、空間オーディオ、マイク補正、ノイズ抑制が有効な場合は OFF 推奨です。
- Windows の「このデバイスを聴く」、Discord のマイクテスト、OBS の音声モニタリングなど、EasyKnob 以外の監視音は OFF 推奨です。二重に聞くと遅延が強く感じられます。
- EasyKnob 側では、原音に近い音にしたい時は `STABLE` / `ECHO` / `REVERB` / `ROOM` / `WET` / `AIR` / `DOUBLE` を OFF または低めにしてください。
- `AUDIO ANALYZER` は確認用です。低遅延と軽さを優先する場合は OFF のまま使ってください。
- ハウリングを避けるため、スピーカー監視ではなくヘッドホンまたは仮想オーディオ出力を使ってください。`HOWL` が出る場合は `MIC` / `WET` / `ECHO` / `REVERB` / `DOUBLE` を下げ、Output をスピーカー以外にしてください。

## 仕組み

EasyKnob は Web Audio API と AudioWorklet を使って、マイク入力をブラウザ内で処理します。
処理後の音声を選択した出力デバイスへ再生し、その出力を Discord や VRChat 側の入力デバイスとして受け取る構成です。

マイク音声はブラウザ内で処理されます。このアプリはマイク音声をサーバーへアップロードしません。

## VRChatのカラオケワールド

VRChat内ですでに全員が同じ音源を聞いている場合は、EasyKnobのBGMを接続せず声だけを出力します。音源の遅延はワールド側で調整します。

## 動画・アプリの音を声に合わせる

1. EasyKnobをONにします。
2. 動画やカラオケ音源をイヤホンなどで通常どおり再生し、「音源を選ぶ」を押します。
3. 共有画面で対象のタブ、ウィンドウ、または画面を選び、「音声を共有」をONにします。
4. `SYNC`で声と伴奏を合わせ、`VOICE`と`BGM`で出力音量を調整します。

自分は元音源を遅延なしで聴き、EasyKnobからは声と同期した音源をスピーカーや配信へ出します。元音源とEasyKnobのOutputを同じ機器で聴くと二重に聞こえます。EasyKnob自身のタブを共有するとフィードバックの原因になるため、動画を再生している側を選んでください。OSとブラウザにより、共有できる音声の範囲は異なります。

## Windows / VB-CABLE

1. VB-CABLE をインストールします。
2. Chrome または Edge で EasyKnob を開きます。
3. EasyKnob の `Output` を `CABLE Input` にします。
4. Discord、VRChat などの入力デバイスを `CABLE Output` にします。
5. EasyKnob を `ON` にします。初回はONを押した後にブラウザのマイク許可が表示されるので、許可してください。
6. 状態が `LIVE` になったら、ノブや簡単設定ボタンで音を調整します。

## macOS / BlackHole

1. BlackHole をインストールします。
2. Chrome または Edge で EasyKnob を開きます。
3. EasyKnob の `Output` を `BlackHole` にします。
4. Discord、VRChat などの入力デバイスを `BlackHole` にします。
5. EasyKnob を `ON` にします。初回はONを押した後にブラウザのマイク許可が表示されるので、許可してください。
6. 状態が `LIVE` になったら、ノブや簡単設定ボタンで音を調整します。

## セキュリティとプライバシー

- 静的サイトで、アプリ用のバックエンド処理はありません。
- マイク音声はブラウザ内で処理されます。
- Firebase Hosting では CSP、フレーム埋め込み制限、Content-Type 保護、Referrer-Policy、Permissions-Policy を設定しています。

## 免責事項

本アプリの利用により発生した音量設定、聴覚、音響機器、配信、通話、ゲーム、仮想オーディオデバイス、OS やブラウザ設定に関する問題、損害、トラブルについて、作者および IGNORANZ PROJECT は責任を負いません。使用前に音量を低めに設定し、各環境で十分に確認してください。

VB-CABLE、BlackHole、Discord、VRChat などの外部ソフトウェアやサービスは、それぞれの提供元の規約、ライセンス、サポート方針に従って利用してください。

## ライセンス

MIT License で公開します。詳細は [LICENSE](LICENSE) を確認してください。

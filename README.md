# EasyKnob

EasyKnob は、ブラウザで動く声用カラオケエフェクターです。
マイク音声に `MIC` / `ECHO` / `REVERB` / `TONE` / `STABLE` / `DOUBLE` をかけ、VB-CABLE や BlackHole などの仮想オーディオデバイスへ出力できます。

- 公開URL: https://easyknob.web.app/
- GitHub: https://github.com/IGNORANZ-PROJECT/EasyKnob
- クレジット: ©IGNORANZ PROJECT

## 主な機能

- ブラウザ上でのリアルタイム音声処理
- MIC / ECHO / REVERB / TONE / STABLE / DOUBLE の6ノブ
- ノブ本体、スライダー、キーボードでの操作
- エフェクトごとの有効 / 無効切り替え
- 処理負荷、レイテンシ、サンプルレート、有効エフェクト数の表示
- 周波数バーと波形を表示するオーディオアナライザ
- Firebase Hosting で配信できる静的 PWA 構成

## 推奨環境

- 推奨ブラウザ: デスクトップ版 Chrome / Edge
- Windows: VB-CABLE
- macOS: BlackHole

Safari や一部ブラウザでは、出力先デバイスの選択が使えない場合があります。その場合、Discord や VRChat へ渡す仮想マイク用途では正常に使えない可能性があります。

## 仕組み

EasyKnob は Web Audio API と AudioWorklet を使って、マイク入力をブラウザ内で処理します。
処理後の音声を選択した出力デバイスへ再生し、その出力を Discord や VRChat 側の入力デバイスとして受け取る構成です。

マイク音声はブラウザ内で処理されます。このアプリはマイク音声をサーバーへアップロードしません。

## Windows / VB-CABLE

1. VB-CABLE をインストールします。
2. Chrome または Edge で EasyKnob を開きます。
3. EasyKnob の `Output` を `CABLE Input` にします。
4. Discord、VRChat などの入力デバイスを `CABLE Output` にします。
5. EasyKnob を `ON` にして、ノブを調整します。

## macOS / BlackHole

1. BlackHole をインストールします。
2. Chrome または Edge で EasyKnob を開きます。
3. EasyKnob の `Output` を `BlackHole` にします。
4. Discord、VRChat などの入力デバイスを `BlackHole` にします。
5. EasyKnob を `ON` にして、ノブを調整します。

## ローカル開発

このプロジェクトは静的サイトです。ビルド手順は不要です。

```bash
cd public
python3 -m http.server 8080
```

ブラウザで開きます。

```text
http://localhost:8080
```

Firebase Hosting のエミュレータで確認する場合:

```bash
firebase emulators:start --only hosting
```

## Firebase Hosting へのデプロイ

`firebase.json` は `public` ディレクトリを公開対象にしています。

```bash
firebase deploy --only hosting --project easyknob
```

## ファイル構成

```text
public/
  index.html
  styles.css
  app.js
  audio-worklet.js
  sw.js
  manifest.webmanifest
  robots.txt
  sitemap.xml
firebase.json
README.md
LICENSE
```

## セキュリティとプライバシー

- 静的サイトで、アプリ用のバックエンド処理はありません。
- マイク音声はブラウザ内で処理されます。
- Firebase Hosting では CSP、フレーム埋め込み制限、Content-Type 保護、Referrer-Policy、Permissions-Policy を設定しています。
- 将来 Firestore、Storage、Realtime Database、Authentication などを追加する場合は、公開前に Security Rules と App Check を設定してください。

## ライセンス

MIT License で公開します。詳細は [LICENSE](LICENSE) を確認してください。

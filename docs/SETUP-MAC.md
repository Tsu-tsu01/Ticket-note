# Mac で push して GitHub Pages に出すまで

zip をダウンロードフォルダに展開した状態から始める。`gh` CLI を使う手順。

## 1. 展開して動作確認

```bash
cd ~/Downloads
unzip -q Ticket-note.zip
cd Ticket-note
python3 -m http.server 8000
```

ブラウザで http://localhost:8000 を開く。半券が 12 枚出れば OK。
確認できたら `Ctrl+C` でサーバを止める。

## 2. リポジトリを作って push

```bash
cd ~/Downloads/Ticket-note
git init -b main
git add -A
git commit -m "Ticket note 初期構築：DB スキーマ + 静的アプリ"
gh repo create Ticket-note --public --source=. --remote=origin --push
```

プライベートにするなら `--public` を `--private` に変える。
ただし **Pages を無料で公開できるのは public リポジトリだけ**（Pro なら private でも可）。

## 3. Pages を有効化

```bash
gh api -X POST repos/:owner/Ticket-note/pages \
  -f 'build_type=workflow'
```

うまくいかないときは Web UI から:
リポジトリ → Settings → Pages → **Build and deployment / Source** を **GitHub Actions** にする。

## 4. デプロイの確認

push すると `.github/workflows/pages.yml` が走る。

```bash
gh run watch          # 進行状況
gh run list --limit 3 # 履歴
```

`validate` ジョブが CSV の整合性をチェックし、通れば `deploy` が Pages に上げる。
CSV に壊れた行があるとここで止まるので、公開版が壊れることはない。

公開 URL:

```
https://tsu-tsu01.github.io/Ticket-note/
```

```bash
gh browse            # ブラウザで開く
```

## 5. 以降の更新

CSV を直して push するだけ。

```bash
cd ~/Downloads/Ticket-note
node scripts/validate.mjs          # 手元でチェック
git add -A && git commit -m "10th Act-3 のセトリを追加" && git push
```

セットリストのファイルを**新しく足した**ときだけ、先に manifest を更新する。

```bash
node scripts/validate.mjs --write
```

---

## つまずきやすいところ

**404 になる**
Pages の Source が `GitHub Actions` になっているか確認する。
`Deploy from a branch` にしていると `.github/workflows` が走らず、`.nojekyll` があっても構成が変わる。

**CSV を直したのにサイトが変わらない**
ブラウザのキャッシュ。スーパーリロード（Mac は `Cmd+Shift+R`）で消える。

**セトリを追加したのにアプリに出ない**
`data/manifest.json` の `setlists` 配列に入っていない。`node scripts/validate.mjs --write` を実行する。

**Actions が赤くなる**
`gh run view --log-failed` でエラー行が出る。`data/xxx.csv:12 ...` の形式なので、
VSCode でそのファイルの 12 行目を開けばいい。

**日本語ファイル名で文字化けする**
このリポジトリには日本語ファイル名はない。中身は全部 UTF-8 / LF。
`git config core.precomposeunicode true` を入れておくと Mac 由来の濁点問題を避けられる。

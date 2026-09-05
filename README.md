# Ticket note — アイマス ライブ参戦ログ

行ったライブを選ぶと、複数回聴いた曲・編成・オリメン回収率などの統計が出る、静的な個人用ツール。
ビルド不要。GitHub Pages に置いた `data/*.csv` をブラウザが直接読む。

- 非公式ファンメイド。THE IDOLM@STER は株式会社バンダイナムコエンターテインメントの登録商標。

---

## 同梱データについて

**公演 50 件・セットリスト 1,464 行**（2014年 MOIW と 2025〜2026年の各ブランド）。
提供された情報から起こしたもので、公式に照合していないので全行 `verified=false`。

- 楽曲 1,955 曲、アイドル 254 人（うち 252 人にキャラカラー設定済み）。
- **全ブランドの本編を全曲収録**。
  ミリオン441 / デレ429 / SideM386 / シャニ273 / 765AS256 / 学マス101 / vα-liv29 / 961 18 / 876 9 / 合同13。
- リミックスとカバーは `tags` に `remix` / `cover` を付ければ本編と分けて扱える。
  未回収リスト・カバー率からは既定で除外され、楽曲タブのチップで表示に切り替えられる。
  ソース側のタグは `[MILR]` `[MILC]` `[CINR]` `[CINC]` `[MIL別]` `[CIN別]` で自動判別する。
- 確証の取れなかった CV 名は空欄にしてある（誤った名前を残さないため）。

`node scripts/validate.mjs` を叩くと、かな・CV が空の行が warn で出る。

---

## 使い方（ローカル）

`file://` では `fetch` が動かないので HTTP サーバ経由で開く。

```bash
cd imas-live-log
python3 -m http.server 8000
# → http://localhost:8000
```

## データの足し方

生データは `data/_source/` に置いてあり、そこから CSV を生成する。CSV を直接いじってもいいが、
**大量に足すときはソースに貼ってビルドし直すほうが速い**。

### キャラカラー・ブランドカラー

`data/_source/colors.tsv` に `種別 / ブランド / 名前 / カラーコード / CV` のタブ区切りで書く。
`idols.csv` に無い名前は**自動で新規追加**されるので、名簿ごと一気に取り込める。

```bash
node scripts/build-colors.mjs   # → brands.csv / idols.csv / units.csv を更新
```

自動追加されたアイドルの ID は `cg_x001` のような仮 ID になる。
読みやすい ID に変えたい場合は `idols.csv` を直接書き換えればよい（他の CSV から参照される前に変えること）。

### 楽曲

`data/_source/songs.tsv` は一覧サイトからコピーしたタブ区切りをそのまま貼れる形式。

```
[GKM]	曲名	(ソロ)花海咲季	2024/05/01	YouTubeでフルMV公開
[MILR]	Thank You! (TeddyLoid Remix)	(アレンジ)TeddyLoid	2021/01/23	LTP Remix 01
```

ブランドタグ: `GKM` `SYC` `SdM` `MIL` `CIN` `765` `876` `VLV` `961` `合同`。
リミックス・カバーは `MILR` `MILC` `CINR` `CINC` `MIL別` `CIN別` を使うと自動でタグが付く。

歌唱欄からオリメン（`original_members`）を自動で解決する。
ソロ名・短縮名（春香／千早…）・CV 名・ユニット名のどれでも引ける。

```bash
node scripts/build-songs.mjs     # → data/songs.csv
```

解決できなかった名前は実行時に一覧で出る。`idols.csv` の `alias` か `units.csv` に足せば次から通る。

### 公演とセットリスト

セトリwikiから取り込む場合は HTML パーサが使える。
ブラウザで F12 を開き、セトリの `<table class="InfoboxLive2">` を右クリック →
Copy → Copy outerHTML でコピーしてファイルに保存し、

```bash
node scripts/parse-setlist-html.mjs setlist.html \
  --id 20140222_moiw2014_d1 --date 2014-02-22 --venue v_saitama_ssa \
  --brand crossover --tour t_moiw2014 --perf cast >> data/_source/lives/2014-moiw.txt
```

曲名の「（GAME Ver・メドレー）」「（M@STER VERSION）」等は自動で尺に変換される。
アンコールの行を `main` → `encore` に直すのと、歌唱者に残った注記を消すのは手作業。

手で書く場合は `data/_source/lives/*.txt` に直接書く。

```
@live id=20260820_gk_shirube_fukui_d1 tour=t_gk_shirube title=... day=DAY1 date=2026-08-20 \
      venue=v_fukui_phoenix brand=gk event=solo perf=cast stream=false lv=false archive=false status=confirmed
1|main|つよつよ最強エクササイズ|松田彩音
9|main|L’Espoir|七瀬つむぎ|premiere
16|encore|古今東西ちょちょいのちょい|薄井友里、松田彩音、花岩香奈、七瀬つむぎ
```

- 歌唱者は**キャスト名でもキャラ名でもユニット名でもいい**。
- `ユニット名［A、B］` と書いた場合は括弧内の実際の出演者だけを採る（欠席者がいても正しく入る）。
- フラグ: `premiere`（初披露） / `xr`・`cast`（その曲だけ形式が違う） / `medley:キー`
- `is_original` は `songs.csv` のオリメンと突き合わせて自動で埋まる。あとから手で直せる。

```bash
node scripts/build-lives.mjs     # → data/lives.csv + data/setlists/<年>.csv
node scripts/validate.mjs --write
```

## データの検証

```bash
node scripts/validate.mjs           # 整合性チェックのみ
node scripts/validate.mjs --write   # manifest.json の件数・ファイル一覧も更新
```

エラーは `data/lives.csv:14 venue_id "v_typo" が存在しません` の形で出る。
CI（`.github/workflows/pages.yml`）でも同じものが走り、エラーがあればデプロイされない。

**セットリストのファイルを増やしたら `--write` を必ず実行する。**
アプリは `data/manifest.json` の `setlists` 配列に書かれたファイルしか読まない。

---

## データ構造

`data/` 以下のフラットな CSV。UTF-8 / LF / ヘッダ行あり。
セル内で複数値を並べるときは `;` 区切り（空白なし）。真偽値は `true` / `false`。
色は `#RRGGBB` の大文字。日付は `YYYY-MM-DD`。

```
brands.csv          ブランド（765AS / 876 / 961 / CG / ML / SideM / SC / 学マス / vα-liv / 越境 / その他）
idols.csv           アイドル：名前・かな・CV・キャラカラー・ブランド
cv_assignments.csv  CV の交代履歴（公演日時点の CV を解決するのに使う）
units.csv           ユニット
songs.csv           楽曲：オリメン（original_members）・song_type・タグ
venues.csv          会場：規模（scale）
tours.csv           ツアー
lives.csv           公演（1日1会場＝1行。DAY1 / DAY2 は別行）
setlists/YYYY.csv   セットリスト（公演 × 曲順の縦持ち）
manifest.json       読み込むファイル一覧・規模と公演種別の定義
_source/            CSV の生成元（songs.tsv / lives/*.txt）
```

### ID の付け方

連番ではなく**読める ID**にしてある。`Cmd+Shift+F` で追える。

| テーブル | 形式 | 例 |
|---|---|---|
| idol | `<brand>_<romaji>` | `ml_mirai` `765as_haruka` |
| song | `s_<romaji>` | `s_thankyou` |
| venue | `v_<場所>` | `v_saitama_ssa` |
| live | `<YYYYMMDD>_<略称>` | `20230715_ml10th_d1` |

一度公開した ID は変えない。表記ゆれは `alias` 列で吸収する。

### 会場規模（`venues.scale`）

| 値 | 表示 | 目安 |
|---|---|---|
| `dome` | ドーム級 | 東京ドーム・京セラドーム等 |
| `ssa` | 特大アリーナ | SSA 等 2 万規模 |
| `arena_l` | 大アリーナ | 1〜2 万 |
| `arena_s` | 小アリーナ | 1 万未満 |
| `hall` | ホール | |
| `livehouse` | ライブハウス | |
| `overseas` | 海外 | 規模によらず海外公演はすべてこれ |
| `online` | 配信 | 無観客・配信専用（会場は `v_online`） |

「前回披露」や「未回収楽曲」の一覧では、この規模と公演種別（単独 / 合同 / イベント / リリイベ / 配信番組）を
チェックボックスで選んで対象を絞れる。「ライブハウスやリリイベでの披露は数えたくない」がやりたいこと。

### 尺（メドレー・ショート等）

`setlists.version` に `medley` / `short` / `half` / `game` / `acoustic` が入る（空＝フル尺）。
ソース側で曲名に `(Medley ver.)` `(SHORT ver.)` `(GAME ver.)` `(Half ver.)` と書けば自動で入る。
明示したいときは行末フラグ `ver:medley` を使う。

集計側は「ぜんぶ数える／メドレーは数えない／フル尺のみ」の3択。
現在のデータだと キャストライブで 延べ1,168曲（ぜんぶ）→ メドレー除く → フルのみ、と段階的に減る。

### ブランドの数え方

**曲の集計は「曲そのもののブランド」で行う。**
越境公演（MOIW / IWSF）で披露された学マス曲は、公演のブランド（crossover）ではなく
学マスに数える。カバー率も未回収リストも同じ基準。
公演数のブランド別内訳だけは「公演のブランド」を使う（越境公演は crossover のまま）。

### ライブの形式（キャスト / xR）

`lives.performance_type` に `cast`（キャストライブ）/ `xr`（xR・CGライブ）/ `mixed` を持つ。
1曲だけ形式が違う場合（キャストライブ中の xR 登場など）は `setlists.stage_type` で上書きできる。

画面右上のボタンから「**キャストライブだけを回収と数える / xR も数える**」を切り替えられる。
ただし**現地で観た公演はこの設定に関係なく必ず数える**。効くのは配信・アーカイブで観た分だけ。
xR公演に現地参戦していれば楽曲は回収されるが、キャストに会ったとは数えないので
「未回収キャスト」からは消えない。両方を有効にしてもキャストとxRは分けて集計する。
現地・LV・配信の切り替えと独立しているので、「現地のキャストライブだけ」も
「配信込み・xR込み」も出せる。

### オリメン判定

`setlists/*.csv` の **`is_original` 列**が判定の本体。

| 値 | 意味 |
|---|---|
| `true` | この披露はオリメン歌唱 |
| `false` | オリメンではない |
| 空欄 | 未入力。`songs.original_members` と `performers` を突き合わせて自動判定する |

自動判定の厳しさはアプリの「設定」で 3 段階から選べる。

- **CSV のフラグを優先**（既定）— `is_original` を使い、空欄の行だけ自動判定で補う
- **完全一致のみ** — 歌唱メンバーがオリメンと完全一致したときだけ回収
- **オリメン全員いればOK** — ゲストが加わっていてもオリメンが揃っていれば回収

さらに、**セットリスト画面で 1 曲ずつタップして上書きできる**。
上書きはルールより優先され、`origOverride` としてブラウザに保存される。
「この編成をオリメンと呼ぶか」は解釈が割れるので、最終判断はユーザ側に置いてある。

---

## 参戦記録の保存先

localStorage（キー `ticketnote.v1`）。サーバには何も送らない。
機種変更の前に「設定 → JSON を書き出す」でバックアップを取る。

---

## 中身

```
index.html
assets/app.css        方眼ノート＋半券のスタイル
assets/js/
  csv.js              依存なしの CSV パーサ
  text.js             かな/カナ・全角半角の検索正規化、輝度計算
  store.js            localStorage
  db.js               CSV → インデックス、CV 解決、オリメン自動判定
  stats.js            集計、前回披露、未回収抽出
  card.js             Canvas で PNG カードを描く
  main.js             画面とルーティング（半券 / 統計 / 楽曲 / ティア / 設定）
scripts/lib.mjs       CSV / 名前解決の共通処理
scripts/parse-setlist-html.mjs  セトリwikiのHTML → lives/*.txt
scripts/build-songs.mjs  songs.tsv → songs.csv
scripts/build-lives.mjs  lives/*.txt → lives.csv + setlists/
scripts/validate.mjs  CSV バリデータ
```

依存パッケージなし。フォントだけ Google Fonts（Zen Maru Gothic / Zen Kaku Gothic New / DotGothic16）。

---

## 公開手順

`docs/SETUP-MAC.md` を参照。

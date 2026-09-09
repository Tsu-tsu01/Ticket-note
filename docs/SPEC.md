# アイマス ライブ参戦ログ アプリ 仕様書 v0.8

> v0.7 からの変更
> - **ティア表メーカー**を追加（S〜F の7段階、PNG書き出し）
> - **現地で観た公演は形式フィルタに関係なく回収に数える**ように変更。xR公演でも現地なら楽曲は回収扱い（キャストは変わらず未回収のまま）
> - セトリwikiの HTML から `lives/*.txt` を起こすパーサ `scripts/parse-setlist-html.mjs` を追加
> - MOIW2014 の2公演を追加（計50公演 / 1,464行）
>
> v0.6 からの変更
> - 765AS・SideM・876・vα-liv の楽曲も本編全曲に拡張（計 1,955 曲、全ブランド収録完了）
>
> v0.5 からの変更
> - ミリオン・デレ・シャニの楽曲を本編全曲に拡張（計 1,441 曲）
> - song_id を曲名のハッシュから決めるようにして、再ビルドしても変わらないようにした
> - リミックス・カバーを `tags` で区別し、未回収リストとカバー率から既定で除外
>
> v0.4 からの変更
> - 曲のブランド別集計を「曲そのもののブランド」基準に統一（越境公演の学マス曲は学マスに数える）
> - 未回収リスト／オリメン未回収リストにブランド別の残数を表示
> - キャストライブと xR ライブを分けて集計・表示。xR はキャストの回収に数えない
> - 幕張メッセ イベントホールを arena_s（1万人未満）に修正
> - 公演を 48 件・セットリスト 1,356 行に拡張（デレステ10thツアー全公演ほか）
>
> v0.3 からの変更
> - `setlists.version`（medley / short / half / game / acoustic）を追加。集計は「ぜんぶ／メドレー除く／フルのみ」の3択
> - まとめの各数値に一行の説明を表示
> - 「どれだけ聴いたか」（延べ／ユニーク／ブランド別カバー率）を追加
> - 未回収リストに並び替え（最終披露が新しい順 / 古い順 / 曲名順）を追加
> - 「未回収キャスト」タブを追加。xR公演での登場はキャストに会ったと数えない
> - キャラカラー・ブランドカラーを `data/_source/colors.tsv` から一括投入（254人中252人に設定）
> - 公演を 28 件・セットリスト 760 行に拡張
>
> v0.2 からの変更
> - アプリ名を **Ticket note** に変更
> - **ライブ形式 `performance_type`（cast / xr / mixed）** を公演に追加。1曲単位の上書きは `setlists.stage_type`
> - 「回収と数える形式」をユーザが選べるように（キャストライブのみ／xR も含める）
> - 仮の公演データを全削除し、実データ 18 公演 / 437 行に差し替え
> - `data/_source/` の生データから CSV を生成するビルドスクリプトを追加
> - `[hidden]` が CSS の `display` に負けて画面全体が操作不能になる不具合を修正
>
> v0.1 からの変更（実装にあわせて確定）
> - 会場規模から `is_overseas` フラグを廃止し、**海外は `scale=overseas` の一区分**に統合（アリーナ/ホールの区別なし）
> - ブランドに **876 / 961 / vα-liv** を追加（計 9 ブランド + 越境 + その他）
> - オリメン判定を `setlists.is_original`（true/false/空）で持ち、**空欄のみ自動判定**。ユーザ側の上書きも可能に
> - Vite / Svelte をやめて**ビルド無しの素の ES モジュール**に変更（push だけで公開できるため）
> - `tours.csv` は残すが必須ではない（`tour_id` は空でよい）

> リポジトリ名: **Ticket-note** ／ アプリ名: **Ticket note**
> 最終更新: 2026-08-29

---

## 0. TL;DR

- GitHub Pages 上の**完全静的**アプリ。DB は `data/*.csv` を fetch して**ブラウザ側で直読み**する。サーバ・DB サーバは持たない。
- DB は **リレーショナルなフラット CSV 6〜8枚**。VSCode（Rainbow CSV / Edit csv）でそのまま編集でき、`Cmd+Shift+F` で全文検索でき、git diff が行単位で読める。
- ユーザは「行った公演」をチェックするだけ。統計はすべてクライアント計算。ユーザデータは localStorage + JSON エクスポート。
- 統計カードを **PNG 書き出し**（`2026年8月29日時点` 形式のタイトル入り）。
- UI は「**ライブの半券をノートに貼ったスクラップブック**」＋「**会場の LED ビジョン**」。よくある AI 製 SaaS ダッシュボード調は明示的に禁止（§7.6）。

---

## 1. ゴールと非ゴール

### 1.1 ゴール
1. アイマス各ブランドの **アイドル / 楽曲 / 会場 / 公演 / セットリスト** を一元的に持つ、編集しやすい静的 DB を作る。
2. ユーザが参戦した公演を選ぶと、オタクが見て嬉しい統計が出る。
3. 統計を画像として保存し、SNS に貼れる。
4. 「現地のみ」「配信込み」を切り替えて、回収状況の差分を見られる。

### 1.2 非ゴール（v1では扱わない）
- ログイン / サーバ側ユーザ管理（ローカル保存 + エクスポートで代替）
- 音源・映像の再生
- セトリの自動クロール（データは手動 + PR 運用）
- 複数ユーザの比較機能（v2 で検討 → §10）

---

## 2. 用語定義

| 用語 | 定義 |
|---|---|
| 公演 (live) | 1 日 1 会場の 1 パフォーマンス。ツアーの DAY1 / DAY2 は**別レコード** |
| ツアー (tour) | 複数公演をまとめる興行単位（例: MILLION LIVE 10th TOUR） |
| セトリ行 (setlist row) | 「どの公演で、何番目に、どの曲を、誰が歌ったか」の 1 行 |
| オリメン | その楽曲の原曲歌唱アイドル（`songs.original_members`） |
| 編成 (lineup) | ある公演でその曲を歌ったアイドルの集合。同じ曲でも編成が違えば別物として数える |
| 回収 | ある楽曲 / 編成を自分が生で（または配信で）聴いた状態 |
| 参戦モード | `onsite`（現地） / `lv`（ライブビューイング） / `stream`（生配信） / `archive`（アーカイブ視聴） |

---

## 3. システム構成

```
GitHub リポジトリ
├── data/                 ← DB 本体（真実の情報源、手で編集する）
│   ├── brands.csv
│   ├── idols.csv
│   ├── cv_assignments.csv
│   ├── units.csv
│   ├── songs.csv
│   ├── venues.csv
│   ├── tours.csv
│   ├── lives.csv
│   └── setlists/
│       ├── 2005-2015.csv
│       ├── 2016.csv
│       │   …年別に分割（差分が読みやすく、遅延ロードもできる）
│       └── 2026.csv
├── data/manifest.json    ← CI が自動生成（ファイル一覧・行数・ハッシュ）
├── scripts/validate.mjs  ← CI 用バリデータ
├── src/                  ← アプリ本体
└── .github/workflows/    ← validate + Pages デプロイ
```

- **ビルド無し**。`index.html` + 素の ES モジュールで、リポジトリのルートをそのまま Pages で配信する。GitHub Pages に置かれた CSV を `fetch('./data/idols.csv')` でブラウザが直接読む。中間フォーマットへの変換は一切しない（要件どおり）。
- `data/manifest.json` が読み込み対象ファイル一覧・規模/公演種別の定義・件数を持つ。セットリストのファイルを増やしたら `node scripts/validate.mjs --write` で更新する。
- CSV パースは依存なしの自前パーサ（`assets/js/csv.js`、RFC4180 相当の引用符処理つき）。

---

## 4. データ設計

### 4.1 共通ルール

| 項目 | 決め |
|---|---|
| 文字コード | UTF-8 (BOM なし)、改行 LF |
| 区切り | `,`（カンマ）。ヘッダ行必須 |
| セル内複数値 | `;`（セミコロン）区切り。**空白を入れない** → `765_haruka;765_chihaya` |
| 空値 | 空文字（`NULL` などと書かない） |
| 日付 | `YYYY-MM-DD`。不明な日は `YYYY-MM` / `YYYY` も許容 |
| 真偽値 | `true` / `false` |
| 色 | `#RRGGBB`（小文字禁止、大文字統一） |
| 引用 | カンマを含む値のみ `"` で囲む。原則タイトルにカンマを入れない |
| ID | **人間が読めるスラッグ**。連番 ID は使わない（grep できないため） |
| ソート順 | 各ファイルは ID 昇順で保存（差分を安定させる） |

**ID 命名規則**

| テーブル | 形式 | 例 |
|---|---|---|
| brand | `<短縮名>` | `765as`, `cg`, `ml`, `sm`, `sc`, `gk` |
| idol | `<brand>_<romaji>` | `ml_mirai`, `cg_uzuki`, `765as_haruka` |
| unit | `u_<romaji>` | `u_beit`, `u_rasenbaton` |
| song | `s_<romaji>` | `s_thankyou`, `s_uni_on` |
| venue | `v_<都市>_<略称>` | `v_saitama_ssa`, `v_tokyo_dome` |
| tour | `t_<brand><回次>` | `t_ml10th`, `t_cg7th` |
| live | `<YYYYMMDD>_<tour>_<day>` | `20260829_ml10th_d1` |

> ID は一度公開したら変えない。表記ゆれ対応は `alias` 列で吸収する。

---

### 4.2 `brands.csv` — ブランドマスタ

```csv
brand_id,name,short_name,color_primary,color_secondary,sort_order,is_pseudo,notes
765as,アイドルマスター(765プロオールスターズ),765AS,...,10,false
876,アイドルマスター ディアリースターズ,876,...,20,false
961,961プロダクション,961,...,30,false
cg,アイドルマスター シンデレラガールズ,CG,...,40,false
ml,アイドルマスター ミリオンライブ！,ML,...,50,false
sm,アイドルマスター SideM,SideM,...,60,false
sc,アイドルマスター シャイニーカラーズ,SC,...,70,false
gk,学園アイドルマスター,学マス,...,80,false
valiv,vα-liv,ヴイアラ,...,85,false
crossover,越境,越境,...,90,true
other,その他,その他,...,99,true
```

> **ブランドカラーの hex は要確定**。公式に色指定があるものはそれを、無いものは慣習色を採用したいので、値は Tsubasa 側で埋めてほしい（アプリ側は `brands.csv` を唯一の参照元にする）。

`is_pseudo=true` は「実ブランドではない分類」を意味し、統計のブランド別集計では `crossover` / `other` を別枠で表示する。

---

### 4.3 `idols.csv` — アイドルマスタ

```csv
idol_id,name,name_kana,name_en,brand_id,color,color_name,age,birthday,height,cv_current,unit_primary,debut_date,alias,is_active,notes
ml_mirai,春日未来,かすがみらい,Mirai Kasuga,ml,#XXXXXX,,,,,,,,,true,
765as_haruka,天海春香,あまみはるか,Haruka Amami,765as,#XXXXXX,,,,,,,,,true,
```

| 列 | 型 | 説明 |
|---|---|---|
| `name_kana` | ひらがな | 五十音ソート・かな検索用（**必須**） |
| `color` | hex | キャラカラー。UI の主役 |
| `color_name` | text | 「みらいいろ」等の呼称があれば |
| `cv_current` | cv_id | 現行 CV。履歴は `cv_assignments.csv` |
| `unit_primary` | unit_id | 常設ユニット所属があれば |
| `alias` | `;` 区切り | 「はるるん」「Pちゃん」等、検索でヒットさせたい別名 |

> 既存の「ミリオン楽曲 HTML DB」にキャラカラー約 40 + 765PRO 13 名分が入っているので、それを初期データとして流用する。

### 4.4 `cv_assignments.csv` — CV 履歴（担当声優の交代に対応）

```csv
idol_id,cv_id,cv_name,cv_name_kana,valid_from,valid_to,reason,notes
ml_mirai,cv_yamazaki,山崎はるか,やまざきはるか,2013-02-27,,,
```

- `valid_to` 空 = 現行。
- 交代・卒業・代役（1公演限りの代打）も行を足すだけで表現できる。
- 統計の「CV 別遭遇回数」は、**公演日時点で有効な CV** を引いて算出する。

### 4.5 `units.csv` — ユニットマスタ

```csv
unit_id,name,name_kana,brand_id,member_idol_ids,color,unit_type,formed_date,alias,notes
u_beit,Beit,ばいと,sm,sm_pierre;sm_minori;sm_kyoji,#XXXXXX,permanent,,,
```

- `unit_type`: `permanent`（常設） / `song`（楽曲単位の編成） / `event`（期間限定・イベント） / `brand`（ブランド全体名義）

### 4.6 `songs.csv` — 楽曲マスタ

```csv
song_id,title,title_kana,title_en,brand_id,unit_id,original_members,original_cv_ids,song_type,tags,release_date,source,is_cover,cover_of,bpm,notes
s_thankyou,Thank You!,さんきゅー,,ml,,ml_mirai;ml_shizuka,,unit,anthem,2013-02-27,ML,false,,,
```

| 列 | 説明 |
|---|---|
| `original_members` | **オリメン判定の基準**。`;` 区切り idol_id。全体曲は全員列挙。空なら判定対象外（インスト等） |
| `song_type` | `solo` / `unit` / `all` / `instrumental` / `cover` / `medley` |
| `tags` | `;` 区切り。`crossover`（越境） / `console`（家庭用ゲーム機） / `anime` / `collab` / `theme`（OP/ED） / `event_limited` など |
| `source` | 初出媒体（`ML THE@TER 01` / `SS3A` / `アニメ2期 ED` 等）。自由記述だが表記を揃える |
| `brand_id` | **リリース元ブランド**。歌唱メンバーが複数ブランドに跨る場合は `tags` に `crossover` を付ける。「実際に跨っているか」は `original_members` から自動判定するのでどちらでも整合が取れる |

> 楽曲数はアイマス全体で 3,000 曲超。**一括投入は現実的でない**ので §9 のフェーズ運用で段階的に増やす。

### 4.7 `venues.csv` — 会場マスタ

```csv
venue_id,name,name_short,city,prefecture,country,capacity,scale,is_outdoor,alias,verified,notes
v_saitama_ssa,さいたまスーパーアリーナ,SSA,さいたま市,埼玉県,JP,37000,ssa,false,SSA;スパアリ,false,
v_shanghai,梅賽徳斯奔馳文化中心(上海),上海メルセデス,上海,,CN,18000,overseas,false,,false,海外公演
v_online,オンライン配信,配信,,,,,online,false,無観客;配信のみ,true,配信専用公演用の仮想会場
```

**`scale` の enum**（`rank` は表示順とプリセット用。フィルタ自体はチェックボックスで行う）

| scale | 表示名 | rank | 目安 |
|---|---|---|---|
| `dome` | ドーム級 | 6 | 東京ドーム / 京セラドーム等 |
| `ssa` | 特大アリーナ | 5 | SSA / 横浜アリーナ / ぴあアリーナ 等 2万級 |
| `arena_l` | 大アリーナ | 4 | 1〜2万 |
| `arena_s` | 小アリーナ | 3 | 1万人未満 |
| `hall` | ホール | 2 | |
| `livehouse` | ライブハウス | 1 | |
| `overseas` | 海外 | 3 | **規模によらず海外公演はすべてこれ** |
| `online` | 配信 | 0 | 無観客・配信専用（会場は `v_online`） |

- 海外は規模で分けず 1 区分にまとめた。国内会場の規模感をそのまま海外に当てても意味がないため。
- フィルタ UI は 8 区分のチェックボックス＋プリセット（すべて／ホール以上／アリーナ以上）。
- `capacity` は会場公称値。

### 4.8 `tours.csv` — ツアーマスタ

```csv
tour_id,name,name_short,brand_id,year,start_date,end_date,notes
t_ml10th,THE IDOLM@STER MILLION LIVE! 10thLIVE TOUR,ML 10th,ml,2023,,,
```

### 4.9 `lives.csv` — 公演マスタ

```csv
live_id,tour_id,title,day_label,date,start_time,venue_id,capacity_actual,brand_id,event_type,has_stream,has_lv,has_archive,setlist_status,official_url,notes
20260829_ml10th_d1,t_ml10th,MILLION LIVE! 10thLIVE TOUR Act-4 DAY1,DAY1,2026-08-29,17:00,v_saitama_ssa,,ml,solo,true,true,true,confirmed,,
```

| 列 | 説明 |
|---|---|
| `day_label` | `DAY1` / `昼公演` / `Act-2` 等 |
| `event_type` | `solo`（単独） / `festival`（フェス・合同） / `event`（イベント・トークショー） / `release`（リリイベ） / `broadcast`（ニコ生等） |
| `has_stream` / `has_lv` / `has_archive` | その公演に配信・LV・アーカイブが存在したか（**存在しない公演を「配信込み」で回収扱いにしない**ために必要） |
| `setlist_status` | `confirmed` / `partial` / `unknown`。`partial` は統計で注記付きになる |

### 4.10 `setlists/<year>.csv` — セットリスト（最重要テーブル）

```csv
live_id,seq,block,song_id,performers,is_original,is_premiere,medley_group,notes
20260829_ml10th_d1,1,opening,s_thankyou,ml_mirai;ml_shizuka;ml_tsubasa,false,false,,
20260829_ml10th_d1,2,main,s_dreaming,ml_mirai,true,true,,初披露
20260829_ml10th_d1,3,main,s_medley_a,ml_mirai;ml_shizuka,,false,m1,メドレー1曲目（is_original 空＝自動判定）
```

| 列 | 説明 |
|---|---|
| `seq` | 公演内の通し番号（1 始まり） |
| `block` | `opening` / `main` / `encore` / `wencore` / `mc`（MC はセトリに含めなくてもよい） |
| `performers` | **その公演で歌ったアイドル**の `;` 区切り。オリメン判定・編成統計の基準 |
| `is_original` | **オリメン歌唱かどうかの入力欄。`true` / `false` / 空（空＝自動判定）** |
| `is_premiere` | 初披露フラグ（レア度統計に使う） |
| `medley_group` | 同一メドレー内の曲に同じキーを振る |

**年別分割の理由**: 1 公演 25 曲 × 数百公演 = 数万行になる。年別なら 1 ファイル数千行に収まり、VSCode でも git diff でも扱える。アプリ側は `manifest.json` を見て全年をまとめて読む（初回のみ、以降は Cache API）。

---

### 4.11 リレーション

```
brands ──< idols ──< cv_assignments
   │         │
   │         └──< units (member_idol_ids)
   │
   └──< songs (original_members → idols)
              │
venues ──< lives >── tours
              │
              └──< setlists ──> songs
                            └──> idols (performers)
```

### 4.12 バリデーション（CI / `scripts/validate.mjs`）

PR ごとに GitHub Actions で自動実行し、失敗したらマージ不可にする。

1. **ID 一意性**: 各テーブルの主キー重複なし
2. **外部キー整合**: `setlists.song_id` が `songs` に存在、`performers` の全 idol_id が `idols` に存在、等
3. **enum 検証**: `scale` / `event_type` / `song_type` / `block` が定義値のみ
4. **フォーマット**: 日付 `YYYY-MM-DD`、色 `#[0-9A-F]{6}`、真偽値
5. **必須列の非空**: `name_kana`, `color`, `date`, `venue_id` など
6. **セマンティック警告**（エラーにはしない）
   - `setlist_status=confirmed` なのにセトリ行が 0
   - `performers` が `original_members` と完全一致しないのに全員別ブランド
   - `has_stream=false` の公演に配信フラグの参戦記録が付いている（アプリ側で警告）
7. **manifest.json 生成**: ファイル一覧・行数・commit hash

エラーメッセージは `data/setlists/2026.csv:142 song_id "s_typo" not found in songs.csv` の形式で、VSCode の問題パネルからジャンプできるようにする。

### 4.13 データ投入運用

- Issue テンプレート「公演追加」「楽曲追加」を用意（フォーム形式 → コピペで CSV 行になる）
- `docs/CONTRIBUTING.md` に ID 命名規則と記入例
- VSCode 推奨拡張を `.vscode/extensions.json` に記載: `mechatroner.rainbow-csv`, `janisdd.vscode-edit-csv`
- `.vscode/settings.json` で CSV のフォーマッタ・ソート設定を固定

---

## 5. ユーザデータ

ブラウザ localStorage に保存。DB とは完全分離。

```jsonc
{
  "version": 1,
  "profile": {
    "displayName": "だし巻きかたつむり",
    "tantou": ["ml_kuramoto", "gk_amayo", "cg_miho"],   // 担当設定
    "startedAt": "2018-06-16"
  },
  "attendance": {
    "20260829_ml10th_d1": {
      "mode": "onsite",          // onsite | lv | stream | archive
      "seat": "スタンド 200 レベル",
      "companions": ["Pさん"],
      "memo": "アンコールで初披露",
      "rating": 5
    }
  },
  "settings": {
    "countMode": "onsite",       // onsite | onsite_lv | all
    "originalRule": "csv",
    "scales": null,
    "eventTypes": null
  }
}
```

- **エクスポート/インポート**: JSON ファイル（`hankencho-YYYYMMDD.json`）。機種変更・バックアップ用。
- **共有 URL**（未実装 / v2）: 参戦公演 ID 群を圧縮して `?d=` に載せ、読み取り専用で他人に見せる。
- localStorage 破損・スキーマ変更に備え `version` でマイグレーション。

---

## 6. 機能仕様

### 6.1 公演を選ぶ（メイン導線）

- 年 → ツアー → 公演 の 3 段階で絞り込めるリスト。デフォルトは新しい順。
- 各行は**半券カード**（§7.4）。タップで選択、長押し/展開で参戦モード・座席・メモを入力。
- フィルタ: ブランド / 年 / 会場 / 規模 / event_type / 「未入力のみ」
- 検索: 公演名・会場名・ツアー名の**かな・カナ・ローマ字・略称**を横断（`alias` 列と正規化関数を使用）
- 一括操作: 「このツアーの全公演を選択」「この年をまとめて配信で回収」

### 6.2 参戦モードと集計スコープ

集計スコープを 3 段階で切り替える（グローバルトグル、常時画面上部に表示）。

| モード | 含む参戦 |
|---|---|
| **現地** (default) | `onsite` |
| **現地 + LV** | `onsite`, `lv` |
| **配信込み** | `onsite`, `lv`, `stream`, `archive` |

- 切り替え時、主要な数値は**差分を併記**する（例: `オリメン回収 62.4% ( +8.1pt )`）。「配信を足したらどれだけ回収できているか」がこのトグルの主目的なので、差分表示は必須要件とする。
- `has_stream=false` の公演に `stream` を設定しようとしたら警告（データ側の誤りの可能性）。

### 6.3 統計項目

#### A. サマリー
- 参戦公演数 / 総楽曲披露数 / ユニーク楽曲数 / ユニーク編成数
- 参戦日数、初参戦からの経過年数、最長連続参戦（ツアー単位）
- ブランド別内訳（ドーナツ、ブランドカラー）
- 年別ヒートマップ（カレンダー）

#### B. 楽曲
- **複数回聴いた曲ランキング**（回数・初回/最終聴取日・公演リンク）
- 1回だけ聴いた曲の数（「一期一会」）
- **未回収楽曲リスト** — 全楽曲から自分の回収済みを引いたもの。ブランド / ユニット / 担当で絞り込み
- **楽曲レア度スコア** — 全公演での披露回数が少ない曲ほど高得点。自分が聴いた曲の合計を「レアリティスコア」として表示
- 初披露立ち会い回数（`is_premiere`）
- ソロ曲回収率（担当のソロ曲は全部聴いた？）

#### C. 編成（オタクの主戦場）
- **複数回聴いた「曲 × 編成」ランキング** — 同じ曲でも編成が違えば別カウント
- **同一曲の編成コレクション** — 「この曲は 4 編成中 3 編成聴いた」
- **オリメン回収** — 楽曲ごとに以下の 4 段階で判定
  | 判定 | 条件 |
  |---|---|
  | `FULL` | 編成 == オリメン（完全一致） |
  | `SUPERSET` | オリメン全員を含み、追加メンバーあり |
  | `PARTIAL` | オリメンの一部のみ（充足率 % を表示） |
  | `NONE` | オリメンが 1 人も含まれない（完全カバー） |
  - **判定の本体は `setlists.is_original`（true / false / 空）。空欄の行だけ上の自動判定で補う。**
  - 設定 `originalRule` で「CSV優先（既定）／完全一致のみ／オリメン全員いればOK」を切替
  - さらにセットリスト画面で 1 曲ずつタップして上書きでき、上書きはルールより優先される（解釈が割れるため最終判断はユーザに置く）
  - ブランド別・ユニット別・担当別のオリメン回収率
  - **オリメン未回収リスト** + 「その曲のオリメン披露が最後にあったのはいつか」

#### D. アイドル / CV
- アイドル別聴取回数 TOP（キャラカラーのバー）
- CV 別遭遇公演数（公演日時点の CV で解決）
- 担当アイドルの詳細ページ: 回収済み曲 / 未回収曲 / 一緒に歌った相手ランキング（共演マトリクス）
- **共演ネットワーク** — 自分が見た編成から作る「誰と誰を一緒に見たか」の集計

#### E. 会場
- 会場別参戦回数ランキング
- 規模別内訳（ドーム / SSA / …）
- 都道府県別マップ（日本地図 SVG の塗り分け）、遠征距離の合計（任意）
- 会場ごとの「その会場でしか聴いていない曲」

#### F. 前回披露（規模フィルタ付き）
- 任意の楽曲について「**最後に披露されたのはいつ・どの公演か**」
- フィルタ:
  - 規模スライダー（`minScaleRank`）— 「ホール以下を除外」等
  - 海外を含む / 除く
  - `event_type` を含む / 除く（リリイベ・ニコ生を除いて単独ライブだけで見る、等）
- 表示: `最終披露: 2024-11-02 / ML 9th DAY2 / 横浜アリーナ`、および `〇〇日経過`
- 「久しく披露されていない曲」ランキング（＝次のライブで来るかもしれない曲）

#### G. 予測・提案（おまけ）
- 「あと 1 曲でこのユニットは完全回収」といった**あと少しリスト**
- 未回収曲の披露頻度から算出した「次のライブで聴ける確率」（単純な頻度ベース、あくまで遊び）

### 6.4 画像書き出し

- 対象: 「サマリー」「TOP10 曲」「オリメン回収率」「担当アイドル」「会場マップ」の 5 種のカード。各カードに単独の書き出しボタン。
- タイトル: `2026年8月29日時点` を自動で埋め込む。ユーザ名（任意）とスコープ（現地 / 配信込み）も併記。
- サイズプリセット: `1080×1350`（SNS 縦）/ `1200×630`（OGP）/ `1080×1080`。2x で描画。
- 実装: Canvas 2D で直接描画（`assets/js/card.js`）。描画前に `document.fonts.load()` で 3 書体を確実に読み込ませてから `toBlob`。
- 出力にはアプリ名と URL を小さくフッタに入れる（貼られたときの導線）。
- 失敗時はトーストで通知して再試行できるようにする。

### 6.5 その他の機能

| 機能 | 内容 |
|---|---|
| デモモード | ユーザデータ 0 でもサンプル参戦データで統計を体験できる |
| 楽曲ブラウザ | 参戦記録と無関係に、楽曲 DB を検索・閲覧できるページ（既存の ML 楽曲 DB の上位互換） |
| 公演詳細 | セトリ全曲 + 各曲のオリメン判定バッジ + 自分の回収状況 |
| タイムライン | 参戦履歴を年表として縦に並べる（半券が積み上がる） |
| PWA | オフラインで開ける。Service Worker で `data/` をキャッシュ |
| ダークモード | 「開演前（暗転）」テーマとして実装（§7.5） |
| 多言語 | 日本語がデフォルト。英語 UI を後から追加できるよう文言を `i18n/ja.json` に外出し（英語ガイド作成の実績を活かせる） |
| キーボード操作 | 一覧の `j/k` 移動、`space` で選択トグル |

---

## 7. UI / UX 仕様

### 7.1 コンセプト

> **「ライブの半券を貼った、自分だけのスクラップブック」**

参戦記録アプリの本質は「積み上げてきたものを眺めて満足する」こと。だから画面の主役はダッシュボードのグラフではなく、**半券（チケットスタブ）そのもの**にする。統計は「ノートの余白に書き込んだメモ」と「会場の LED ビジョン」として表示する。

### 7.2 デザイントークン

**カラー（ベース）**

| 名前 | hex | 用途 |
|---|---|---|
| `paper` | `#E9EEF2` | 背景。方眼ノートの淡いブルーグレー |
| `grid` | `#CDD9E3` | 方眼の罫線（1px、8mm 相当） |
| `stub` | `#FCFBF7` | 半券カードの紙色 |
| `ink` | `#1D2B45` | 本文（ボールペンの濃紺） |
| `ink-soft` | `#5B6B85` | 補助テキスト |
| `stamp` | `#E0402F` | 検印・スタンプの朱色。**回収済みの証** |
| `tape` | `#D8CBA8` | マスキングテープ |

- ブランドカラー・キャラカラーは `brands.csv` / `idols.csv` から動的に取得し、**CSS カスタムプロパティ `--brand` `--idol` に流し込む**。ハードコードしない。
- キャラカラーは「ペンライトの光」として表現する: 文字色には使わず、**チップ・帯・グロー（`box-shadow: 0 0 12px color-mix(in srgb, var(--idol) 60%, transparent)`）** に使う。淡色キャラでも読めるよう、文字は常に `ink`。
- コントラスト保証: キャラカラーの輝度を計算し、必要なら `color-mix` で暗い派生色を作って細字ラベルに使う。

**タイポグラフィ**

| ロール | フォント | 用途 |
|---|---|---|
| ディスプレイ | **Zen Maru Gothic** (700) | 見出し。丸ゴシックで親しみやすさを出す |
| 本文 | **Zen Kaku Gothic New** (400/500) | 一般テキスト |
| データ | **DotGothic16** | 数値・カウンタ・日付。**会場の LED ビジョン / 電光掲示板**の見立て。これが署名要素 |

- 数字だけドットフォントにすることで、統計が「会場のスクリーンに出た情報」に見える。多用は禁物で、**カウンタと日付だけ**に限定する。

**レイアウト**
- 背景は方眼（`repeating-linear-gradient` で 24px グリッド）。
- 半券カードは `border-radius: 4px` 程度。角丸を強くしない（紙だから）。
- カードはわずかに回転（`-1.2deg` 〜 `+1.2deg`、ID からハッシュして固定）。整列しすぎない。
- 影は柔らかく低く（`0 2px 0 rgba(29,43,69,.08)`）。ドロップシャドウを浮かせない。

### 7.3 署名要素: 半券カード

```
┌───────────────────────────┬──┐
│ ▌ML  MILLION LIVE! 10th   ┊  │  ← 左端 4px 帯 = ブランドカラー
│    TOUR Act-4  DAY1       ┊済│  ← ミシン目(dashed)の右にもぎり部
│                           ┊  │
│ 2026.08.29  さいたまSA     ┊  │  ← 日付は DotGothic16
│ ● ● ● ● ●                 ┊  │  ← 出演者のキャラカラー・ドット
└───────────────────────────┴──┘
    ↑ 左右に半円のノッチ（切り欠き）
```

- **未参戦**: 紙が薄く（`opacity .55`）、彩度が落ちている。
- **選択（参戦済み）**: もぎり部に朱色の検印スタンプ（少し傾いた `済` / `LIVE`）が **押される**アニメーション（100ms でスケール 1.4 → 1.0、`prefers-reduced-motion` で無効化）。
- **配信参戦**: スタンプが朱色ではなく破線の枠になり、「配信」表記。現地と一目で見分けがつく。

これがアプリ全体の中心メタファ。一覧・タイムライン・画像書き出しすべてでこの半券を使い回す。

### 7.4 統計の見せ方

- 数値は**ノートに貼った付箋 / 手書き風の丸囲み**の中に置く。四角いカードを並べたダッシュボードにしない。
- 棒グラフはキャラカラーの帯。グリッド線は方眼と共有して、グラフ用の枠線を追加しない。
- オリメン回収バッジは **4 種類のハンコ**として表現:
  - `FULL` = 朱色の二重丸印
  - `SUPERSET` = 朱色の丸印（外側に点線）
  - `PARTIAL` = 朱色の三角印 + `3/5`
  - `NONE` = グレーの斜線
- 空状態: 「まだ半券がありません。行った公演を選ぶと、ここに貼られます。」＋公演選択への導線。謝らない・煽らない。

### 7.5 ダークモード = 「開演前」テーマ

- `paper` → `#131A26`（暗転した客席）、方眼は極薄。
- キャラカラーのグローが**強くなる**（ペンライトが目立つ）。
- 半券の紙色は維持し、暗い机の上に置かれているように見せる。
- 単に色を反転するのではなく「ライブ前の暗転」という物語として設計する。

### 7.6 やらないことリスト（明示的禁止）

要望どおり、いわゆる「AI が作った UI」に見える手癖を禁止する。

- ❌ `slate` / `gray-50` の白いカードを 3 列グリッドで並べる統計ダッシュボード
- ❌ 紫〜青のグラデーションヒーロー / グラデーション文字
- ❌ アイコン + 大きい数字 + 小さいラベル の定型スタットカード
- ❌ ガラスモーフィズム（`backdrop-blur` の多用）
- ❌ 全要素 `rounded-xl` + `shadow-lg`
- ❌ 汎用アイコンセットをそのまま散らす（アイコンは最小限、必要なら手描き風 SVG を自作）
- ❌ クリーム地 (#F4F1EA) + 高コントラスト明朝 + テラコッタ (#D97757) の組み合わせ ※これも今の AI 製デザインの典型
- ❌ 黒背景 + 単色のアシッドグリーン / 朱のアクセント
- ❌ 意味のない `01 / 02 / 03` 連番装飾
- ❌ 絵文字を UI ラベルに使う

### 7.7 文言のトーン

- 普通体・簡潔。「〜しましょう！」のような煽りを使わない。
- ボタンは動作をそのまま書く: `画像を保存` / `この公演を追加` / `配信込みで見る`
- エラーは原因と次の行動を書く: 「セットリストが未登録の公演です。統計には公演数のみ反映されます。」

---

## 8. 技術スタック

| 領域 | 採用 | 理由 |
|---|---|---|
| ビルド | **なし** | `git push` だけで公開される。npm も node_modules も要らない |
| JS | **素の ES モジュール** | `<script type="module">` で直接読む |
| CSS | **素の CSS + カスタムプロパティ** | Tailwind のデフォルトトークンに引っ張られると §7.6 に戻ってしまうため使わない |
| CSV | **自前パーサ**（`assets/js/csv.js`） | 引用符・改行対応で 30 行。依存を増やさない |
| 画像 | **Canvas 2D で直描画** | `html-to-image` はフォント埋め込みが不安定なので不採用。Canvas は `document.fonts.load()` 済みの Web フォントをそのまま使えて出力が安定する |
| グラフ | 自作（CSS バー / Canvas） | ライブラリのデフォルト見た目を避ける |
| 検索 | 自前正規化 + 部分一致 | NFKC・ひらがな→カタカナ・長音除去。`alias` 列も検索対象 |
| CI | GitHub Actions | validate → Pages deploy。CSV が壊れていればデプロイされない |

> 依存パッケージはゼロ。外部から取るのは Google Fonts の 3 書体だけ。

### 8.1 パフォーマンス

- 初回ロード: masters と setlists を `Promise.all` で並列 fetch。件数が万行を超えてきたら `manifest.json` を見て年別に遅延ロードへ切り替える（現状は一括で十分速い）。
- 目標: 初期表示 < 1.5s（3G Fast 想定）、統計再計算 < 100ms。
- 統計は「参戦公演セット」が変わったときだけ再計算し、結果をメモ化。
- setlists 全体で 1MB を超えたら Cache API に保存し、`manifest.json` のハッシュが変わったときだけ再取得。

### 8.2 アクセシビリティ

- キャラカラーは**必ず名前とセットで**表示（色だけで情報を伝えない）。
- コントラスト比 4.5:1 以上（本文）。
- フォーカスリングを消さない（`stamp` 色の 2px アウトライン）。
- `prefers-reduced-motion` でスタンプ・回転アニメを無効化。
- 半券カードは `role="checkbox"` + `aria-checked`、キーボード操作可。

---

## 9. 開発フェーズ

| フェーズ | 内容 | 成果物 |
|---|---|---|
| **P0** | スキーマ確定・空 CSV とバリデータ・リポジトリ雛形 | `data/*.csv`（ヘッダのみ）, CI |
| **P1** | ML + 765AS のデータ投入（既存 HTML DB から移植）。アイドル・楽曲・キャラカラー | idols/songs 約 500 行 |
| **P2** | 会場・公演・セトリを ML の 1st〜最新まで投入 | 実データで統計が回る |
| **P3** | アプリ MVP: 公演選択 + サマリー + 曲ランキング + オリメン回収 | Pages 公開 |
| **P4** | 規模フィルタ・前回披露・現地/配信トグル・画像書き出し | 要件の中核が揃う |
| **P5** | 他ブランド（CG / SideM / SC / 学マス）データ拡張。コントリビュート導線整備 | |
| **P6** | 予測・共演ネットワーク・PWA・英語 UI | |

P1〜P2 で **ML だけ完結させて公開**するのが現実的。全ブランドを揃えてから公開しようとすると永遠に出ない。

---

## 10. 将来拡張（v2 以降の候補）

- 参戦記録の相互比較（共有 URL 同士を突き合わせて「一緒に見た公演」を出す）
- セトリ予想機能（このアプリの DB を使って次公演のセトリを予想・答え合わせ）
- グッズ / CD 所持管理
- 公演ごとの写真（自分の撮った会場外観など）をローカル添付
- 「回収率」を軸にした実績/バッジシステム

---

## 10.5 v0.2 時点の実装状況

| 機能 | 状態 |
|---|---|
| 公演選択（半券UI・現地/LV/配信/アーカイブ） | 実装済 |
| 集計スコープ切替と現地との差分表示 | 実装済 |
| 統計（曲・編成・オリメン・アイドル・CV・会場・規模・年別・レア度・初披露） | 実装済 |
| 前回披露（規模・種別フィルタつき） | 実装済 |
| 未回収楽曲 / オリメン未回収リスト | 実装済 |
| オリメン判定の CSV フラグ・ルール切替・1曲ずつ上書き | 実装済 |
| PNG 書き出し 5 種（日付入りタイトル） | 実装済 |
| JSON エクスポート / インポート | 実装済 |
| 開演前（ダーク）モード | 実装済 |
| CSV バリデータ + CI | 実装済 |
| 都道府県マップ / 共演ネットワーク / PWA / 共有URL / 予測 | 未実装（v2） |

**データの充足状況**

| ブランド | 名簿 | キャラカラー | 楽曲 |
|---|---|---|---|
| 765AS | 14 名（全員） | 実データ | 12 曲 |
| ML | 39 名（全員） | 実データ | 17 曲 |
| 876 / 961 / vα-liv | 3 / 3 / 3 名 | 未入力 | 各 1 曲 |
| CG / SideM / SC / 学マス | 15 / 4 / 23 / 13 名（一部） | 未入力 | 6 / 2 / 5 / 7 曲 |

公演 12 件・セットリスト 68 行はすべて**動作確認用の仮データ**（`verified=false` / `setlist_status=seed`）。

---

## 11. 確認したいこと（着手前の要決定事項）

1. ~~**ブランドの範囲**~~ — 決定済み：765AS / 876 / 961 / CG / ML / SideM / シャニマス / 学マス / vα-liv の 9 ブランド + 越境 + その他。
2. **ブランドカラーの hex** — 公式値で揃えたい。手元に定義があれば `brands.csv` の初期値として渡してほしい。
3. **セトリデータの調達方針** — 現状は仮データ。手入力していく前提だが、既存の個人管理データ（スプレッドシート等）があれば CSV 変換スクリプトを書いたほうが早い。ここが総工数の 7 割を占める。
4. ~~**オリメン判定のデフォルト**~~ — 決定済み：`setlists.is_original` を手入力し、空欄のみ自動判定。ユーザ側で上書き可。
5. **公開範囲** — 個人用か、他の P にも使ってもらうか。後者ならデータのライセンス表記と免責（非公式・ファンメイド）を `docs/` に置く。
6. **キャラカラーの補完** — CG / SideM / シャニマス / 学マス / vα-liv の `color` 列が空。手元に一覧があれば貼るだけで反映される。

---

## 付録 A: 統計計算のロジック（擬似コード）

```ts
// 参戦したセトリ行だけに絞る
const attended = setlists.filter(r =>
  scope.includes(attendance[r.live_id]?.mode)
);

// 曲ごとの回数
const songCount = groupBy(attended, r => r.song_id);

// 編成キー（順序非依存）
const lineupKey = (r: SetlistRow) =>
  `${r.song_id}::${r.performers.slice().sort().join(';')}`;
const lineupCount = groupBy(attended, lineupKey);

// オリメン自動判定（setlists.is_original が空欄のときだけ使う）
function judge(song: Song, performers: IdolId[]): 'FULL'|'SUPERSET'|'PARTIAL'|'NONE' {
  const orig = new Set(song.original_members);
  if (orig.size === 0) return 'NONE';
  const set = new Set(performers);
  const hit = [...orig].filter(id => set.has(id)).length;
  if (hit === 0) return 'NONE';
  if (hit < orig.size) return 'PARTIAL';
  return set.size === orig.size ? 'FULL' : 'SUPERSET';
}

// 前回披露（規模フィルタ付き）
function lastPerformed(songId: SongId, opt: {scales: Scale[]; eventTypes: EventType[]}) {
  return setlists
    .filter(r => r.song_id === songId)
    .map(r => lives[r.live_id])
    .filter(l => opt.scales.includes(venues[l.venue_id].scale))
    .filter(l => opt.eventTypes.includes(l.event_type))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}
```

## 付録 B: 日本語検索の正規化

```ts
const normalize = (s: string) => s
  .normalize('NFKC')            // 全角英数・半角カナを統一
  .toLowerCase()
  .replace(/[ぁ-ん]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)) // ひらがな→カタカナ
  .replace(/[ー－―‐]/g, '')      // 長音・ハイフンを無視
  .replace(/\s+/g, '');
```

検索対象は `name`, `name_kana`, `name_en`, `alias` の正規化済み連結文字列を事前計算しておく。
